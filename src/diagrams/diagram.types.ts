// Diagram document model shared by the realtime gateway, the XMI exporter,
// and (mirrored on) the frontend client. Stored as JSONB on the project.

export type RelationshipKind =
  | 'association'
  | 'generalization'
  | 'composition'
  | 'aggregation'
  | 'realization';

export interface ClassAttribute {
  id: string;
  name: string;
  type: string;
}

export interface ClassOperation {
  id: string;
  name: string;
  returnType: string;
}

export interface ClassElement {
  id: string;
  kind: 'class';
  name: string;
  x: number;
  y: number;
  attributes: ClassAttribute[];
  operations: ClassOperation[];
}

export interface RelationshipElement {
  id: string;
  kind: RelationshipKind;
  name: string;
  sourceId: string;
  targetId: string;
  sourceMultiplicity: string;
  targetMultiplicity: string;
  // Association-class tie: id of the class element attached to this
  // association. Absent on every other relationship.
  associationClassId?: string;
}

export type DiagramElement = ClassElement;
export type DiagramRelationship = RelationshipElement;

export interface DiagramDocument {
  packageName: string;
  diagramName: string;
  elements: ClassElement[];
  relationships: RelationshipElement[];
}

export function emptyDiagram(): DiagramDocument {
  return { packageName: '', diagramName: '', elements: [], relationships: [] };
}

// Coerces a value loaded from the JSONB column into a well-formed diagram
// document. Unknown shapes degrade to an empty diagram; partial shapes keep
// whatever valid elements/relationships are present. Metadata fields are
// kept when present (as strings) and left empty otherwise; the exporter
// applies fallbacks for empty values.
export function normalizeDiagram(stored: unknown): DiagramDocument {
  if (!stored || typeof stored !== 'object') {
    return emptyDiagram();
  }
  const s = stored as Partial<DiagramDocument>;
  const packageName = typeof s.packageName === 'string' ? s.packageName : '';
  const diagramName = typeof s.diagramName === 'string' ? s.diagramName : '';
  const elements = Array.isArray(s.elements) ? s.elements : [];
  const relationships = Array.isArray(s.relationships) ? s.relationships : [];
  return { packageName, diagramName, elements, relationships };
}

// Edit operations. The gateway applies these to the authoritative document.
export type DiagramOp =
  UpsertElementOp | UpsertRelationshipOp | MoveOp | DeleteOp | UpdateMetaOp;

export interface UpsertElementOp {
  op: 'upsertElement';
  element: ClassElement;
}

export interface UpsertRelationshipOp {
  op: 'upsertRelationship';
  relationship: RelationshipElement;
}

export interface MoveOp {
  op: 'move';
  id: string;
  x: number;
  y: number;
}

export interface DeleteOp {
  op: 'delete';
  id: string;
}

export interface UpdateMetaOp {
  op: 'updateMeta';
  packageName?: string;
  diagramName?: string;
}

export const DIAGRAM_EVENT = {
  STATE: 'diagram:state',
  OP: 'diagram:op',
  PRESENCE_COUNT: 'presence:count',
  JOIN: 'join',
  SAVE_REQUEST: 'save:request',
  ELEMENT_LOCK: 'element:lock',
  ELEMENT_UNLOCK: 'element:unlock',
  ELEMENT_LOCKED: 'element:locked',
  ELEMENT_UNLOCKED: 'element:unlocked',
  ELEMENT_LOCK_DENIED: 'element:lock-denied',
} as const;
