import { createHash } from 'node:crypto';

import type { CodeUnit, CodeUnitKind } from '../types.js';
import { LANGUAGE_FAMILY, type LanguageId } from './languages.js';
import { computeMetadata, firstIdentifier, walk } from './metadata.js';
import { getParser, type TSNode } from './parser-pool.js';
import { CLASS_BODIES, CLASS_OWNERS, NAME_HOLDERS, NAME_PASS_THROUGH, UNIT_NODES, type UnitRule } from './queries.js';

export { computeMetadata } from './metadata.js';

export interface ExtractResult {
  units: CodeUnit[];
  error?: string;
  language: LanguageId;
}

/** Parse `source` and return its code units (loc >= 3), plus the first syntax error if any. */
export async function extractUnits(filePath: string, source: string, lang: LanguageId): Promise<ExtractResult> {
  const parser = await getParser(lang);
  return extractWithParser(parser, filePath, source, lang);
}

export function extractWithParser(
  parser: { parse(source: string): { rootNode: TSNode; delete(): void } | null },
  filePath: string,
  source: string,
  lang: LanguageId,
): ExtractResult {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const tree = parser.parse(text);
  if (!tree) return { units: [], error: 'parser returned no tree', language: lang };
  try {
    const lines = text.split(/\r?\n/);
    const rules = UNIT_NODES[LANGUAGE_FAMILY[lang]];
    const units: CodeUnit[] = [];
    walk(tree.rootNode, (node) => {
      const rule = rules[node.type];
      if (!rule) return;
      const kind = resolveKind(rule, node);
      if (!kind) return;
      const metadata = computeMetadata(node, lines, lang);
      if (metadata.loc < 3) return;
      const name = unitName(node, kind);
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      units.push({
        id: createHash('sha1').update(`${filePath}:${startLine}:${endLine}:${name}`).digest('hex').slice(0, 12),
        name,
        kind,
        filePath,
        startLine,
        endLine,
        code: node.text,
        metadata,
      });
    });
    const errorLine = firstErrorLine(tree.rootNode);
    return errorLine === null
      ? { units, language: lang }
      : { units, error: `syntax error (line ${errorLine})`, language: lang };
  } finally {
    tree.delete();
  }
}

function resolveKind(rule: UnitRule, node: TSNode): CodeUnitKind | null {
  switch (rule) {
    case 'function':
    case 'method':
    case 'class':
    case 'arrow':
      return rule;
    case 'class-if-body':
      return node.childForFieldName('body') ? 'class' : null;
    case 'class-if-struct': {
      const type = node.childForFieldName('type')?.type;
      return type === 'struct_type' || type === 'interface_type' ? 'class' : null;
    }
    case 'auto':
      return isMethodContext(node) ? 'method' : 'function';
  }
}

function isMethodContext(node: TSNode): boolean {
  let container = node.parent;
  if (container?.type === 'decorated_definition' || container?.type === 'template_declaration') container = container.parent;
  if (!container) return false;
  if (container.type === 'block') return CLASS_OWNERS.has(container.parent?.type ?? '');
  if (CLASS_BODIES.has(container.type)) return CLASS_OWNERS.has(container.parent?.type ?? '') || container.type === 'field_declaration_list';
  // C++ out-of-class definition: `void Stack::clear() { … }`
  let declarator = node.childForFieldName('declarator');
  while (declarator) {
    const inner = declarator.childForFieldName('declarator');
    if (!inner) return declarator.type === 'qualified_identifier';
    declarator = inner;
  }
  return false;
}

function unitName(node: TSNode, kind: CodeUnitKind): string {
  if (kind === 'arrow') return assignedName(node) ?? '<anonymous>';
  if (node.type === 'impl_item') return node.childForFieldName('type')?.text ?? '<anonymous>';
  const name = node.childForFieldName('name');
  if (name) return name.text;
  // C/C++ functions: walk the declarator chain down to the identifier.
  let declarator = node.childForFieldName('declarator');
  while (declarator) {
    const inner = declarator.childForFieldName('declarator');
    if (!inner) {
      if (declarator.type === 'qualified_identifier') return declarator.childForFieldName('name')?.text ?? declarator.text;
      return declarator.text;
    }
    declarator = inner;
  }
  return '<anonymous>';
}

function assignedName(node: TSNode): string | null {
  let parent = node.parent;
  while (parent && NAME_PASS_THROUGH.has(parent.type)) parent = parent.parent;
  if (!parent) return null;
  const fields = NAME_HOLDERS[parent.type];
  if (!fields) return null;
  for (const field of fields) {
    const holder = parent.childForFieldName(field);
    if (holder) return firstIdentifier(holder);
  }
  return firstIdentifier(parent.namedChild(0));
}

function firstErrorLine(root: TSNode): number | null {
  if (!root.hasError) return null;
  let line: number | null = null;
  walk(root, (node) => {
    if (line !== null) return false;
    if (node.isError || node.isMissing) {
      line = node.startPosition.row + 1;
      return false;
    }
    return node.hasError ? undefined : false;
  });
  return line;
}
