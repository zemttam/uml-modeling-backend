import {
  GeneratedFile,
  SpringExportValidationError,
} from './spring-export.service';

export const JAVA_IMPORT_WHITELIST: Record<string, string> = {
  List: 'java.util.List',
  ArrayList: 'java.util.ArrayList',
  Map: 'java.util.Map',
  HashMap: 'java.util.HashMap',
  LinkedHashMap: 'java.util.LinkedHashMap',
  Set: 'java.util.Set',
  HashSet: 'java.util.HashSet',
  Optional: 'java.util.Optional',
  Collection: 'java.util.Collection',
  Arrays: 'java.util.Arrays',
  Collections: 'java.util.Collections',
  Iterator: 'java.util.Iterator',
  LocalDate: 'java.time.LocalDate',
  LocalDateTime: 'java.time.LocalDateTime',
  BigDecimal: 'java.math.BigDecimal',
  BigInteger: 'java.math.BigInteger',
  ThreadLocalRandom: 'java.util.concurrent.ThreadLocalRandom',
  Entity: 'jakarta.persistence.Entity',
  Table: 'jakarta.persistence.Table',
  Id: 'jakarta.persistence.Id',
  GeneratedValue: 'jakarta.persistence.GeneratedValue',
  Column: 'jakarta.persistence.Column',
  OneToOne: 'jakarta.persistence.OneToOne',
  ManyToOne: 'jakarta.persistence.ManyToOne',
  OneToMany: 'jakarta.persistence.OneToMany',
  ManyToMany: 'jakarta.persistence.ManyToMany',
  JoinColumn: 'jakarta.persistence.JoinColumn',
  JoinTable: 'jakarta.persistence.JoinTable',
  CascadeType: 'jakarta.persistence.CascadeType',
  FetchType: 'jakarta.persistence.FetchType',
  SpringApplication: 'org.springframework.boot.SpringApplication',
  SpringBootApplication:
    'org.springframework.boot.autoconfigure.SpringBootApplication',
  CommandLineRunner: 'org.springframework.boot.CommandLineRunner',
  Component: 'org.springframework.stereotype.Component',
  Service: 'org.springframework.stereotype.Service',
  Autowired: 'org.springframework.beans.factory.annotation.Autowired',
  RestController: 'org.springframework.web.bind.annotation.RestController',
  RequestMapping: 'org.springframework.web.bind.annotation.RequestMapping',
  GetMapping: 'org.springframework.web.bind.annotation.GetMapping',
  PostMapping: 'org.springframework.web.bind.annotation.PostMapping',
  PutMapping: 'org.springframework.web.bind.annotation.PutMapping',
  DeleteMapping: 'org.springframework.web.bind.annotation.DeleteMapping',
  PatchMapping: 'org.springframework.web.bind.annotation.PatchMapping',
  PathVariable: 'org.springframework.web.bind.annotation.PathVariable',
  RequestBody: 'org.springframework.web.bind.annotation.RequestBody',
  RequestParam: 'org.springframework.web.bind.annotation.RequestParam',
  ResponseEntity: 'org.springframework.http.ResponseEntity',
  JpaRepository: 'org.springframework.data.jpa.repository.JpaRepository',
  CrudRepository: 'org.springframework.data.repository.CrudRepository',
};

const JAVA_KEYWORDS = new Set([
  'abstract',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extends',
  'final',
  'finally',
  'float',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'native',
  'new',
  'package',
  'permits',
  'private',
  'protected',
  'public',
  'record',
  'return',
  'sealed',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'true',
  'false',
  'null',
  'try',
  'var',
  'void',
  'volatile',
  'while',
  'yield',
]);

const JAVA_LANG_TYPES = new Set([
  'Object',
  'String',
  'Integer',
  'Long',
  'Boolean',
  'Double',
  'Float',
  'Byte',
  'Short',
  'Character',
  'CharSequence',
  'StringBuilder',
  'StringBuffer',
  'Math',
  'System',
  'Exception',
  'RuntimeException',
  'Throwable',
  'Error',
  'Iterable',
  'Comparable',
  'Runnable',
  'Thread',
  'ThreadLocal',
  'Number',
  'Void',
  'Class',
  'Package',
  'Module',
  'ClassLoader',
  'Enum',
  'Record',
  'AutoCloseable',
  'Cloneable',
  'Override',
  'Deprecated',
  'SuppressWarnings',
  'SafeVarargs',
  'FunctionalInterface',
  'Process',
  'Runtime',
  'IllegalArgumentException',
  'IllegalStateException',
  'NullPointerException',
  'IndexOutOfBoundsException',
  'ArrayIndexOutOfBoundsException',
  'StringIndexOutOfBoundsException',
  'ArithmeticException',
  'ClassCastException',
  'NumberFormatException',
  'UnsupportedOperationException',
  'AssertionError',
  'InterruptedException',
  'ReflectiveOperationException',
  'ClassNotFoundException',
  'NoSuchMethodException',
  'InstantiationException',
  'IllegalAccessException',
  'CloneNotSupportedException',
  'ArrayStoreException',
  'NegativeArraySizeException',
  'StackOverflowError',
  'OutOfMemoryError',
]);

export function maskJavaSource(source: string): string {
  const chars = source.split('');
  const blank = (i: number) => {
    if (chars[i] !== '\n' && chars[i] !== '\r') {
      chars[i] = ' ';
    }
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'") {
      const quote = c;
      blank(i);
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          blank(i);
          if (i + 1 < source.length) {
            blank(i + 1);
          }
          i += 2;
          continue;
        }
        if (source[i] === quote || source[i] === '\n') {
          if (source[i] === quote) {
            blank(i);
            i++;
          }
          break;
        }
        blank(i);
        i++;
      }
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') {
        blank(i);
        i++;
      }
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      blank(i);
      blank(i + 1);
      i += 2;
      while (i < source.length) {
        if (source[i] === '*' && source[i + 1] === '/') {
          blank(i);
          blank(i + 1);
          i += 2;
          break;
        }
        blank(i);
        i++;
      }
      continue;
    }
    i++;
  }
  return chars.join('');
}

const IMPORT_RE = /^[ \t]*import\s+(?:static\s+)?([^;\n]+);/gm;
const PACKAGE_RE = /^[ \t]*package\s+([\w.]+)\s*;/m;
const DECLARATION_RE =
  /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g;

interface ParsedImports {
  single: Set<string>;
  wildcards: string[];
  lastImportEnd: number | null;
}

function parseImports(masked: string): ParsedImports {
  const single = new Set<string>();
  const wildcards: string[] = [];
  let lastImportEnd: number | null = null;
  for (const match of masked.matchAll(IMPORT_RE)) {
    const target = match[1].trim().replace(/\s+/g, '');
    if (target.endsWith('.*')) {
      wildcards.push(target.slice(0, -2));
    } else if (target !== '*') {
      const dot = target.lastIndexOf('.');
      single.add(dot === -1 ? target : target.slice(dot + 1));
    }
    lastImportEnd = match.index + match[0].length;
  }
  return { single, wildcards, lastImportEnd };
}

function parsePackage(masked: string): { name: string; end: number } {
  const match = PACKAGE_RE.exec(masked);
  if (!match) {
    return { name: '', end: 0 };
  }
  return { name: match[1], end: match.index + match[0].length };
}

function collectDeclarations(masked: string): Set<string> {
  const names = new Set<string>();
  for (const match of masked.matchAll(DECLARATION_RE)) {
    names.add(match[1]);
  }
  return names;
}

function collectUnqualifiedTypeReferences(masked: string): string[] {
  const found = new Set<string>();
  const add = (name: string) => {
    if (!JAVA_KEYWORDS.has(name)) {
      found.add(name);
    }
  };
  for (const match of masked.matchAll(/@([A-Za-z_$][\w$]*)/g)) {
    const after = masked[match.index + match[0].length];
    if (after !== '.') {
      add(match[1]);
    }
  }
  for (const match of masked.matchAll(/\bextends\s+([\w$.]+)/g)) {
    if (!match[1].includes('.')) {
      add(match[1]);
    }
  }
  for (const match of masked.matchAll(/\bimplements\s+([^\n{;()]*)/g)) {
    for (const segment of match[1].split(',')) {
      const simple = segment.split('<')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(simple)) {
        add(simple);
      }
    }
  }
  for (const match of masked.matchAll(/\bnew\s+([A-Za-z_$][\w$]*)/g)) {
    let i = match.index + match[0].length;
    while (i < masked.length && (masked[i] === ' ' || masked[i] === '\t')) {
      i++;
    }
    if (masked[i] === '<') {
      let depth = 0;
      while (i < masked.length) {
        if (masked[i] === '<') {
          depth++;
        } else if (masked[i] === '>') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      while (i < masked.length && (masked[i] === ' ' || masked[i] === '\t')) {
        i++;
      }
    }
    if (masked[i] === '(') {
      add(match[1]);
    }
  }
  return [...found];
}

function ensureImportsForFile(
  file: GeneratedFile,
  masked: string,
  declarationsByPackage: Map<string, Set<string>>,
): GeneratedFile {
  const pkg = parsePackage(masked).name;
  const samePackageNames = declarationsByPackage.get(pkg) ?? new Set<string>();
  const ownNames = collectDeclarations(masked);
  const { single, wildcards, lastImportEnd } = parseImports(masked);

  for (const name of collectUnqualifiedTypeReferences(masked)) {
    if (
      ownNames.has(name) ||
      samePackageNames.has(name) ||
      JAVA_IMPORT_WHITELIST[name] !== undefined ||
      JAVA_LANG_TYPES.has(name) ||
      single.has(name) ||
      wildcards.length > 0
    ) {
      continue;
    }
    throw new SpringExportValidationError(
      `"${file.path}" references "${name}" in an unambiguous type position (annotation, extends, implements, or new) without importing or declaring it`,
    );
  }

  const toInject: string[] = [];
  for (const [name, fqn] of Object.entries(JAVA_IMPORT_WHITELIST)) {
    if (!new RegExp(`\\b${name}\\b`).test(masked)) {
      continue;
    }
    if (
      single.has(name) ||
      ownNames.has(name) ||
      samePackageNames.has(name) ||
      JAVA_LANG_TYPES.has(name) ||
      wildcards.some((p) => fqn.startsWith(`${p}.`))
    ) {
      continue;
    }
    toInject.push(fqn);
  }
  if (toInject.length === 0) {
    return file;
  }
  toInject.sort();
  const anchor = lastImportEnd ?? parsePackage(masked).end;
  const imports = toInject.map((fqn) => `import ${fqn};`).join('\n');
  return {
    path: file.path,
    content: `${file.content.slice(0, anchor)}\n${imports}${file.content.slice(anchor)}`,
  };
}

export function ensureJavaImports(files: GeneratedFile[]): GeneratedFile[] {
  const maskedByPath = new Map<string, string>();
  const declarationsByPackage = new Map<string, Set<string>>();
  for (const file of files) {
    if (!file.path.endsWith('.java')) {
      continue;
    }
    const masked = maskJavaSource(file.content);
    maskedByPath.set(file.path, masked);
    const pkg = parsePackage(masked).name;
    let names = declarationsByPackage.get(pkg);
    if (!names) {
      names = new Set<string>();
      declarationsByPackage.set(pkg, names);
    }
    for (const name of collectDeclarations(masked)) {
      names.add(name);
    }
  }
  return files.map((file) => {
    const masked = maskedByPath.get(file.path);
    if (masked === undefined) {
      return file;
    }
    return ensureImportsForFile(file, masked, declarationsByPackage);
  });
}
