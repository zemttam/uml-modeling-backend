import { ClassElement, DiagramDocument, DiagramOp } from './diagram.types';

// Applies a single edit op to the authoritative in-memory diagram document.
// Mutates `doc` in place. Used by the realtime gateway and covered by unit tests.
export function applyOp(doc: DiagramDocument, op: DiagramOp): void {
  switch (op.op) {
    case 'upsertElement': {
      const idx = doc.elements.findIndex((e) => e.id === op.element.id);
      if (idx >= 0) {
        doc.elements[idx] = op.element;
      } else {
        doc.elements.push(op.element);
      }
      break;
    }
    case 'upsertRelationship': {
      const idx = doc.relationships.findIndex(
        (r) => r.id === op.relationship.id,
      );
      if (idx >= 0) {
        doc.relationships[idx] = op.relationship;
      } else {
        doc.relationships.push(op.relationship);
      }
      break;
    }
    case 'move': {
      const el = doc.elements.find((e) => e.id === op.id);
      if (el) {
        el.x = op.x;
        el.y = op.y;
      }
      break;
    }
    case 'delete': {
      const id = op.id;
      // Remove the element with this id (if any) and cascade-delete any
      // relationship that references it as source or target. If the id
      // belongs to a relationship, that relationship is removed directly.
      doc.elements = doc.elements.filter((e) => e.id !== id);
      doc.relationships = doc.relationships.filter(
        (r) => r.id !== id && r.sourceId !== id && r.targetId !== id,
      );
      break;
    }
    case 'updateMeta': {
      // Partial update: only the fields provided on the op are applied.
      if (op.packageName !== undefined) {
        doc.packageName = op.packageName;
      }
      if (op.diagramName !== undefined) {
        doc.diagramName = op.diagramName;
      }
      break;
    }
    default: {
      // exhaustive guard: unknown ops are ignored
      break;
    }
  }
}

// Returns a shallow-cloned copy of the document (used when a snapshot must be
// handed to a client without sharing the mutable authoritative instance).
export function cloneDocument(doc: DiagramDocument): DiagramDocument {
  return {
    packageName: doc.packageName,
    diagramName: doc.diagramName,
    elements: doc.elements.map((e: ClassElement) => ({
      ...e,
      attributes: e.attributes.map((a) => ({ ...a })),
      operations: e.operations.map((o) => ({ ...o })),
    })),
    relationships: doc.relationships.map((r) => ({ ...r })),
  };
}
