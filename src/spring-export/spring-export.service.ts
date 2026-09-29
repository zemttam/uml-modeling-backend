import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as JSZip from 'jszip';
import OpenAI from 'openai';
import { scrubJsonResponse } from '../diagrams/diagram-from-ai';
import { DiagramDocument } from '../diagrams/diagram.types';

// Mirrors AiCreatorService's flag: llama.cpp's OpenAI-compat layer honors
// `response_format: { type: "json_schema" }`. The layered strategy (scrub +
// validate + one repair retry) does not depend on this flag.
const USE_JSON_SCHEMA_RESPONSE = true;

// Whole-project generation in one completion; the configured server
// provides a 64k-token context, so leave headroom for the prompt.
const MAX_TOKENS = 60000;

const PROJECT_NAME = 'spring-boot-project';
const REPAIR_PREFIX = 'Your previous response was not valid: ';

export const EXPORT_SYSTEM_PROMPT = `You convert UML class diagram documents into complete Spring Boot project files.

Respond with ONE JSON object and nothing else. No markdown, no code
fences, no commentary.

Schema:
{ "projectName": string, "files": [ { "path": string, "content": string } ] }

"files" lists EVERY file of the generated project, each with a project-root
relative path (e.g. "pom.xml", "src/main/java/springboot/project/Customer.java").
"content" is the full file content as a JSON string.

Target stack (mandatory):
- Spring Boot 3.3.x, Java 17, Maven.
- Starters: spring-boot-starter-web, spring-boot-starter-data-jpa, and the
  postgresql driver. Do NOT use Lombok or any other library.
- Group/artifact/package name: ${PROJECT_NAME}.

Architecture (Model-Service-Controller):
- "projectName" MUST be "${PROJECT_NAME}".
- For EVERY class in the diagram produce exactly four files: a JPA entity
  annotated @Entity (with @Table, @Id field, and a field per class
  attribute, types mapped to Java equivalents), a Spring Data repository
  interface for that entity, a @Service class operating on the repository,
  and a @RestController exposing CRUD (create/read/read-all/update/delete)
  endpoints under a path derived from the entity name (e.g. /api/customers),
  using @PostMapping/@GetMapping/@PutMapping/@DeleteMapping.
  - Also produce: the Maven pom.xml with the pinned stack, a main application
  class annotated @SpringBootApplication, and
  src/main/resources/application.properties.
  - Import hygiene: every generated ".java" file must compile standalone: it
  must include an import for every type it references. Never rely on imports
  that only exist in other generated files.
  - Derive all names (classes, fields, methods, endpoints) from the diagram's
  names. Never invent classes, attributes, or operations not in the diagram.
  - Check for consistency: classes, functions, methods have to be called correctly.
  Check if a call you are performing is being written correctly. This app
  has to compile from the get-go, so you have to be super-accurate.

- Ignore the diagram's layout fields ("x", "y") and the elements' "id"
  fields: they are canvas metadata only and MUST NOT appear in the generated
  code or file names.

Attribute type mapping (case-insensitive match on the stored type string):
- "int" -> Integer, "byte" -> Integer, "short" -> Integer, "long" -> Long,
  "boolean" -> Boolean,
  "double" -> Double, "float" -> Double, "char" -> String,
  "String" -> String.
- Date-like types ("Date", "LocalDate", "DateTime") -> LocalDate.
- An attribute whose stored type is empty or missing -> String.
- Any other stored type -> String.

UML-to-JPA mapping rules:
- Generalization: the "from" class inherits from the "to" class (Java
  extends between entity classes).
- Association: a JPA relation whose kind and ownership follow the stored
  multiplicities. Multiplicity grammar: "0..1" and "1" are single-valued;
  "*", "0..*", "1..*", and bounded ranges like "2..5" are many-valued; an
  empty multiplicity is unspecified and you choose the most natural
  relation. Both ends single-valued -> @OneToOne; this end single and the
  other many -> @ManyToOne on the single side with the inverse @OneToMany
  on the many side; both ends many-valued -> @ManyToMany. With all that
  being said, avoid circular references: in an association between two
  classes, only one class is being referenced by the other. If uncertain,
  apply @OneToMany.
- Composition ("to" is the whole): a JPA relation with
  cascade = CascadeType.ALL and orphanRemoval = true from the whole (the
  "to" entity) to the part (the "from" entity).
- Aggregation: a plain JPA relation without cascade/orphanRemoval.
- Realization: the target ("to") class, as the supplier, is generated as a
  Java interface declaring the supplier class's operations as its methods;
  the source ("from") class implements that interface. Do NOT generate an
  entity, repository, service, or controller for the supplier class. Any
  attributes on the supplier class are ignored (interfaces carry behavior,
  not state).
- Association class: when a relationship references another class via
  "associationClassId", that tied class is generated as a join entity
  holding a @ManyToOne relation to each end of the tied association (its
  extra attributes become ordinary columns), and both endpoint entities get
  the corresponding inverse @OneToMany to the join entity. Do not generate
  an unrelated standalone slice for the tied class.

Seeder (mandatory, exactly two project-level files):
- A @Component class named DataSeeder and a @RestController named
  SeedController mapping GET /api/seed.
- GET /api/seed first deletes all existing rows through the repositories
  in reverse-dependency order (children before parents; join entities and
  composition parts before wholes), then inserts approximately 15 rows
  per entity, and returns a short JSON summary of the inserted row counts
  per entity. Repeated calls re-seed: every call truncates first, so rows
  never accumulate.
- Insert referenced parent rows before the rows that reference them;
  composition parts are created attached to valid wholes so cascade
  semantics hold; join entities reference valid seeded parents.
- Use ThreadLocalRandom for all random values. Column-aware values:
  String fields generated from a diagram attribute of type "char" get a
  single random lowercase letter a-z, regardless of the column name
  (a "name" column of type char gets "K", not a person name). For
  non-char String fields: fields whose name contains "name", "first",
  or "last" (case-insensitive, e.g. firstName, lastName) get random
  realistic names from a small built-in list; other non-char String
  fields get random words from a small built-in list; Integer/int and
  Long/long fields get random integers in
  1..100; Boolean/boolean fields get random true/false; LocalDate fields
  get random dates; Double/Float fields get random values in 1..100.
  Never set @Id fields; identifiers are left to auto-generation.

application.properties MUST configure the datasource using environment
variable placeholders with these exact defaults:
spring.datasource.url=jdbc:postgresql://\${DB_HOST:localhost}:\${DB_PORT:5434}/\${DB_NAME:springboot}
spring.datasource.username=\${DB_USERNAME:postgres}
spring.datasource.password=\${DB_PASSWORD:1234}
plus spring.jpa.hibernate.ddl-auto=update and a JPA dialect for PostgreSQL.

Also produce a root README.md listing every generated endpoint (HTTP
method, path, name and type of accepted variables for POST/PUT, purpose) so the API can be tested from Postman, and
explicitly include the seed endpoint "GET /api/seed" in that list with its
method, path, and purpose (it truncates and re-seeds all tables). In case
you detect that the classes names along with its attributes were written in Spanish,
the README.md must be in Spanish as well.`;

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface SpringProject {
  projectName: string;
  files: GeneratedFile[];
}

// Thrown for parse/validation failures; the message is echoed back to the
// model on the single repair retry, and surfaces as a 400 on the second
// failure.
export class SpringExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpringExportValidationError';
  }
}

function isUnsafePath(path: string): boolean {
  if (path === '') {
    return true;
  }
  if (path.startsWith('/') || path.startsWith('~')) {
    return true;
  }
  if (/^[A-Za-z]:[\\\\/]/.test(path)) {
    return true;
  }
  const segments = path.split(/[/\\]/);
  return segments.some((s) => s === '..');
}

// Validates the model's project JSON: object shape, string contents,
// traversal-safe relative paths, a pom.xml, and at least one @Entity file.
// A deviating projectName is defaulted, not rejected.
export function validateSpringProject(raw: unknown): SpringProject {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SpringExportValidationError('response is not a JSON object');
  }
  const obj = raw as { projectName?: unknown; files?: unknown };
  if (!Array.isArray(obj.files) || obj.files.length === 0) {
    throw new SpringExportValidationError('files must be a non-empty array');
  }
  const files: GeneratedFile[] = [];
  let hasPom = false;
  let hasEntity = false;
  let hasReadme = false;
  for (const entry of obj.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new SpringExportValidationError('files entries must be objects');
    }
    const file = entry as { path?: unknown; content?: unknown };
    if (typeof file.path !== 'string' || file.path === '') {
      throw new SpringExportValidationError(
        'file path must be a non-empty string',
      );
    }
    if (typeof file.content !== 'string') {
      throw new SpringExportValidationError(
        `content of "${file.path}" is not a string`,
      );
    }
    if (isUnsafePath(file.path)) {
      throw new SpringExportValidationError(
        `file path "${file.path}" is not a safe relative path`,
      );
    }
    const normalized = file.path.replace(/\\/g, '/');
    if (normalized === 'pom.xml') {
      hasPom = true;
    }
    if (normalized === 'README.md') {
      hasReadme = true;
    }
    if (file.content.includes('@Entity')) {
      hasEntity = true;
    }
    files.push({ path: normalized, content: file.content });
  }
  if (!hasPom) {
    throw new SpringExportValidationError('no pom.xml in the generated files');
  }
  if (!hasEntity) {
    throw new SpringExportValidationError(
      'no JPA entity file in the generated files',
    );
  }
  if (!hasReadme) {
    throw new SpringExportValidationError(
      'no root README.md file in the generated files',
    );
  }
  return { projectName: PROJECT_NAME, files };
}

@Injectable()
export class SpringExportService {
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.openai = new OpenAI({
      baseURL: config.get<string>('OPENAI_SERVER_URL'),
      apiKey: config.get<string>('OPENAI_API_KEY'),
    });
    this.model = config.get<string>('OPENAI_MODEL') ?? '';
  }

  // Diagram document -> Spring Boot project zip buffer, via the layered
  // compliance strategy: strict prompt + json_schema response format,
  // scrubbing, validation, and at most one repair retry with the failure
  // reason echoed back. A second failure surfaces as a 400.
  async exportSpringBoot(diagram: DiagramDocument): Promise<Buffer> {
    if (!diagram.elements.some((e) => e.kind === 'class')) {
      throw new BadRequestException('the diagram has no classes to export');
    }
    let messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: EXPORT_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(diagram) },
    ];
    let reason: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { content, finishReason } = await this.chatCompletion(messages);
      if (finishReason === 'length') {
        // Temperature 0 would reproduce the same truncation; no retry.
        throw new BadRequestException(
          'the diagram is too large to export as a Spring Boot project',
        );
      }
      try {
        const project = validateSpringProject(
          JSON.parse(scrubJsonResponse(content)),
        );
        return await this.zipProject(project);
      } catch (error) {
        if (
          error instanceof SpringExportValidationError ||
          error instanceof SyntaxError
        ) {
          reason =
            error instanceof Error
              ? error.message
              : 'response was not valid project JSON';
          messages = [
            ...messages,
            { role: 'assistant', content },
            {
              role: 'user',
              content: `${REPAIR_PREFIX}${reason}. Return a corrected JSON object that exactly follows the schema. Respond with JSON only.`,
            },
          ];
          continue;
        }
        throw error;
      }
    }
    throw new BadRequestException(
      `the AI response could not be converted into a Spring Boot project: ${reason}`,
    );
  }

  // Assembles every generated file under a single spring-boot-project/
  // root prefix so unzipping yields one folder.
  private async zipProject(project: SpringProject): Promise<Buffer> {
    const zip = new JSZip();
    const root = zip.folder(PROJECT_NAME);
    if (!root) {
      throw new Error('could not create zip root');
    }
    for (const file of project.files) {
      root.file(file.path, file.content);
    }
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  private async chatCompletion(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
  ): Promise<{ content: string; finishReason: string | null }> {
    const params = {
      model: this.model,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      messages,
      ...(USE_JSON_SCHEMA_RESPONSE
        ? { response_format: this.projectJsonSchema }
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
    const choice = completion.choices?.[0];
    const message = choice?.message;
    return {
      content: typeof message?.content === 'string' ? message.content : '',
      finishReason: choice?.finish_reason ?? null,
    };
  }

  private readonly projectJsonSchema = {
    type: 'json_schema' as const,
    json_schema: {
      name: 'spring_boot_project',
      schema: {
        type: 'object',
        properties: {
          projectName: { type: 'string' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['projectName', 'files'],
      },
    },
  };
}
