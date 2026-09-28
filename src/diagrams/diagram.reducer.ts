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
      // Association-class delete closure, iterated to a fixed point:
      // 1. removing a relationship also removes its tied association class;
      // 2. removing an element also removes every relationship tied to it
      //    as an association class;
      // 3. removing an element also removes relationships referencing it as
      //    source/target (existing rule), and each such relationship takes
      //    its tied association class with it.
      const removedElements = new Set<string>([id]);
      const removedRelationships = new Set<string>();
      let changed = true;
      while (changed) {
        changed = false;
        for (const rel of doc.relationships) {
          if (removedRelationships.has(rel.id)) {
            continue;
          }
          const endpointGone =
            removedElements.has(rel.sourceId) ||
            removedElements.has(rel.targetId);
          const tiedClassGone =
            !!rel.associationClassId &&
            removedElements.has(rel.associationClassId);
          if (rel.id === id || endpointGone || tiedClassGone) {
            removedRelationships.add(rel.id);
            if (rel.associationClassId) {
              removedElements.add(rel.associationClassId);
            }
            changed = true;
          }
        }
      }
      doc.elements = doc.elements.filter((e) => !removedElements.has(e.id));
      doc.relationships = doc.relationships.filter(
        (r) => !removedRelationships.has(r.id),
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
