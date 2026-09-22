import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import {
  ClassAttribute,
  ClassElement,
  ClassOperation,
  DiagramDocument,
  RelationshipElement,
  RelationshipKind,
} from './diagram.types';

// Raised when an uploaded file is not importable. Every structural
// deviation (malformed XML, no UML model element, wrong package/diagram
// structure) maps to the single message `Wrong format`; the controller maps
// this to a 400 Bad Request.
export class XmiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmiParseError';
  }
}

const WRONG_FORMAT = 'Wrong format';

export interface XmiImportResult {
  name: string | null;
  packageName: string;
  diagramName: string;
  diagram: DiagramDocument;
}

// Deterministic grid layout constants: XMI carries no canvas layout, so
// imported classes are placed on a grid in their model order. Shared with
// the AI diagram coercion layer (diagram-from-ai.ts) so both importers
// produce identical layouts.
export const GRID_COLS = 4;
export const GRID_CELL_W = 260;
export const GRID_CELL_H = 180;
const COLS = GRID_COLS;
const CELL_W = GRID_CELL_W;
const CELL_H = GRID_CELL_H;

type XmlNode = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function attrs(node: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as XmlNode)) {
      if (key.startsWith('@_')) {
        out[key.slice(2)] = String(value);
      }
    }
  }
  return out;
}

function child(node: unknown, tag: string): unknown {
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  return (node as XmlNode)[tag];
}

// Lightweight well-formedness check: fast-xml-parser is tolerant by design,
// so we balance tags ourselves to detect malformed XML before parsing.
function assertWellFormed(xml: string): void {
  const stripped = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>|\x3c![A-Z]+[^>]*>/g, '');
  const tagRe = /<(\/)?([A-Za-z_][\w.:-]*)([^>]*?)(\/)?>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(stripped)) !== null) {
    const [, closing, name, , selfClosing] = match;
    if (closing) {
      if (stack.pop() !== name) {
        throw new XmiParseError(WRONG_FORMAT);
      }
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  if (stack.length > 0) {
    throw new XmiParseError(WRONG_FORMAT);
  }
}

// Finds the UML model element anywhere in the parsed document. Namespace
// prefixes are matched by name (uml:, UML:) plus the plain `Model` tag,
// matching EA's fixed conventions.
function findModel(node: unknown): unknown {
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findModel(item);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (key.startsWith('@_')) {
      continue;
    }
    const local = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    if (local === 'Model' && value && typeof value === 'object') {
      return value;
    }
    const found = findModel(value);
    if (found) {
      return found;
    }
  }
  return undefined;
}

// Collects every element carrying an xmi:id (classes, primitive types,
// association end properties, ...) into an id -> node map.
function collectIdMap(node: unknown, map: Map<string, unknown>): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectIdMap(item, map);
    }
    return;
  }
  const a = attrs(node);
  if (a['xmi:id']) {
    map.set(a['xmi:id'], node);
  }
  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (!key.startsWith('@_')) {
      collectIdMap(value, map);
    }
  }
}

function formatMultiplicity(
  lower: string | undefined,
  upper: string | undefined,
): string {
  const l = lower?.trim();
  const u = upper?.trim();
  if (!l && !u) {
    return '';
  }
  if (!l) {
    return u;
  }
  if (!u) {
    return l;
  }
  if (l === u) {
    return l;
  }
  return `${l}..${u}`;
}

// Reads an association end's multiplicity, supporting both nested
// lowerValue/upperValue entries and direct lower/upper attributes.
function endMultiplicity(endNode: unknown): string {
  const a = attrs(endNode);
  let lower = a.lower;
  let upper = a.upper;
  const lowerNode = child(endNode, 'lowerValue');
  if (lowerNode) {
    lower = attrs(asArray(lowerNode)[0]).value ?? lower;
  }
  const upperNode = child(endNode, 'upperValue');
  if (upperNode) {
    upper = attrs(asArray(upperNode)[0]).value ?? upper;
  }
  return formatMultiplicity(lower, upper);
}

// Collects every descendant whose local tag name matches `localName`.
function findAllByLocalName(
  node: unknown,
  localName: string,
  out: unknown[] = [],
): unknown[] {
  if (!node || typeof node !== 'object') {
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      findAllByLocalName(item, localName, out);
    }
    return out;
  }
  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (key.startsWith('@_')) {
      continue;
    }
    const local = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    if (local === localName) {
      asArray(value as unknown).forEach((v) => out.push(v));
      // Also recurse inside matches: a nested `diagrams` would be odd, but
      // packages nest by design and must all be counted.
      findAllByLocalName(value, localName, out);
    } else {
      findAllByLocalName(value, localName, out);
    }
  }
  return out;
}

// Collects `packagedElement` nodes with xmi:type="uml:Package" anywhere in
// the given subtree (nested packages included). Scoped to the model element
// by the caller, so packages inside an xmi:Extension sibling (EA's
// EA_Java_Types_Package among them) are excluded from the strict
// single-package validation.
function collectPackages(node: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') {
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    for (const [key, value] of Object.entries(n as XmlNode)) {
      if (key.startsWith('@_')) {
        continue;
      }
      const local = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
      if (local === 'packagedElement') {
        for (const el of asArray(value as unknown)) {
          if (attrs(el)['xmi:type'] === 'uml:Package') {
            out.push(el);
          }
          walk(el);
        }
      } else {
        walk(value);
      }
    }
  };
  walk(node);
  return out;
}

// Collects every `<diagram>` entry of any type across all `diagrams`
// sections in the document (EA stores them inside xmi:Extension). Returns
// the entries themselves so the caller can validate count, type, and
// ownership. A diagram whose `properties type` is missing counts as
// Logical (EA's convention when the attribute is absent).
interface DiagramEntry {
  node: unknown;
  type: string; // '' means missing (counts as Logical)
  name: string; // properties name, '' when missing
  modelPackage: string; // model node's package attribute, '' when missing
}

function collectDiagramEntries(doc: unknown): DiagramEntry[] {
  const out: DiagramEntry[] = [];
  const diagramsNodes = findAllByLocalName(doc, 'diagrams');
  for (const diagrams of diagramsNodes) {
    for (const diagram of asArray(child(diagrams, 'diagram'))) {
      const props = asArray(child(diagram, 'properties'))[0];
      const propAttrs = props ? attrs(props) : {};
      const modelNode = asArray(child(diagram, 'model'))[0];
      const modelAttrs = modelNode ? attrs(modelNode) : {};
      out.push({
        node: diagram,
        type: propAttrs.type ?? '',
        name: propAttrs.name ?? '',
        modelPackage: modelAttrs.package ?? '',
      });
    }
  }
  return out;
}

// An attribute's type: the `type` attribute when present, otherwise the
// nested `<type xmi:idref>` element EA serializes.
function attributeType(
  attrNode: unknown,
  a: Record<string, string>,
): string | undefined {
  if (a.type) {
    return a.type;
  }
  const typeChild = asArray(child(attrNode, 'type'))[0];
  return typeChild ? attrs(typeChild)['xmi:idref'] : undefined;
}

// Parses EA-compatible UML 2 XMI (XMI 2.1 dialect) into a diagram document.
// The inverse of XmiExporter: pure, tolerant of unknown elements, and
// deterministic (grid layout derived from model order).
@Injectable()
export class XmiImporter {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
  });

  parse(xml: string): XmiImportResult {
    assertWellFormed(xml);
    let doc: unknown;
    try {
      doc = this.parser.parse(xml);
    } catch {
      throw new XmiParseError(WRONG_FORMAT);
    }
    const model = findModel(doc);
    if (!model) {
      throw new XmiParseError(WRONG_FORMAT);
    }
    const modelAttrs = attrs(model);

    // Strict format gate: exactly one package inside the model, containing
    // exactly one class (Logical) diagram owned by that package. Every
    // deviation is rejected with the single `Wrong format` error.
    const packages = collectPackages(model);
    if (packages.length !== 1) {
      throw new XmiParseError(WRONG_FORMAT);
    }
    const pkg = packages[0];
    const pkgAttrs = attrs(pkg);
    const diagrams = collectDiagramEntries(doc);
    if (diagrams.length !== 1) {
      throw new XmiParseError(WRONG_FORMAT);
    }
    const diagramEntry = diagrams[0];
    // A missing type counts as Logical (EA's convention).
    if (diagramEntry.type && diagramEntry.type !== 'Logical') {
      throw new XmiParseError(WRONG_FORMAT);
    }
    if (diagramEntry.modelPackage !== pkgAttrs['xmi:id']) {
      throw new XmiParseError(WRONG_FORMAT);
    }

    // Name resolution: package name first (EA files would otherwise all be
    // "EA_Model"), then the model name, then null (the controller applies a
    // timestamped default). The borrowed package/diagram names are stored
    // on the document so a re-export reproduces them.
    let name: string | null = null;
    const pkgName = pkgAttrs.name;
    const packageName = pkgName && pkgName.trim() !== '' ? pkgName : '';
    if (packageName) {
      name = packageName;
    } else if (modelAttrs.name && modelAttrs.name.trim() !== '') {
      name = modelAttrs.name;
    }
    const diagramName =
      diagramEntry.name && diagramEntry.name.trim() !== ''
        ? diagramEntry.name
        : 'New Class Diagram';

    const idMap = new Map<string, unknown>();
    collectIdMap(model, idMap);
    // Primitive types are declared in the extension block's `primitivetypes`
    // section, outside the model; include them so `EAJava_*` type references
    // resolve to their raw names. Only this subtree is added, so
    // `collectPackages`' model-scoped package validation is unaffected.
    for (const primitives of findAllByLocalName(doc, 'primitivetypes')) {
      collectIdMap(primitives, idMap);
    }

    const resolveType = (type: string | undefined): string => {
      if (!type) {
        return '';
      }
      const key = type.startsWith('#') ? type.slice(1) : type;
      const referenced = idMap.get(key);
      if (referenced) {
        const refName = attrs(referenced).name;
        if (refName) {
          return refName;
        }
      }
      return type;
    };

    // Classes and relationships live in the single package (EA's shape).
    const contentRoot = pkg;
    const packaged = asArray(child(contentRoot, 'packagedElement'));
    const classNodes = packaged.filter(
      (el) => attrs(el)['xmi:type'] === 'uml:Class',
    );
    const classByXmiId = new Map<string, ClassElement>();

    classNodes.forEach((classNode, index) => {
      const a = attrs(classNode);
      const xmiId = a['xmi:id'] ?? '';
      const element: ClassElement = {
        id: randomUUID(),
        kind: 'class',
        name: a.name ?? '',
        x: (index % COLS) * CELL_W,
        y: Math.floor(index / COLS) * CELL_H,
        attributes: this.parseAttributes(classNode, resolveType),
        operations: this.parseOperations(classNode, resolveType),
      };
      classByXmiId.set(xmiId, element);
    });

    const relationships: RelationshipElement[] = [];
    const findClass = (xmiId: string | undefined): ClassElement | undefined =>
      xmiId ? classByXmiId.get(xmiId) : undefined;

    // Nested generalizations: <generalization general="..."/> inside a class.
    for (const classNode of classNodes) {
      const a = attrs(classNode);
      const source = classByXmiId.get(a['xmi:id'] ?? '');
      if (!source) {
        continue;
      }
      for (const gen of asArray(child(classNode, 'generalization'))) {
        const target = findClass(attrs(gen).general);
        if (source && target) {
          relationships.push({
            id: randomUUID(),
            kind: 'generalization',
            name: attrs(gen).name ?? '',
            sourceId: source.id,
            targetId: target.id,
            sourceMultiplicity: '',
            targetMultiplicity: '',
          });
        }
      }
    }

    // Standalone generalizations and associations among packaged elements.
    for (const el of packaged) {
      const a = attrs(el);
      if (a['xmi:type'] === 'uml:Generalization') {
        const source = findClass(a.specific);
        const target = findClass(a.general);
        if (source && target) {
          relationships.push({
            id: randomUUID(),
            kind: 'generalization',
            name: a.name ?? '',
            sourceId: source.id,
            targetId: target.id,
            sourceMultiplicity: '',
            targetMultiplicity: '',
          });
        }
      } else if (a['xmi:type'] === 'uml:Association') {
        const rel = this.parseAssociation(el, a, idMap, findClass);
        if (rel) {
          relationships.push(rel);
        }
      }
    }

    return {
      name,
      packageName,
      diagramName,
      diagram: {
        packageName,
        diagramName,
        elements: [...classByXmiId.values()],
        relationships,
      },
    };
  }

  private parseAttributes(
    classNode: unknown,
    resolveType: (type: string | undefined) => string,
  ): ClassAttribute[] {
    const out: ClassAttribute[] = [];
    for (const attrNode of asArray(child(classNode, 'ownedAttribute'))) {
      const a = attrs(attrNode);
      if (a.association) {
        // This is an association member end owned by the class (EA
        // variance), not a structural attribute; skip it here.
        continue;
      }
      out.push({
        id: randomUUID(),
        name: a.name ?? '',
        type: resolveType(attributeType(attrNode, a)),
      });
    }
    return out;
  }

  private parseOperations(
    classNode: unknown,
    resolveType: (type: string | undefined) => string,
  ): ClassOperation[] {
    const out: ClassOperation[] = [];
    for (const opNode of asArray(child(classNode, 'ownedOperation'))) {
      const a = attrs(opNode);
      let returnType = a.type;
      for (const param of asArray(child(opNode, 'ownedParameter'))) {
        const p = attrs(param);
        if (p.direction === 'return') {
          returnType = p.type;
          break;
        }
      }
      out.push({
        id: randomUUID(),
        name: a.name ?? '',
        returnType: resolveType(returnType),
      });
    }
    return out;
  }

  private parseAssociation(
    assocNode: unknown,
    assocAttrs: Record<string, string>,
    modelIdMap: Map<string, unknown>,
    findClass: (xmiId: string | undefined) => ClassElement | undefined,
  ): RelationshipElement | null {
    // End ids come from the whitespace-separated `memberEnd` attribute and,
    // in EA's dialect, from nested <memberEnd xmi:idref="..."/> elements.
    const endIds = [
      ...(assocAttrs.memberEnd ?? '').split(/\s+/).filter((id) => id !== ''),
      ...asArray(child(assocNode, 'memberEnd'))
        .map((n) => attrs(n)['xmi:idref'])
        .filter((id): id is string => !!id),
    ];
    const idMap = new Map<string, unknown>();
    collectIdMap(assocNode, idMap);

    interface ResolvedEnd {
      element: ClassElement;
      aggregation: string;
      multiplicity: string;
    }
    const ends: ResolvedEnd[] = [];
    for (const endId of endIds) {
      // Ends may be nested ownedEnds of the association or ownedAttribute
      // members of the participating classes (EA variance); check both.
      const endNode = idMap.get(endId) ?? modelIdMap.get(endId);
      if (!endNode) {
        continue;
      }
      const a = attrs(endNode);
      // The end's class is referenced via a `type` attribute or, in EA's
      // dialect, via a nested <type xmi:idref="..."/> child.
      let typeRef = a.type;
      if (!typeRef) {
        const typeChild = asArray(child(endNode, 'type'))[0];
        typeRef = typeChild ? attrs(typeChild)['xmi:idref'] : undefined;
      }
      const element = findClass(typeRef);
      if (!element) {
        // Dangling end: the referenced class is absent from the model, so
        // the whole relationship is dropped per spec.
        return null;
      }
      ends.push({
        element,
        aggregation: a.aggregation ?? 'none',
        multiplicity: endMultiplicity(endNode),
      });
    }
    if (ends.length < 2) {
      return null;
    }

    let kind: RelationshipKind = 'association';
    let source = ends[0];
    let target = ends[1];
    const aggregating = ends.find(
      (end) => end.aggregation === 'composite' || end.aggregation === 'shared',
    );
    if (aggregating) {
      kind =
        aggregating.aggregation === 'composite' ? 'composition' : 'aggregation';
      source = aggregating;
      target = ends.find((end) => end !== aggregating) ?? ends[1];
    }

    return {
      id: randomUUID(),
      kind,
      name: assocAttrs.name ?? '',
      sourceId: source.element.id,
      targetId: target.element.id,
      sourceMultiplicity: source.multiplicity,
      targetMultiplicity: target.multiplicity,
    };
  }
}
