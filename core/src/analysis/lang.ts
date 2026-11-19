import { LANGUAGE_FAMILY, type LanguageFamily, type LanguageId } from '../lang/languages.js';
import { firstIdentifier } from '../lang/metadata.js';
import type { TSNode } from '../lang/parser-pool.js';
import { UNIT_NODES } from '../lang/queries.js';
import type { CallInfo } from '../rules/types.js';

export const FUNCTION_TYPES: Record<LanguageFamily, Set<string>> = Object.fromEntries(
  (Object.keys(UNIT_NODES) as LanguageFamily[]).map((family) => [
    family,
    new Set(Object.entries(UNIT_NODES[family]).filter(([, rule]) => rule !== 'class' && rule !== 'class-if-body' && rule !== 'class-if-struct').map(([type]) => type)),
  ]),
) as Record<LanguageFamily, Set<string>>;

const COMPARISON = new Set(['==', '===', '!=', '!==', '<', '>', '<=', '>=', 'in', 'instanceof', 'is', 'not in', 'is not', '-eq', '-ne']);
const LITERAL_TYPES = new Set([
  'number', 'integer', 'float', 'true', 'false', 'null', 'undefined', 'none', 'boolean', 'number_literal', 'integer_literal',
  'float_literal', 'boolean_literal', 'null_literal', 'decimal_integer_literal', 'int_literal', 'real_literal', 'character_literal',
  'regex', 'comment', 'line_comment', 'block_comment',
]);

export function isLiteralLeaf(node: TSNode): boolean {
  return LITERAL_TYPES.has(node.type);
}

export function isComparison(node: TSNode): boolean {
  if (!node.type.includes('binary') && node.type !== 'comparison_operator' && node.type !== 'boolean_operator') return false;
  if (node.type === 'comparison_operator') return true;
  for (const child of node.children) {
    if (child && !child.isNamed && COMPARISON.has(child.text)) return true;
  }
  return false;
}

export function isFunctionNode(node: TSNode, family: LanguageFamily): boolean {
  if (!FUNCTION_TYPES[family].has(node.type)) return false;
  // JS: a `method_definition` / arrow etc. are all functions; Rust `function_item` too.
  return true;
}

/** Identifier-like leaf (variables). PHP `variable_name` and shell `variable_name` are treated as one token. */
export function isVariableLeaf(node: TSNode): boolean {
  const t = node.type;
  return t === 'identifier' || t === 'variable_name' || t === 'shorthand_property_identifier' ||
    t === 'shorthand_property_identifier_pattern' || t === 'property_identifier_pattern';
}

const PROPERTY_FIELDS = ['property', 'attribute', 'field', 'name'];
/** True when this identifier is the member name in `obj.member` (not a variable read). */
export function isMemberPosition(node: TSNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  const t = parent.type;
  const memberish = t.includes('member') || t.includes('attribute') || t.includes('selector') || t.includes('field_expression') || t.includes('field_access') || t === 'scoped_identifier';
  if (!memberish) return false;
  for (const field of PROPERTY_FIELDS) {
    const target = parent.childForFieldName(field);
    if (target && target.startIndex === node.startIndex && target.endIndex === node.endIndex) return true;
  }
  return false;
}

export function normaliseCallee(text: string): string {
  return text.replace(/\s+/g, '').replace(/\?\./g, '.').replace(/!\./g, '.');
}

function argsOf(node: TSNode | null): TSNode[] {
  if (!node) return [];
  return node.namedChildren.filter((c): c is TSNode => c !== null && !c.type.includes('comment'));
}

function unwrapArgument(node: TSNode): TSNode {
  // C#/PHP wrap each argument in an `argument` node; Python keyword args carry a `value`.
  if (node.type === 'argument' && node.namedChildCount === 1) return node.namedChild(0)!;
  if (node.type === 'argument' && node.namedChildCount > 1) return node.namedChildren[node.namedChildren.length - 1]!;
  if (node.type === 'keyword_argument') return node.childForFieldName('value') ?? node;
  return node;
}

/** Callee text and arguments when `node` is a call; null otherwise. */
export function parseCall(node: TSNode, family: LanguageFamily): { callee: string; args: TSNode[] } | null {
  const t = node.type;
  switch (family) {
    case 'js':
      if (t === 'call_expression') return { callee: normaliseCallee(node.childForFieldName('function')?.text ?? ''), args: argsOf(node.childForFieldName('arguments')) };
      if (t === 'new_expression') return { callee: `new ${normaliseCallee(node.childForFieldName('constructor')?.text ?? node.namedChild(0)?.text ?? '')}`, args: argsOf(node.childForFieldName('arguments')) };
      return null;
    case 'python':
      if (t === 'call') return { callee: normaliseCallee(node.childForFieldName('function')?.text ?? ''), args: argsOf(node.childForFieldName('arguments')).map(unwrapArgument) };
      return null;
    case 'java':
      if (t === 'method_invocation') {
        const object = node.childForFieldName('object');
        const name = node.childForFieldName('name')?.text ?? '';
        return { callee: normaliseCallee(object ? `${object.text}.${name}` : name), args: argsOf(node.childForFieldName('arguments')) };
      }
      if (t === 'object_creation_expression') return { callee: `new ${node.childForFieldName('type')?.text ?? ''}`, args: argsOf(node.childForFieldName('arguments')) };
      return null;
    case 'csharp':
      if (t === 'invocation_expression') return { callee: normaliseCallee(node.childForFieldName('function')?.text ?? ''), args: argsOf(node.childForFieldName('arguments')).map(unwrapArgument) };
      if (t === 'object_creation_expression') return { callee: `new ${node.childForFieldName('type')?.text ?? ''}`, args: argsOf(node.childForFieldName('arguments')).map(unwrapArgument) };
      return null;
    case 'c':
      if (t === 'call_expression') return { callee: normaliseCallee(node.childForFieldName('function')?.text ?? ''), args: argsOf(node.childForFieldName('arguments')) };
      return null;
    case 'go':
      if (t === 'call_expression') return { callee: normaliseCallee(node.childForFieldName('function')?.text ?? ''), args: argsOf(node.childForFieldName('arguments')) };
      return null;
    case 'rust':
      if (t === 'call_expression') return { callee: normaliseCallee(node.childForFieldName('function')?.text ?? ''), args: argsOf(node.childForFieldName('arguments')) };
      if (t === 'macro_invocation') {
        const tree = node.namedChildren.find((c) => c?.type === 'token_tree') ?? null;
        return { callee: `${node.childForFieldName('macro')?.text ?? ''}!`, args: tree ? [tree] : [] };
      }
      return null;
    case 'php':
      if (t === 'function_call_expression') return { callee: normaliseCallee(node.childForFieldName('function')?.text ?? ''), args: argsOf(node.childForFieldName('arguments')).map(unwrapArgument) };
      if (t === 'member_call_expression') return { callee: normaliseCallee(`${node.childForFieldName('object')?.text ?? ''}->${node.childForFieldName('name')?.text ?? ''}`), args: argsOf(node.childForFieldName('arguments')).map(unwrapArgument) };
      if (t === 'scoped_call_expression') return { callee: normaliseCallee(`${node.childForFieldName('scope')?.text ?? ''}::${node.childForFieldName('name')?.text ?? ''}`), args: argsOf(node.childForFieldName('arguments')).map(unwrapArgument) };
      if (t === 'echo_statement' || t === 'print_intrinsic') return { callee: t === 'echo_statement' ? 'echo' : 'print', args: argsOf(node) };
      if (t === 'include_expression' || t === 'require_expression' || t === 'include_once_expression' || t === 'require_once_expression') {
        return { callee: t.replace('_expression', ''), args: argsOf(node) };
      }
      return null;
    case 'shell': {
      if (t !== 'command') return null;
      const name = node.childForFieldName('name')?.text ?? '';
      const args = node.namedChildren.filter((c): c is TSNode => c !== null && c.type !== 'command_name' && !c.type.includes('comment'));
      return { callee: name, args };
    }
  }
}

export function callInfo(node: TSNode, family: LanguageFamily, fnText: string): CallInfo | null {
  const parsed = parseCall(node, family);
  if (!parsed || !parsed.callee) return null;
  return { node, callee: parsed.callee, args: parsed.args, line: node.startPosition.row + 1, fnText };
}

export interface Assignment {
  targets: string[];
  value: TSNode | null;
  node: TSNode;
}

function leafNames(node: TSNode | null): string[] {
  if (!node) return [];
  const out: string[] = [];
  const stack: TSNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (isVariableLeaf(n)) {
      if (!isMemberPosition(n)) out.push(n.text);
      continue;
    }
    if (n.type.includes('member') || n.type.includes('attribute') || n.type === 'selector_expression' || n.type === 'field_expression' || n.type === 'subscript_expression' || n.type === 'subscript') {
      out.push(normaliseCallee(n.text));
      continue;
    }
    for (const c of n.children) if (c && c.isNamed) stack.push(c);
  }
  return out;
}

/** Assignments performed by `node` (none if it is not an assignment form). */
export function assignmentsOf(node: TSNode, family: LanguageFamily): Assignment[] {
  const t = node.type;
  const pair = (target: TSNode | null, value: TSNode | null): Assignment[] => (target ? [{ targets: leafNames(target), value, node }] : []);
  switch (family) {
    case 'js':
      if (t === 'variable_declarator') return pair(node.childForFieldName('name'), node.childForFieldName('value'));
      if (t === 'assignment_expression' || t === 'augmented_assignment_expression') return pair(node.childForFieldName('left'), node.childForFieldName('right'));
      return [];
    case 'python':
      if (t === 'assignment' || t === 'augmented_assignment') return pair(node.childForFieldName('left'), node.childForFieldName('right'));
      if (t === 'named_expression') return pair(node.childForFieldName('name'), node.childForFieldName('value'));
      return [];
    case 'java':
      if (t === 'variable_declarator') return pair(node.childForFieldName('name'), node.childForFieldName('value'));
      if (t === 'assignment_expression') return pair(node.childForFieldName('left'), node.childForFieldName('right'));
      return [];
    case 'csharp':
      if (t === 'variable_declarator') {
        const name = node.childForFieldName('name');
        const rest = node.namedChildren.filter((c): c is TSNode => c !== null && c !== name && c.startIndex !== name?.startIndex);
        const value = rest.length > 0 ? rest[rest.length - 1]! : null;
        return pair(name, value && value.type === 'equals_value_clause' ? value.namedChild(0) : value);
      }
      if (t === 'assignment_expression') return pair(node.childForFieldName('left'), node.childForFieldName('right'));
      return [];
    case 'c':
      if (t === 'init_declarator') return pair(node.childForFieldName('declarator'), node.childForFieldName('value'));
      if (t === 'assignment_expression') return pair(node.childForFieldName('left'), node.childForFieldName('right'));
      return [];
    case 'go':
      if (t === 'short_var_declaration' || t === 'assignment_statement') {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (!left || !right) return [];
        const lefts = left.type === 'expression_list' ? left.namedChildren.filter((c): c is TSNode => c !== null) : [left];
        const rights = right.type === 'expression_list' ? right.namedChildren.filter((c): c is TSNode => c !== null) : [right];
        if (lefts.length === rights.length) return lefts.map((l, i) => ({ targets: leafNames(l), value: rights[i]!, node }));
        return [{ targets: lefts.flatMap((l) => leafNames(l)), value: rights[0] ?? null, node }];
      }
      if (t === 'var_spec') return pair(node.childForFieldName('name'), node.childForFieldName('value'));
      return [];
    case 'rust':
      if (t === 'let_declaration') return pair(node.childForFieldName('pattern'), node.childForFieldName('value'));
      if (t === 'assignment_expression' || t === 'compound_assignment_expr') return pair(node.childForFieldName('left'), node.childForFieldName('right'));
      return [];
    case 'php':
      if (t === 'assignment_expression' || t === 'augmented_assignment_expression') return pair(node.childForFieldName('left'), node.childForFieldName('right'));
      return [];
    case 'shell':
      if (t === 'variable_assignment') return pair(node.childForFieldName('name'), node.childForFieldName('value'));
      return [];
  }
}

export interface ForBinding {
  targets: string[];
  iterable: TSNode;
}

export function forBindingOf(node: TSNode): ForBinding | null {
  const t = node.type;
  if (t === 'for_statement' || t === 'for_in_statement' || t === 'enhanced_for_statement' || t === 'foreach_statement') {
    const left = node.childForFieldName('left') ?? node.childForFieldName('name');
    const right = node.childForFieldName('right') ?? node.childForFieldName('value');
    if (left && right) return { targets: leafNames(left), iterable: right };
  }
  return null;
}

export function paramNames(fn: TSNode): string[] {
  let params = fn.childForFieldName('parameters') ?? fn.childForFieldName('parameter');
  if (!params) {
    let declarator = fn.childForFieldName('declarator');
    while (declarator && !params) {
      params = declarator.childForFieldName('parameters');
      declarator = declarator.childForFieldName('declarator');
    }
  }
  if (!params) return [];
  if (params.childCount === 0) return [params.text];
  const names: string[] = [];
  for (const child of params.namedChildren) {
    if (!child || child.type.includes('comment')) continue;
    if (child.type === 'self_parameter') continue;
    const holder = child.childForFieldName('name') ?? child.childForFieldName('pattern') ?? child.childForFieldName('declarator') ?? child;
    // Rust extractor patterns: `Query(p): Query<P>` binds `p`, not `Query`.
    const name = holder.type === 'tuple_struct_pattern' ? (holder.namedChildren.filter((c) => c && c.type === 'identifier').pop()?.text ?? null) : firstIdentifier(holder);
    if (name && name !== 'self' && name !== 'this' && name !== 'cls') names.push(name);
    else names.push('');
  }
  return names;
}

export function functionName(fn: TSNode): string {
  const name = fn.childForFieldName('name');
  if (name) return name.text;
  let declarator = fn.childForFieldName('declarator');
  while (declarator) {
    const inner = declarator.childForFieldName('declarator');
    if (!inner) return declarator.type === 'qualified_identifier' ? (declarator.childForFieldName('name')?.text ?? declarator.text) : declarator.text;
    declarator = inner;
  }
  // arrow / lambda: look at what it is assigned to
  let parent = fn.parent;
  while (parent && (parent.type === 'parenthesized_expression' || parent.type === 'equals_value_clause')) parent = parent.parent;
  if (parent) {
    const holder = parent.childForFieldName('name') ?? parent.childForFieldName('left') ?? parent.childForFieldName('key') ?? parent.childForFieldName('declarator') ?? parent.childForFieldName('pattern');
    if (holder) return holder.text.replace(/^(?:this|self)[.]/, '').split(/[.]/).pop() ?? holder.text;
  }
  return '';
}

export function bodyOf(fn: TSNode): TSNode | null {
  return fn.childForFieldName('body');
}

export function isReturn(node: TSNode): boolean {
  return node.type === 'return_statement' || node.type === 'return_expression';
}

export function returnValue(node: TSNode): TSNode | null {
  return node.namedChild(0);
}

export function familyOf(lang: LanguageId): LanguageFamily {
  return LANGUAGE_FAMILY[lang];
}
