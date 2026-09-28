import { Injectable } from '@nestjs/common';
import {
  ClassElement,
  DiagramDocument,
  RelationshipElement,
  RelationshipKind,
} from './diagram.types';

function esc(value: string): string {
  return value
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;');
}

// A multiplicity bound, classified so the emitter can pick the EA value
// convention: `*` becomes an unlimited natural (-1), anything else is
// written as a finite literal integer.
type MultBound = { kind: 'unlimited' } | { kind: 'integer'; value: string };

interface MultBounds {
  lower: MultBound;
  upper: MultBound;
}

function parseBound(token: string): MultBound {
  const t = token.trim();
  if (t === '*') {
    return { kind: 'unlimited' };
  }
  return { kind: 'integer', value: t };
}

function parseMultiplicity(value: string | undefined): MultBounds | null {
  if (!value || value.trim() === '') {
    return null;
  }
  const v = value.trim();
  if (v === '*') {
    // EA writes a bare `*` as both bounds unlimited (-1 / -1).
    return { lower: { kind: 'unlimited' }, upper: { kind: 'unlimited' } };
  }
  const dot = v.indexOf('..');
  if (dot >= 0) {
    return {
      lower: parseBound(v.slice(0, dot)),
      upper: parseBound(v.slice(dot + 2)),
    };
  }
  const bound = parseBound(v);
  return { lower: bound, upper: bound };
}

function aggregationKind(kind: RelationshipKind): string {
  switch (kind) {
    case 'composition':
      return 'composite';
    case 'aggregation':
      return 'shared';
    default:
      return 'none';
  }
}

// EA-style identifier: the UUID written as underscore-separated uppercase
// hex, so EA can resolve the text after the EAID_/EAPK_ prefix as a GUID.
function uuidHex(uuid: string): string {
  return uuid.replace(/-/g, '_').toUpperCase();
}

function eaId(prefix: string, uuid: string): string {
  return `${prefix}_${uuidHex(uuid)}`;
}

// The trailing GUID segments (everything after the first segment) in EA's
// underscore-separated form, as used by the RT000000/RETURNID/LI id schemes
// where EA replaces or prefixes only the first segment.
function guidRestHex(uuid: string): string {
  const dash = uuid.indexOf('-');
  return uuidHex(dash >= 0 ? uuid.slice(dash + 1) : uuid);
}

function guidRestDashed(uuid: string): string {
  const dash = uuid.indexOf('-');
  return (dash >= 0 ? uuid.slice(dash + 1) : uuid).toUpperCase();
}

// EA's primitive-type identifier for a stored type string: every
// non-alphanumeric character is replaced by `_`. Types are free strings,
// so any value produces a valid identifier; the raw string is preserved as
// the declared primitive's name.
function primitiveTypeId(type: string): string {
  return `EAJava_${type.replace(/[^A-Za-z0-9]/g, '_')}`;
}

// Distinct type strings used by the diagram's attributes and operation
// return types, in document order of first appearance.
function collectPrimitiveTypes(diagram: DiagramDocument): string[] {
  const seen = new Set<string>();
  for (const cls of diagram.elements) {
    for (const attr of cls.attributes) {
      if (attr.type) {
        seen.add(attr.type);
      }
    }
    for (const op of cls.operations) {
      if (op.returnType) {
        seen.add(op.returnType);
      }
    }
  }
  return [...seen];
}

// Builtin generalization targets for EA's Java primitive types; every
// other type (void, free strings like Money, ...) defaults to String.
const PRIMITIVE_GENERALIZATION: Record<string, string> = {
  int: 'Integer',
  long: 'Integer',
  char: 'String',
  boolean: 'Boolean',
  float: 'Real',
  double: 'Real',
};

function generalizationTarget(type: string): string {
  return PRIMITIVE_GENERALIZATION[type] ?? 'String';
}

function liId(counter: number, attrId: string): string {
  return `EAID_LI${String(counter).padStart(6, '0')}_${guidRestHex(attrId)}`;
}

// Placeholder parent package EA reparents imported packages under.
const ROOT_PACKAGE_PARENT = 'EAPK_ROOTPKG_0000_0000_0000_000000000000';

// Fixed default class-element geometry (width x height) anchored at the
// stored canvas position; ClassElement carries no size of its own.
const CLASS_W = 160;
const CLASS_H = 80;
const EDGE_GEOMETRY =
  'EDGE=2;$LLB=;LLT=;LMT=;LMB=;LRT=;LRB=;IRHS=;ILHS=;Path=;';

// Deterministic per-element diagram style ids (DUID) derived from the
// element/relationship id, mimicking EA's `style="DUID=...;"` attribute.
function duid(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return String(Math.abs(hash));
}

function isAggregationKind(kind: RelationshipKind): boolean {
  return kind === 'composition' || kind === 'aggregation';
}

function connectorEaType(kind: RelationshipKind): string {
  switch (kind) {
    case 'generalization':
      return 'Generalization';
    case 'composition':
    case 'aggregation':
      return 'Aggregation';
    case 'realization':
      return 'Realisation';
    default:
      return 'Association';
  }
}

function linkTag(kind: RelationshipKind): string {
  switch (kind) {
    case 'generalization':
      return 'Generalization';
    case 'composition':
    case 'aggregation':
      return 'Aggregation';
    case 'realization':
      return 'Realisation';
    default:
      return 'Association';
  }
}

// Per-kind, per-end presentation of the extension-block connector ends,
// mirroring EA's own emissions for each relationship kind.
interface ConnectorEndStyle {
  aggregation: string;
  containment?: string;
  isNavigable: boolean;
  changeable: boolean;
  targetScope: boolean;
  styleValue: string;
}

const EA_NAV_STYLE = {
  nonNavigable:
    'Union=0;Derived=0;AllowDuplicates=0;Owned=0;Navigable=Non-Navigable;',
  navigable: 'Union=0;Derived=0;AllowDuplicates=0;Owned=0;Navigable=Navigable;',
  unspecified:
    'Union=0;Derived=0;AllowDuplicates=0;Owned=0;Navigable=Unspecified;',
  plain: 'Derived=0;DerivedUnion=0;Owned=0;Navigable=Unspecified;',
} as const;

function connectorEndStyle(
  rel: RelationshipElement,
  role: 'source' | 'target',
): ConnectorEndStyle {
  if (isAggregationKind(rel.kind) || rel.kind === 'realization') {
    const base = {
      containment: 'Unspecified',
      changeable: true,
      targetScope: true,
    };
    if (rel.kind === 'realization') {
      return role === 'target'
        ? {
            ...base,
            aggregation: 'none',
            isNavigable: true,
            styleValue: EA_NAV_STYLE.navigable,
          }
        : {
            ...base,
            aggregation: 'none',
            isNavigable: false,
            styleValue: EA_NAV_STYLE.nonNavigable,
          };
    }
    return role === 'target'
      ? {
          ...base,
          aggregation: aggregationKind(rel.kind),
          isNavigable: true,
          styleValue: EA_NAV_STYLE.navigable,
        }
      : {
          ...base,
          aggregation: 'none',
          isNavigable: false,
          styleValue: EA_NAV_STYLE.nonNavigable,
        };
  }
  if (rel.kind === 'association' && rel.associationClassId) {
    return {
      aggregation: 'none',
      containment: 'Unspecified',
      isNavigable: false,
      changeable: true,
      targetScope: true,
      styleValue: EA_NAV_STYLE.unspecified,
    };
  }
  return {
    aggregation: 'none',
    isNavigable: false,
    changeable: false,
    targetScope: false,
    styleValue: EA_NAV_STYLE.plain,
  };
}

// The connector `properties` attributes EA expects per kind.
function connectorPropertiesAttrs(rel: RelationshipElement): string {
  const eaType = connectorEaType(rel.kind);
  const attrs: string[] = [` ea_type="${esc(eaType)}"`];
  if (rel.kind === 'composition') {
    attrs.push(' subtype="Strong"');
  } else if (rel.kind === 'association' && rel.associationClassId) {
    attrs.push(' subtype="Class"');
    if (rel.name) {
      attrs.push(` name="${esc(rel.name)}"`);
    }
  }
  const direction =
    isAggregationKind(rel.kind) || rel.kind === 'realization'
      ? 'Source -> Destination'
      : 'Unspecified';
  attrs.push(` direction="${esc(direction)}"`);
  return attrs.join('');
}

// Serializes a stored class-diagram document to UML 2 XMI (XMI 2.1) in
// Enterprise Architect's dialect: an uml:Model root named EA_Model whose
// single uml:Package (named after the project) contains the packagedElement
// classes with ownedAttribute/ownedOperation, Generalization elements
// referencing the superclass as `general`, and Association elements whose
// member ends are nested memberEnd elements pointing at ownedEnd
// uml:Property entries (typed via nested <type xmi:idref/>) carrying
// aggregation kinds and multiplicities. All identifiers use EA's EAID_/EAPK_
// underscore-separated GUID format. An xmi:Extension block adds EA metadata:
// `elements` (with per-class relationship `links`), `connectors` (with EA's
// enriched source/target entries), the empty `primitivetypes`/`profiles`
// sections, and a single `Class Diagram` (type Logical) with an entry per
// element and relationship, so EA shows the full diagram on import. Pure and
// deterministic.
@Injectable()
export class XmiExporter {
  serialize(
    diagram: DiagramDocument,
    opts: { projectId: string; projectName: string },
  ): string {
    const packageId = eaId('EAPK', opts.projectId);
    const packageName = diagram.packageName || opts.projectName || 'Package';
    const diagramName = diagram.diagramName || 'New Class Diagram';
    const diagramId = eaId('EAID', opts.projectId);
    const parts: string[] = [];
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push(
      '<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">',
    );
    parts.push(
      '<xmi:Documentation exporter="Enterprise Architect" exporterVersion="6.5"/>',
    );
    parts.push(
      '<uml:Model xmi:type="uml:Model" name="EA_Model" visibility="public">',
    );
    parts.push(
      `<packagedElement xmi:type="uml:Package" xmi:id="${esc(packageId)}" name="${esc(packageName)}" visibility="public">`,
    );

    const generalizationsBySubclass = new Map<string, RelationshipElement[]>();
    // Aggregation-kind relationships whose target (whole) end is emitted as
    // an ownedAttribute of the source (part) class, mirroring EA's nesting.
    const aggregationsBySource = new Map<string, RelationshipElement[]>();
    const associations: RelationshipElement[] = [];
    const realizations: RelationshipElement[] = [];
    const tiedAssociations: RelationshipElement[] = [];
    const tiedRelByClassId = new Map<string, RelationshipElement>();
    for (const rel of diagram.relationships) {
      if (rel.kind === 'generalization') {
        const arr = generalizationsBySubclass.get(rel.sourceId) ?? [];
        arr.push(rel);
        generalizationsBySubclass.set(rel.sourceId, arr);
      } else if (rel.kind === 'realization') {
        realizations.push(rel);
      } else if (rel.associationClassId) {
        tiedAssociations.push(rel);
        tiedRelByClassId.set(rel.associationClassId, rel);
      } else {
        if (isAggregationKind(rel.kind)) {
          const arr = aggregationsBySource.get(rel.sourceId) ?? [];
          arr.push(rel);
          aggregationsBySource.set(rel.sourceId, arr);
        }
        associations.push(rel);
      }
    }

    let liCounter = 0;
    for (const cls of diagram.elements) {
      const classId = eaId('EAID', cls.id);
      parts.push(
        `<packagedElement xmi:type="uml:Class" xmi:id="${esc(classId)}" name="${esc(cls.name)}" visibility="public">`,
      );
      liCounter = this.renderClassMembers(parts, cls, liCounter);
      const gens = generalizationsBySubclass.get(cls.id) ?? [];
      for (const g of gens) {
        parts.push(
          `<generalization xmi:type="uml:Generalization" xmi:id="${esc(eaId('EAID', g.id))}" general="${esc(eaId('EAID', g.targetId))}"/>`,
        );
      }
      // EA nesting for composition/aggregation: the target (whole) end is an
      // ownedAttribute of the source (part) class carrying the association
      // reference; the association itself only owns the source (part) end.
      for (const rel of aggregationsBySource.get(cls.id) ?? []) {
        parts.push(
          this.renderClassOwnedEnd(
            `dst${rel.id}`,
            rel.targetId,
            eaId('EAID', rel.id),
            rel.targetMultiplicity,
          ),
        );
      }
      parts.push('</packagedElement>');
    }

    for (const rel of associations) {
      const assocId = eaId('EAID', rel.id);
      if (isAggregationKind(rel.kind)) {
        // EA convention: the target (whole) end is the first memberEnd and
        // is owned by the source class (emitted above); only the source
        // (part) end is association-owned, carrying the aggregation kind.
        parts.push(
          `<packagedElement xmi:type="uml:Association" xmi:id="${esc(assocId)}" name="${esc(rel.name)}" visibility="public">`,
        );
        parts.push(this.renderMemberEndRef(`dst${rel.id}`));
        parts.push(this.renderMemberEndRef(`src${rel.id}`));
        parts.push(
          this.renderOwnedEnd(
            `src${rel.id}`,
            rel.sourceId,
            assocId,
            aggregationKind(rel.kind),
            rel.sourceMultiplicity,
          ),
        );
        parts.push('</packagedElement>');
      } else {
        parts.push(
          `<packagedElement xmi:type="uml:Association" xmi:id="${esc(assocId)}" name="${esc(rel.name)}" visibility="public">`,
        );
        parts.push(
          this.renderEnd(
            `src${rel.id}`,
            rel.sourceId,
            assocId,
            'none',
            rel.sourceMultiplicity,
          ),
        );
        parts.push(
          this.renderEnd(
            `dst${rel.id}`,
            rel.targetId,
            assocId,
            'none',
            rel.targetMultiplicity,
          ),
        );
        parts.push('</packagedElement>');
      }
    }

    // Realizations: standalone uml:Realization packaged elements, client =
    // source class, supplier = target class (EA emits no name).
    for (const rel of realizations) {
      parts.push(
        `<packagedElement xmi:type="uml:Realization" xmi:id="${esc(eaId('EAID', rel.id))}" visibility="public" supplier="${esc(eaId('EAID', rel.targetId))}" client="${esc(eaId('EAID', rel.sourceId))}"/>`,
      );
    }

    // Association classes: a uml:AssociationClass carries the class's id and
    // name plus both participant ends; no separate uml:Association is
    // emitted for the tied association.
    for (const rel of tiedAssociations) {
      const cls = diagram.elements.find((e) => e.id === rel.associationClassId);
      if (!cls) {
        continue;
      }
      const assocClassId = eaId('EAID', cls.id);
      parts.push(
        `<packagedElement xmi:type="uml:AssociationClass" xmi:id="${esc(assocClassId)}" name="${esc(cls.name)}" visibility="public">`,
      );
      liCounter = this.renderClassMembers(parts, cls, liCounter);
      parts.push(this.renderMemberEndRef(`src${rel.id}`));
      parts.push(
        this.renderOwnedEnd(
          `src${rel.id}`,
          rel.sourceId,
          assocClassId,
          'none',
          rel.sourceMultiplicity,
        ),
      );
      parts.push(this.renderMemberEndRef(`dst${rel.id}`));
      parts.push(
        this.renderOwnedEnd(
          `dst${rel.id}`,
          rel.targetId,
          assocClassId,
          'none',
          rel.targetMultiplicity,
        ),
      );
      parts.push('</packagedElement>');
    }

    parts.push('</packagedElement>');
    parts.push('</uml:Model>');

    parts.push(
      '<xmi:Extension extender="Enterprise Architect" extenderID="6.5">',
    );
    this.renderExtensionElements(parts, diagram, packageId, packageName);
    this.renderExtensionConnectors(parts, diagram);
    parts.push('<primitivetypes>');
    parts.push(
      '<packagedElement xmi:type="uml:Package" xmi:id="EAPrimitiveTypesPackage" name="EA_PrimitiveTypes_Package" visibility="public">',
    );
    parts.push(
      '<packagedElement xmi:type="uml:Package" xmi:id="EAJavaTypesPackage" name="EA_Java_Types_Package" visibility="public">',
    );
    for (const type of collectPrimitiveTypes(diagram)) {
      const id = primitiveTypeId(type);
      parts.push(
        `<packagedElement xmi:type="uml:PrimitiveType" xmi:id="${esc(id)}" name="${esc(type)}" visibility="public">`,
      );
      parts.push(
        `<generalization xmi:type="uml:Generalization" xmi:id="${esc(`${id}_General`)}">`,
      );
      parts.push(
        `<general href="http://schema.omg.org/spec/UML/2.1/uml.xml#${generalizationTarget(type)}"/>`,
      );
      parts.push('</generalization>');
      parts.push('</packagedElement>');
    }
    parts.push('</packagedElement>');
    parts.push('</packagedElement>');
    parts.push('</primitivetypes>');
    parts.push('<profiles/>');
    this.renderExtensionDiagrams(
      parts,
      diagram,
      packageId,
      diagramId,
      diagramName,
    );
    parts.push('</xmi:Extension>');

    parts.push('</xmi:XMI>');
    return parts.join('\n');
  }

  private renderExtensionElements(
    parts: string[],
    diagram: DiagramDocument,
    packageId: string,
    packageName: string,
  ): void {
    parts.push('<elements>');
    parts.push(
      `<element xmi:idref="${esc(packageId)}" xmi:type="uml:Package" name="${esc(packageName)}" scope="public">`,
    );
    parts.push(
      `<model package2="${esc(packageId)}" package="${ROOT_PACKAGE_PARENT}" tpos="0" ea_eleType="package"/>`,
    );
    parts.push(
      '<properties isSpecification="false" sType="Package" nType="0" scope="public"/>',
    );
    parts.push('</element>');
    for (const cls of diagram.elements) {
      const classId = eaId('EAID', cls.id);
      const tiedRel = diagram.relationships.find(
        (rel) => rel.associationClassId === cls.id,
      );
      parts.push(
        `<element xmi:idref="${esc(classId)}" xmi:type="uml:Class" name="${esc(cls.name)}" scope="public">`,
      );
      parts.push(
        `<model package="${esc(packageId)}" tpos="0" ea_eleType="element"/>`,
      );
      parts.push(
        `<properties isSpecification="false" sType="Class" nType="${tiedRel ? '17' : '0'}" scope="public" isRoot="false" isLeaf="false" isAbstract="false" isActive="false"/>`,
      );
      if (cls.attributes.length > 0) {
        parts.push('<attributes>');
        for (const attr of cls.attributes) {
          parts.push(
            `<attribute xmi:idref="${esc(eaId('EAID', attr.id))}" name="${esc(attr.name)}" scope="Public">`,
          );
          parts.push(
            `<properties${attr.type ? ` type="${esc(attr.type)}"` : ''} derived="0" collection="false" duplicates="0" changeability="changeable"/>`,
          );
          parts.push('</attribute>');
        }
        parts.push('</attributes>');
      }
      if (cls.operations.length > 0) {
        parts.push('<operations>');
        for (const op of cls.operations) {
          parts.push(
            `<operation xmi:idref="${esc(eaId('EAID', op.id))}" name="${esc(op.name)}" scope="Public">`,
          );
          parts.push('<properties position="0"/>');
          if (op.returnType) {
            const restDashed = guidRestDashed(op.id);
            parts.push(
              `<type type="${esc(op.returnType)}" const="false" static="false" isAbstract="false" synchronised="0" pure="0" isQuery="false"/>`,
            );
            parts.push('<parameters>');
            parts.push(
              `<parameter xmi:idref="${esc(`EAID_RETURNID_${restDashed.replace(/-/g, '_')}`)}" visibility="public">`,
            );
            parts.push(
              `<properties pos="0" type="${esc(op.returnType)}" const="false" ea_guid="{RETURNID-${restDashed}}"/>`,
            );
            parts.push('</parameter>');
            parts.push('</parameters>');
          }
          parts.push('</operation>');
        }
        parts.push('</operations>');
      }
      const links = diagram.relationships.filter(
        (rel) => rel.sourceId === cls.id || rel.targetId === cls.id,
      );
      if (links.length > 0) {
        parts.push('<links>');
        for (const rel of links) {
          parts.push(
            `<${linkTag(rel.kind)} xmi:id="${esc(eaId('EAID', rel.id))}" start="${esc(eaId('EAID', rel.sourceId))}" end="${esc(eaId('EAID', rel.targetId))}"/>`,
          );
        }
        parts.push('</links>');
      }
      if (tiedRel) {
        // Association-class linkage: the class element references its tied
        // connector via conID.
        parts.push(
          `<extendedProperties tagged="0" conID="${esc(eaId('EAID', tiedRel.id))}"/>`,
        );
      }
      parts.push('</element>');
    }
    parts.push('</elements>');
  }

  private renderExtensionConnectors(
    parts: string[],
    diagram: DiagramDocument,
  ): void {
    // Sequential per-class local ids referenced by connector endpoints.
    const localIdByClass = new Map<string, number>();
    diagram.elements.forEach((cls, index) => {
      localIdByClass.set(cls.id, index + 1);
    });
    const classById = new Map(
      diagram.elements.map((cls) => [cls.id, cls] as const),
    );
    parts.push('<connectors>');
    for (const rel of diagram.relationships) {
      const relId = eaId('EAID', rel.id);
      parts.push(`<connector xmi:idref="${esc(relId)}">`);
      parts.push(
        this.renderConnectorEnd(
          rel.sourceId,
          localIdByClass,
          classById,
          'source',
          rel.sourceMultiplicity,
          connectorEndStyle(rel, 'source'),
        ),
      );
      parts.push(
        this.renderConnectorEnd(
          rel.targetId,
          localIdByClass,
          classById,
          'target',
          rel.targetMultiplicity,
          connectorEndStyle(rel, 'target'),
        ),
      );
      parts.push(`<properties${connectorPropertiesAttrs(rel)}/>`);
      parts.push(
        `<labels lb="${esc(rel.sourceMultiplicity ?? '')}" rb="${esc(rel.targetMultiplicity ?? '')}"/>`,
      );
      if (rel.associationClassId) {
        parts.push(
          `<extendedProperties virtualInheritance="0" associationclass="${esc(eaId('EAID', rel.associationClassId))}"/>`,
        );
      }
      parts.push('</connector>');
    }
    parts.push('</connectors>');
  }

  private renderConnectorEnd(
    classRefId: string,
    localIdByClass: Map<string, number>,
    classById: Map<string, { name: string }>,
    role: 'source' | 'target',
    multiplicity: string | undefined,
    style: ConnectorEndStyle,
  ): string {
    const classId = eaId('EAID', classRefId);
    const localId = localIdByClass.get(classRefId);
    const name = classById.get(classRefId)?.name ?? '';
    const p: string[] = [];
    p.push(`<${role} xmi:idref="${esc(classId)}">`);
    p.push(
      `<model ea_localid="${localId ?? 0}" type="Class" name="${esc(name)}"/>`,
    );
    p.push(
      `<role visibility="Public"${style.targetScope ? ' targetScope="instance"' : ''}/>`,
    );
    p.push(
      `<type${multiplicity ? ` multiplicity="${esc(multiplicity)}"` : ''} aggregation="${style.aggregation}"${style.containment ? ` containment="${style.containment}"` : ''}/>`,
    );
    p.push(
      `<modifiers isOrdered="false"${style.changeable ? ' changeable="none"' : ''} isNavigable="${style.isNavigable}"/>`,
    );
    p.push(`<style value="${style.styleValue}"/>`);
    p.push('<documentation/>');
    p.push('<xrefs/>');
    p.push('<tags/>');
    p.push(`</${role}>`);
    return p.join('');
  }

  private renderExtensionDiagrams(
    parts: string[],
    diagram: DiagramDocument,
    packageId: string,
    diagramId: string,
    diagramName: string,
  ): void {
    // Constant presentation hints copied from the EA reference export
    // (assets/project-1-fixed.xmi); EA needs these to surface the diagram.
    const STYLE1 =
      'ShowPrivate=1;ShowProtected=1;ShowPublic=1;HideRelationships=0;Locked=0;Border=1;HighlightForeign=1;PackageContents=1;SequenceNotes=0;ScalePrintImage=0;PPgs.cx=1;PPgs.cy=1;DocSize.cx=826;DocSize.cy=1169;ShowDetails=0;Orientation=P;Zoom=100;ShowTags=0;OpParams=1;VisibleAttributeDetail=0;ShowOpRetType=1;ShowIcons=1;CollabNums=0;HideProps=0;ShowReqs=0;ShowCons=0;PaperSize=9;HideParents=0;UseAlias=0;HideAtts=0;HideOps=0;HideStereo=0;HideElemStereo=0;ShowTests=0;ShowMaint=0;ConnectorNotation=UML 2.1;ExplicitNavigability=0;AdvancedElementProps=1;AdvancedFeatureProps=1;AdvancedConnectorProps=1;ShowNotes=0;SuppressBrackets=0;SuppConnectorLabels=0;PrintPageHeadFoot=0;ShowAsList=0;';
    const STYLE2 =
      'ExcludeRTF=0;DocAll=0;HideQuals=0;AttPkg=1;ShowTests=0;ShowMaint=0;SuppressFOC=1;MatrixActive=0;SwimlanesActive=1;KanbanActive=0;MatrixLineWidth=1;MatrixLineClr=0;MatrixLocked=0;TConnectorNotation=UML 2.1;TExplicitNavigability=0;AdvancedElementProps=1;AdvancedFeatureProps=1;AdvancedConnectorProps=1;ProfileData=;MDGDgm=;STBLDgm=;ShowNotes=0;VisibleAttributeDetail=0;ShowOpRetType=1;SuppressBrackets=0;SuppConnectorLabels=0;PrintPageHeadFoot=0;ShowAsList=0;SuppressedCompartments=;SaveTag=7E5514CC;';
    const SWIMLANES =
      'locked=false;orientation=0;width=0;inbar=false;names=false;color=-1;bold=false;fcol=0;tcol=-1;ofCol=-1;hl=1;cls=0;SwimlaneFont=lfh:-10,lfw:0,lfi:0,lfu:0,lfs:0,lfface:ARIAL,lfe:0,lfo:0,lfchar:1,lfop:0,lfcp:0,lfq:0,lfpf=0,lfWidth=0;';
    const MATRIXITEMS =
      'locked=false;matrixactive=false;swimlanesactive=true;kanbanactive=false;width=1;clrLine=0;';
    parts.push('<diagrams>');
    parts.push(`<diagram xmi:id="${esc(diagramId)}">`);
    parts.push(
      `<model package="${esc(packageId)}" localID="1" owner="${esc(packageId)}"/>`,
    );
    parts.push(`<properties name="${esc(diagramName)}" type="Logical"/>`);
    parts.push(
      '<project author="uml-modeler" version="1.0" created="2026-01-01 00:00:00" modified="2026-01-01 00:00:00"/>',
    );
    parts.push(`<style1 value="${esc(STYLE1)}"/>`);
    parts.push(`<style2 value="${esc(STYLE2)}"/>`);
    parts.push(`<swimlanes value="${esc(SWIMLANES)}"/>`);
    parts.push(`<matrixitems value="${esc(MATRIXITEMS)}"/>`);
    parts.push('<extendedProperties/>');
    parts.push('<elements>');
    let seq = 0;
    for (const cls of diagram.elements) {
      seq += 1;
      const left = Math.round(cls.x);
      const top = Math.round(cls.y);
      const right = Math.round(cls.x + CLASS_W);
      const bottom = Math.round(cls.y + CLASS_H);
      parts.push(
        `<element geometry="Left=${left};Top=${top};Right=${right};Bottom=${bottom};" subject="${esc(eaId('EAID', cls.id))}" seqno="${seq}" style="DUID=${duid(cls.id)};"/>`,
      );
    }
    for (const rel of diagram.relationships) {
      seq += 1;
      parts.push(
        `<element geometry="${esc(EDGE_GEOMETRY)}" subject="${esc(eaId('EAID', rel.id))}" seqno="${seq}" style="Mode=3;EOID=${duid(rel.targetId)};SOID=${duid(rel.sourceId)};Color=-1;LWidth=0;Hidden=0;"/>`,
      );
    }
    parts.push('</elements>');
    parts.push('</diagram>');
    parts.push('</diagrams>');
  }

  // The class's structural members (attributes, operations), shared by the
  // uml:Class and uml:AssociationClass serializations. Returns the advanced
  // liCounter.
  private renderClassMembers(
    parts: string[],
    cls: ClassElement,
    liCounter: number,
  ): number {
    for (const attr of cls.attributes) {
      liCounter += 1;
      parts.push(
        `<ownedAttribute xmi:type="uml:Property" xmi:id="${esc(eaId('EAID', attr.id))}" name="${esc(attr.name)}" visibility="public" isStatic="false" isReadOnly="false" isDerived="false" isOrdered="false" isUnique="true" isDerivedUnion="false">`,
      );
      parts.push(
        `<lowerValue xmi:type="uml:LiteralInteger" xmi:id="${esc(liId(liCounter, attr.id))}" value="1"/>`,
      );
      liCounter += 1;
      parts.push(
        `<upperValue xmi:type="uml:LiteralInteger" xmi:id="${esc(liId(liCounter, attr.id))}" value="1"/>`,
      );
      if (attr.type) {
        parts.push(`<type xmi:idref="${esc(primitiveTypeId(attr.type))}"/>`);
      }
      parts.push('</ownedAttribute>');
    }
    for (const op of cls.operations) {
      const opId = eaId('EAID', op.id);
      parts.push(
        `<ownedOperation xmi:id="${esc(opId)}" name="${esc(op.name)}" visibility="public">`,
      );
      if (op.returnType) {
        parts.push(
          `<ownedParameter xmi:id="${esc(`EAID_RT000000_${guidRestHex(op.id)}`)}" name="return" direction="return" type="${esc(primitiveTypeId(op.returnType))}"/>`,
        );
      }
      parts.push('</ownedOperation>');
    }
    return liCounter;
  }

  // One association end. EA's dialect serializes each member end as a
  // nested memberEnd reference followed by its end Property (typed via a
  // nested <type xmi:idref/> child, carrying lowerValue/upperValue
  // multiplicity bounds). Depending on the kind, the end Property is either
  // association-owned (ownedEnd), or — for the whole end of an
  // aggregation-kind relationship — an ownedAttribute of the part class.
  private endPropertyId(endKey: string): string {
    return `EAID_${endKey.slice(0, 3)}${uuidHex(endKey.slice(3))}`;
  }

  private renderMemberEndRef(endKey: string): string {
    return `<memberEnd xmi:idref="${esc(this.endPropertyId(endKey))}"/>`;
  }

  private renderOwnedEnd(
    endKey: string,
    classRefId: string,
    assocId: string,
    aggregation: string,
    multiplicity: string | undefined,
  ): string {
    return `<ownedEnd xmi:type="uml:Property" xmi:id="${esc(this.endPropertyId(endKey))}" visibility="public" association="${esc(assocId)}" isStatic="false" isReadOnly="false" isDerived="false" isOrdered="false" isUnique="true" isDerivedUnion="false" aggregation="${aggregation}">${this.renderEndBody(endKey, classRefId, multiplicity)}</ownedEnd>`;
  }

  // The whole end of an aggregation-kind relationship, nested inside the
  // part class as an ownedAttribute (EA's end-nesting convention).
  private renderClassOwnedEnd(
    endKey: string,
    classRefId: string,
    assocId: string,
    multiplicity: string | undefined,
  ): string {
    return `<ownedAttribute xmi:type="uml:Property" xmi:id="${esc(this.endPropertyId(endKey))}" visibility="public" association="${esc(assocId)}" isStatic="false" isReadOnly="false" isDerived="false" isOrdered="false" isUnique="true" isDerivedUnion="false" aggregation="none">${this.renderEndBody(endKey, classRefId, multiplicity)}</ownedAttribute>`;
  }

  private renderEndBody(
    endKey: string,
    classRefId: string,
    multiplicity: string | undefined,
  ): string {
    const parts: string[] = [];
    parts.push(`<type xmi:idref="${esc(eaId('EAID', classRefId))}"/>`);
    const bounds = parseMultiplicity(multiplicity);
    if (bounds) {
      const renderBound = (
        bound: MultBound,
        tag: string,
        suffix: string,
      ): string => {
        if (bound.kind === 'unlimited') {
          return `<${tag} xmi:type="uml:LiteralUnlimitedNatural" xmi:id="${esc(eaId('EAID', endKey + suffix))}" value="-1"/>`;
        }
        return `<${tag} xmi:type="uml:LiteralInteger" xmi:id="${esc(eaId('EAID', endKey + suffix))}" value="${esc(bound.value)}"/>`;
      };
      parts.push(renderBound(bounds.lower, 'lowerValue', 'Lower'));
      parts.push(renderBound(bounds.upper, 'upperValue', 'Upper'));
    }
    return parts.join('');
  }

  // Plain association shape (both ends association-owned, isReadOnly per
  // EA's plain-association emission).
  private renderEnd(
    endKey: string,
    classRefId: string,
    assocId: string,
    aggregation: string,
    multiplicity: string | undefined,
  ): string {
    const endId = this.endPropertyId(endKey);
    const parts: string[] = [];
    parts.push(`<memberEnd xmi:idref="${esc(endId)}"/>`);
    parts.push(
      `<ownedEnd xmi:type="uml:Property" xmi:id="${esc(endId)}" visibility="public" association="${esc(assocId)}" isStatic="false" isReadOnly="true" isDerived="false" isOrdered="false" isUnique="true" isDerivedUnion="false" aggregation="${aggregation}">`,
    );
    parts.push(this.renderEndBody(endKey, classRefId, multiplicity));
    parts.push('</ownedEnd>');
    return parts.join('');
  }
}
