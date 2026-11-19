import type { CodeUnitMetadata } from '../types.js';
import { LANGUAGE_FAMILY, type LanguageId } from './languages.js';
import type { TSNode } from './parser-pool.js';
import {
  BOOLEAN_PARENTS,
  BRANCH_KEYWORDS,
  BRANCH_NODES,
  BRANCH_TOKENS,
  CONTROL_NODES,
  DOC_STYLE,
  DOC_WRAPPERS,
  isCommentNode,
  isIdentifierLike,
} from './queries.js';

/** Pre-order walk without recursion (minified files can nest very deeply). */
export function walk(root: TSNode, visit: (node: TSNode, depth: number) => boolean | void): void {
  const stack: Array<[TSNode, number]> = [[root, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    if (visit(node, depth) === false) continue;
    const children = node.children;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child) stack.push([child, depth]);
    }
  }
}

export function firstIdentifier(node: TSNode | null): string | null {
  if (!node) return null;
  let found: string | null = null;
  walk(node, (n) => {
    if (found !== null) return false;
    if (n.childCount === 0 && isIdentifierLike(n.type)) {
      found = n.text;
      return false;
    }
    return undefined;
  });
  return found;
}

/**
 * Metadata for one unit. `lines` is the whole file split on line breaks (BOM removed),
 * so rows from tree-sitter index into it directly.
 */
export function computeMetadata(node: TSNode, lines: string[], lang: LanguageId): CodeUnitMetadata {
  const startRow = node.startPosition.row;
  const endRow = node.endPosition.row;
  const commentRows = new Set<number>();
  const commentOnlyRows = new Set<number>();
  const identifiers: string[] = [];
  let complexity = 1;
  let nestingDepth = 0;

  const stack: Array<[TSNode, number]> = [[node, 0]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop()!;
    const type = current.type;
    let nextDepth = depth;
    if (CONTROL_NODES.has(type)) {
      nextDepth = depth + 1;
      if (nextDepth > nestingDepth) nestingDepth = nextDepth;
    }
    if (BRANCH_NODES.has(type)) complexity += 1;
    if (current.childCount === 0) {
      if (BRANCH_TOKENS.has(type)) complexity += 1;
      else if (BRANCH_KEYWORDS.has(type) && current.parent && BOOLEAN_PARENTS.has(current.parent.type)) complexity += 1;
      else if (isIdentifierLike(type)) identifiers.push(current.text);
    }
    if (isCommentNode(type)) {
      markComment(current, lines, commentRows, commentOnlyRows);
      continue;
    }
    const children = current.children;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child) stack.push([child, nextDepth]);
    }
  }

  let loc = 0;
  for (let row = startRow; row <= endRow; row += 1) {
    if ((lines[row] ?? '').trim().length > 0 && !commentOnlyRows.has(row)) loc += 1;
  }
  const commentLines = commentRows.size;

  return {
    loc,
    commentLines,
    commentRatio: commentLines / Math.max(1, loc + commentLines),
    identifiers,
    nestingDepth,
    parameters: collectParameters(node),
    hasJSDoc: hasDocComment(node, lines, lang),
    complexity,
  };
}

function markComment(comment: TSNode, lines: string[], rows: Set<number>, onlyRows: Set<number>): void {
  const start = comment.startPosition;
  const end = comment.endPosition;
  // A comment ending at column 0 of the next row (some grammars include the newline) does not cover that row.
  const lastRow = end.column === 0 && end.row > start.row ? end.row - 1 : end.row;
  for (let row = start.row; row <= lastRow; row += 1) {
    rows.add(row);
    const line = lines[row] ?? '';
    const before = row === start.row ? line.slice(0, start.column) : '';
    const after = row === end.row ? line.slice(end.column) : '';
    if (before.trim() === '' && after.trim() === '') onlyRows.add(row);
  }
}

function parametersNode(node: TSNode): TSNode | null {
  const direct = node.childForFieldName('parameters') ?? node.childForFieldName('parameter');
  if (direct) return direct;
  // C/C++: function_definition → declarator chain → function_declarator.parameters
  let declarator = node.childForFieldName('declarator');
  while (declarator) {
    const params = declarator.childForFieldName('parameters');
    if (params) return params;
    declarator = declarator.childForFieldName('declarator');
  }
  return null;
}

function collectParameters(node: TSNode): string[] {
  const params = parametersNode(node);
  if (!params) return [];
  if (params.childCount === 0 && isIdentifierLike(params.type)) return [params.text];
  const names: string[] = [];
  for (const child of params.namedChildren) {
    if (!child || isCommentNode(child.type)) continue;
    if (child.type === 'self_parameter') {
      names.push('self');
      continue;
    }
    if (child.childCount === 0) {
      if (isIdentifierLike(child.type)) names.push(child.text);
      continue;
    }
    const holder =
      child.childForFieldName('name') ?? child.childForFieldName('pattern') ?? child.childForFieldName('declarator') ?? child;
    const name = firstIdentifier(holder);
    if (name) names.push(name);
  }
  return names;
}

/** The outermost node that "is" this unit for doc purposes (export, decorators, declarations). */
function docAnchor(node: TSNode): TSNode {
  let anchor = node;
  while (anchor.parent && DOC_WRAPPERS.has(anchor.parent.type)) anchor = anchor.parent;
  return anchor;
}

function hasDocComment(node: TSNode, lines: string[], lang: LanguageId): boolean {
  const family = LANGUAGE_FAMILY[lang];
  if (family === 'python' && hasDocstring(node)) return true;
  const anchor = docAnchor(node);
  const row = anchor.startPosition.row;
  if ((lines[row] ?? '').slice(0, anchor.startPosition.column).trim() !== '') return false;
  const style = DOC_STYLE[family];

  const above = (lines[row - 1] ?? '').trim();
  for (const prefix of style.linePrefixes) {
    if (above.startsWith(prefix) && !(prefix === '#' && above.startsWith('#!'))) {
      // `//` must not be the start of a `///` (handled by its own prefix) or a block comment line.
      return true;
    }
  }
  if (!style.block) return false;
  let r = row - 1;
  while (r >= 0 && (lines[r] ?? '').trim() === '') r -= 1;
  if (r < 0 || !(lines[r] ?? '').trimEnd().endsWith('*/')) return false;
  for (; r >= 0; r -= 1) {
    const line = lines[r] ?? '';
    const open = line.lastIndexOf('/*');
    if (open >= 0) return line.slice(open).startsWith('/**') && line.slice(0, open).trim() === '';
  }
  return false;
}

function hasDocstring(node: TSNode): boolean {
  if (node.type !== 'function_definition' && node.type !== 'class_definition') return false;
  const body = node.childForFieldName('body');
  const first = body?.namedChildren.find((c) => c !== null && !isCommentNode(c.type)) ?? null;
  return first?.type === 'expression_statement' && first.namedChild(0)?.type === 'string';
}
