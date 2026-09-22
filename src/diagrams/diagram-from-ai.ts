import { randomUUID } from 'crypto';
import {
  ClassAttribute,
  ClassElement,
  ClassOperation,
  DiagramDocument,
  RelationshipElement,
  RelationshipKind,
} from './diagram.types';
import { GRID_CELL_H, GRID_CELL_W, GRID_COLS } from './xmi-importer';

// Raised when the model's response cannot be turned into a diagram
// document. The message is the failure reason echoed back to the model on
// the single repair retry; a second failure surfaces as a 400.
export class AiDiagramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiDiagramError';
  }
}

const SUPPORTED_KINDS: RelationshipKind[] = [
  'association',
  'generalization',
  'composition',
  'aggregation',
];

// Extracts the JSON object from a raw model response that may be wrapped
// in markdown code fences and/or stray prose: strips ``` fences, then
// slices the first balanced `{...}` block (string-aware).
export function scrubJsonResponse(raw: string): string {
  let text = raw;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1];
  }
  const start = text.indexOf('{');
  if (start === -1) {
    return text;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return text.slice(start);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function attributes(list: unknown): ClassAttribute[] {
  if (!Array.isArray(list)) {
    return [];
  }
  const out: ClassAttribute[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const raw = entry as RawAttribute;
    out.push({ id: randomUUID(), name: str(raw.name), type: str(raw.type) });
  }
  return out;
}

function operations(list: unknown): ClassOperation[] {
  if (!Array.isArray(list)) {
    return [];
  }
  const out: ClassOperation[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const raw = entry as RawOperation;
    out.push({
      id: randomUUID(),
      name: str(raw.name),
      returnType: str(raw.returnType),
    });
  }
  return out;
}

interface RawAttribute {
  name?: unknown;
  type?: unknown;
}

interface RawOperation {
  name?: unknown;
  returnType?: unknown;
}

interface RawClass {
  name?: unknown;
  attributes?: unknown;
  operations?: unknown;
}

interface RawRelationship {
  kind?: unknown;
  from?: unknown;
  to?: unknown;
  name?: unknown;
  fromMultiplicity?: unknown;
  toMultiplicity?: unknown;
}

// Coerces the simplified AI diagram JSON (design D2/D5) into a full
// DiagramDocument. Pure and total on valid input: assigns randomUUID ids,
// lays classes out on the shared grid in order, resolves name-based
// relationship references (case-insensitive fallback), drops dangling or
// unknown-kind relationships, keeps the first of duplicate class names, and
// defaults missing arrays/strings to [] / "".
export function coerceAiDiagram(modelJson: unknown): DiagramDocument {
  if (!modelJson || typeof modelJson !== 'object' || Array.isArray(modelJson)) {
    throw new AiDiagramError('response is not a JSON object');
  }
  const raw = modelJson as {
    diagramName?: unknown;
    packageName?: unknown;
    classes?: unknown;
    relationships?: unknown;
  };
  if (!Array.isArray(raw.classes)) {
    raw.classes = [];
  }
  if (!Array.isArray(raw.relationships)) {
    raw.relationships = [];
  }

  const byName = new Map<string, ClassElement>();
  const lowerMap = new Map<string, ClassElement>();
  const elements: ClassElement[] = [];
  for (const entry of (raw.classes ?? []) as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new AiDiagramError('classes entries must be objects');
    }
    const rawClass = entry as RawClass;
    if (typeof rawClass.name !== 'string') {
      throw new AiDiagramError('class name must be a string');
    }
    if (byName.has(rawClass.name)) {
      // Duplicate class names: keep the first occurrence; later
      // references (exact or case-insensitive) resolve to it.
      continue;
    }
    const element: ClassElement = {
      id: randomUUID(),
      kind: 'class',
      name: rawClass.name,
      x: (elements.length % GRID_COLS) * GRID_CELL_W,
      y: Math.floor(elements.length / GRID_COLS) * GRID_CELL_H,
      attributes: attributes(rawClass.attributes),
      operations: operations(rawClass.operations),
    };
    byName.set(element.name, element);
    if (!lowerMap.has(element.name.toLowerCase())) {
      lowerMap.set(element.name.toLowerCase(), element);
    }
    elements.push(element);
  }

  const resolve = (ref: unknown): ClassElement | undefined => {
    if (typeof ref !== 'string' || ref === '') {
      return undefined;
    }
    return byName.get(ref) ?? lowerMap.get(ref.toLowerCase());
  };

  const relationships: RelationshipElement[] = [];
  for (const entry of (raw.relationships ?? []) as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      // Non-object relationship entries are dropped entirely.
      continue;
    }
    const rawRel = entry as RawRelationship;
    if (
      typeof rawRel.kind !== 'string' ||
      !SUPPORTED_KINDS.includes(rawRel.kind as RelationshipKind)
    ) {
      continue;
    }
    const source = resolve(rawRel.from);
    const target = resolve(rawRel.to);
    if (!source || !target) {
      continue;
    }
    relationships.push({
      id: randomUUID(),
      kind: rawRel.kind as RelationshipKind,
      name: str(rawRel.name),
      sourceId: source.id,
      targetId: target.id,
      sourceMultiplicity: str(rawRel.fromMultiplicity),
      targetMultiplicity: str(rawRel.toMultiplicity),
    });
  }

  return {
    packageName: str(raw.packageName),
    diagramName: str(raw.diagramName),
    elements,
    relationships,
  };
}
