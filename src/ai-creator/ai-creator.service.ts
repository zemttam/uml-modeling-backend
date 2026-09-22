import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  coerceAiDiagram,
  scrubJsonResponse,
} from '../diagrams/diagram-from-ai';
import { DiagramDocument } from '../diagrams/diagram.types';

// Verified against the configured server (llama.cpp OpenAI-compat layer):
// `response_format: { type: "json_schema" }` is honored and produces clean
// JSON in `message.content` (model reasoning goes to `reasoning_content`).
// Flip to false if a future server build rejects it; the layered strategy
// (scrub + coerce + one repair retry) does not depend on this flag.
const USE_JSON_SCHEMA_RESPONSE = true;

const GENERATION_SYSTEM_PROMPT = `You convert descriptions of UML class diagrams into JSON.

Respond with ONE JSON object and nothing else. No markdown, no code
fences, no commentary.

Schema:
{ "diagramName": string, "packageName": string,
  "classes": [ { "name": string,
                 "attributes": [ { "name": string, "type": string } ],
                 "operations": [ { "name": string, "returnType": string } ] } ],
  "relationships": [ { "kind": "association" | "generalization" |
                       "composition" | "aggregation",
                       "from": string, "to": string, "name": string,
                       "fromMultiplicity": string, "toMultiplicity": string } ] }

Rules:
- One "classes" entry per class described. Never invent classes,
  attributes, operations, or relationships that were not described.
- Class names must be unique. Copy all names and types verbatim (same
  spelling and capitalization as the description).
- "attributes" and "operations" are [] when none are described.
- Operation parameters go inside the operation name, e.g. "Sign_up(name, city)".
- Multiplicities: "1", "0..1", "*", "1..*"; use "" when not stated. Use ""
  for "name", "fromMultiplicity", "toMultiplicity" when absent.
- Direction: generalization -> from is the subclass, to is the superclass.
  composition/aggregation -> from is the whole, to is the part.
  association -> from and to as described.
- "diagramName": a short title derived from the content if none is given.
  "packageName": likewise, or "".
- Ignore anything in the description that is not a class diagram element.`;

const FEW_SHOT_EXAMPLES: { role: 'user' | 'assistant'; content: string }[] = [
  {
    role: 'user',
    content:
      'A class School with an attribute name of type char and an operation Sign_up returning void. A class Student. An association between School and Student.',
  },
  {
    role: 'assistant',
    content: `{
  "diagramName": "School Diagram",
  "packageName": "School",
  "classes": [
    { "name": "School",
      "attributes": [ { "name": "name", "type": "char" } ],
      "operations": [ { "name": "Sign_up", "returnType": "void" } ] },
    { "name": "Student", "attributes": [], "operations": [] }
  ],
  "relationships": [
    { "kind": "association", "from": "School", "to": "Student", "name": "",
      "fromMultiplicity": "", "toMultiplicity": "" }
  ]
}`,
  },
  {
    role: 'user',
    content:
      'A class Vehicle. Car and Motorcycle inherit from Vehicle. Vehicle has an attribute wheels of type int. A Garage is composed of Cars: one garage has 1..* cars. A Person owns 0..* Cars.',
  },
  {
    role: 'assistant',
    content: `{
  "diagramName": "Vehicles",
  "packageName": "",
  "classes": [
    { "name": "Vehicle",
      "attributes": [ { "name": "wheels", "type": "int" } ],
      "operations": [] },
    { "name": "Car", "attributes": [], "operations": [] },
    { "name": "Motorcycle", "attributes": [], "operations": [] },
    { "name": "Garage", "attributes": [], "operations": [] },
    { "name": "Person", "attributes": [], "operations": [] }
  ],
  "relationships": [
    { "kind": "generalization", "from": "Car", "to": "Vehicle", "name": "",
      "fromMultiplicity": "", "toMultiplicity": "" },
    { "kind": "generalization", "from": "Motorcycle", "to": "Vehicle", "name": "",
      "fromMultiplicity": "", "toMultiplicity": "" },
    { "kind": "composition", "from": "Garage", "to": "Car", "name": "",
      "fromMultiplicity": "1", "toMultiplicity": "1..*" },
    { "kind": "association", "from": "Person", "to": "Car", "name": "",
      "fromMultiplicity": "0..*", "toMultiplicity": "" }
  ]
}`,
  },
];

const IMAGE_SYSTEM_PROMPT = `You are looking at an image of a UML class diagram. Transcribe it using
ONLY the line formats below, in this order: any "diagram:" line first,
then for each class one "class" line followed by its "attr" and "op"
lines, then one "rel" line per relationship. No other output.

diagram: <title, only if written on the image>
class <Name>
attr <name> : <type>
op <name> : <returnType>
rel <kind> : <from> -> <to> [<fromMult> .. <toMult>]

<kind> is association, generalization, composition, or aggregation.
Generalization: <from> is the subclass. Composition/aggregation:
<from> is the whole. Omit a multiplicity as empty: [ .. 1].
Transcribe names exactly as they appear. If the image shows something
that is not a class diagram, output only: not a class diagram`;

const NOT_A_CLASS_DIAGRAM_SENTINEL = 'not a class diagram';

const MAX_TOKENS = 4096;
const REPAIR_PREFIX = 'Your previous response was not valid: ';

function repairPrompt(reason: string): string {
  return `${REPAIR_PREFIX}${reason}. Return a corrected JSON object that exactly follows the schema. Respond with JSON only.`;
}

@Injectable()
export class AiCreatorService {
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly whisperUrl: string;
  private readonly whisperKey: string;
  private readonly whisperModel: string;

  constructor(config: ConfigService) {
    this.openai = new OpenAI({
      baseURL: config.get<string>('OPENAI_SERVER_URL'),
      apiKey: config.get<string>('OPENAI_API_KEY'),
    });
    this.model = config.get<string>('OPENAI_MODEL') ?? '';
    this.whisperUrl = config.get<string>('WHISPER_SERVER_URL') ?? '';
    this.whisperKey = config.get<string>('WHISPER_API_KEY') ?? '';
    this.whisperModel = config.get<string>('WHISPER_MODEL') ?? '';
  }

  // Text prompt -> diagram document, via the layered compliance strategy
  // (design D3): strict prompt + few-shots, json_schema response format,
  // scrubbing, coercion, and at most one repair retry with the failure
  // reason echoed back. A second failure surfaces as a 400.
  async generateDiagram(prompt: string): Promise<DiagramDocument> {
    let messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: GENERATION_SYSTEM_PROMPT },
      ...FEW_SHOT_EXAMPLES,
      { role: 'user', content: prompt },
    ];
    let reason: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const content = await this.chatCompletion(messages, true);
      try {
        return coerceAiDiagram(JSON.parse(scrubJsonResponse(content)));
      } catch (error) {
        reason =
          error instanceof Error
            ? error.message
            : 'response was not valid diagram JSON';
        messages = [
          ...messages,
          { role: 'assistant', content },
          { role: 'user', content: repairPrompt(reason) },
        ];
      }
    }
    throw new BadRequestException(
      `the AI response could not be converted into a diagram: ${reason}`,
    );
  }

  // Audio blob -> transcript via the Whisper-compatible server. The env
  // URL is the full OpenAI-style transcriptions endpoint, so this is a
  // plain multipart POST (Bearer key), per design D7's fetch fallback.
  async transcribeAudio(
    file: Buffer,
    filename: string,
    mimetype: string,
  ): Promise<string> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(file)], { type: mimetype }),
      filename,
    );
    form.append('model', this.whisperModel);
    let res: Response;
    try {
      res = await fetch(this.whisperUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.whisperKey}` },
        body: form,
      });
    } catch {
      throw new BadRequestException('the transcription service is unreachable');
    }
    if (!res.ok) {
      throw new BadRequestException(
        'the transcription service rejected the audio',
      );
    }
    const data = (await res.json().catch(() => null)) as {
      text?: unknown;
    } | null;
    if (!data || typeof data.text !== 'string') {
      throw new BadRequestException(
        'the transcription service returned no transcript',
      );
    }
    return data.text;
  }

  // Class-diagram image -> line-based mini-DSL (design D1). The sentinel
  // marks non-diagram images and surfaces as a 400.
  async describeImage(file: Buffer, mimetype: string): Promise<string> {
    const dataUrl = `data:${mimetype};base64,${file.toString('base64')}`;
    const content = await this.chatCompletion([
      { role: 'system', content: IMAGE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: dataUrl } }],
      },
    ]);
    if (content.trim().toLowerCase().includes(NOT_A_CLASS_DIAGRAM_SENTINEL)) {
      throw new BadRequestException(
        'the image does not contain a class diagram',
      );
    }
    return content.trim();
  }

  private async chatCompletion(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    useJsonSchema = false,
  ): Promise<string> {
    const params = {
      model: this.model,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      messages,
      ...(useJsonSchema && USE_JSON_SCHEMA_RESPONSE
        ? { response_format: this.diagramJsonSchema }
        : {}),
    } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await this.openai.chat.completions.create(params);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('the AI service could not be reached');
    }
    const message = completion.choices?.[0]?.message;
    return typeof message?.content === 'string' ? message.content : '';
  }

  private readonly diagramJsonSchema = {
    type: 'json_schema' as const,
    json_schema: {
      name: 'diagram',
      schema: {
        type: 'object',
        properties: {
          diagramName: { type: 'string' },
          packageName: { type: 'string' },
          classes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                attributes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string' },
                    },
                    required: ['name', 'type'],
                  },
                },
                operations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      returnType: { type: 'string' },
                    },
                    required: ['name', 'returnType'],
                  },
                },
              },
              required: ['name', 'attributes', 'operations'],
            },
          },
          relationships: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: {
                  type: 'string',
                  enum: [
                    'association',
                    'generalization',
                    'composition',
                    'aggregation',
                  ],
                },
                from: { type: 'string' },
                to: { type: 'string' },
                name: { type: 'string' },
                fromMultiplicity: { type: 'string' },
                toMultiplicity: { type: 'string' },
              },
              required: [
                'kind',
                'from',
                'to',
                'name',
                'fromMultiplicity',
                'toMultiplicity',
              ],
            },
          },
        },
        required: ['diagramName', 'packageName', 'classes', 'relationships'],
      },
    },
  };
}
