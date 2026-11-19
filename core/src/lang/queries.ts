import type { LanguageFamily } from './languages.js';

/**
 * Which syntax nodes become code units, per language family.
 *
 * `auto` means "function, or method when it sits directly in a class/impl body".
 * `class-if-body` means "class, but only when the node has a body" (C/C++ forward declarations are not units).
 * `class-if-struct` is Go's `type X struct/interface {…}`.
 */
export type UnitRule = 'function' | 'method' | 'class' | 'arrow' | 'auto' | 'class-if-body' | 'class-if-struct';

export const UNIT_NODES: Record<LanguageFamily, Record<string, UnitRule>> = {
  js: {
    function_declaration: 'function',
    generator_function_declaration: 'function',
    class_declaration: 'class',
    abstract_class_declaration: 'class',
    interface_declaration: 'class',
    enum_declaration: 'class',
    method_definition: 'method',
    arrow_function: 'arrow',
  },
  python: {
    function_definition: 'auto',
    class_definition: 'class',
    lambda: 'arrow',
  },
  java: {
    method_declaration: 'method',
    constructor_declaration: 'method',
    compact_constructor_declaration: 'method',
    class_declaration: 'class',
    interface_declaration: 'class',
    enum_declaration: 'class',
    record_declaration: 'class',
    annotation_type_declaration: 'class',
    lambda_expression: 'arrow',
  },
  csharp: {
    method_declaration: 'method',
    constructor_declaration: 'method',
    destructor_declaration: 'method',
    operator_declaration: 'method',
    local_function_statement: 'function',
    class_declaration: 'class',
    struct_declaration: 'class',
    interface_declaration: 'class',
    enum_declaration: 'class',
    record_declaration: 'class',
    lambda_expression: 'arrow',
    anonymous_method_expression: 'arrow',
  },
  c: {
    function_definition: 'auto',
    class_specifier: 'class-if-body',
    struct_specifier: 'class-if-body',
    union_specifier: 'class-if-body',
    enum_specifier: 'class-if-body',
    lambda_expression: 'arrow',
  },
  go: {
    function_declaration: 'function',
    method_declaration: 'method',
    type_spec: 'class-if-struct',
    func_literal: 'arrow',
  },
  rust: {
    function_item: 'auto',
    struct_item: 'class',
    enum_item: 'class',
    union_item: 'class',
    trait_item: 'class',
    impl_item: 'class',
    closure_expression: 'arrow',
  },
  php: {
    function_definition: 'function',
    method_declaration: 'method',
    class_declaration: 'class',
    interface_declaration: 'class',
    trait_declaration: 'class',
    enum_declaration: 'class',
    anonymous_function: 'arrow',
    anonymous_function_creation_expression: 'arrow',
    arrow_function: 'arrow',
  },
  shell: {
    function_definition: 'function',
  },
};

/** Bodies whose direct function children are methods. */
export const CLASS_BODIES = new Set(['field_declaration_list', 'declaration_list', 'class_body']);
export const CLASS_OWNERS = new Set(['class_definition', 'class_specifier', 'struct_specifier', 'impl_item', 'trait_item']);

/** Nodes an arrow/lambda is looked through to find the name it is assigned to. */
export const NAME_PASS_THROUGH = new Set([
  'parenthesized_expression',
  'expression_list',
  'equals_value_clause',
]);

/** Nodes that give an arrow/lambda its name, and the field holding the name. */
export const NAME_HOLDERS: Record<string, string[]> = {
  variable_declarator: ['name', 'declarator'],
  assignment: ['left'],
  assignment_expression: ['left'],
  augmented_assignment: ['left'],
  pair: ['key'],
  init_declarator: ['declarator'],
  short_var_declaration: ['left'],
  var_spec: ['name'],
  let_declaration: ['pattern'],
  public_field_definition: ['name', 'property'],
  field_definition: ['property', 'name'],
  property_declaration: ['name'],
};

/** Wrappers a doc comment may sit above (the unit node itself starts inside them). */
export const DOC_WRAPPERS = new Set([
  'export_statement',
  'decorated_definition',
  'template_declaration',
  'declaration',
  'lexical_declaration',
  'variable_declaration',
  'variable_declarator',
  'local_variable_declaration',
  'local_declaration_statement',
  'expression_statement',
  'assignment',
  'assignment_expression',
  'init_declarator',
  'short_var_declaration',
  'let_declaration',
  'expression_list',
  'equals_value_clause',
  'parenthesized_expression',
  'type_declaration',
  'field_declaration',
  'public_field_definition',
  'pair',
]);

export const CONTROL_NODES = new Set([
  'if_statement', 'if_expression', 'if_let_expression',
  'for_statement', 'for_in_statement', 'enhanced_for_statement', 'foreach_statement',
  'for_range_loop', 'for_expression', 'c_style_for_statement',
  'while_statement', 'while_expression', 'loop_expression', 'do_statement',
  'switch_statement', 'switch_expression', 'expression_switch_statement', 'type_switch_statement',
  'select_statement', 'match_expression', 'match_statement', 'case_statement',
  'try_statement', 'try_expression', 'with_statement',
]);

export const BRANCH_NODES = new Set([
  'if_statement', 'if_expression', 'if_let_expression', 'elif_clause', 'else_if_clause',
  'for_statement', 'for_in_statement', 'enhanced_for_statement', 'foreach_statement',
  'for_range_loop', 'for_expression', 'c_style_for_statement',
  'while_statement', 'while_expression', 'loop_expression', 'do_statement',
  'switch_case', 'switch_block_statement_group', 'switch_rule', 'switch_section',
  'expression_case', 'type_case', 'communication_case', 'match_arm', 'case_clause', 'case_item',
  'case_statement',
  'catch_clause', 'except_clause',
  'ternary_expression', 'conditional_expression',
]);

/** Leaf tokens that add a branch. */
export const BRANCH_TOKENS = new Set(['&&', '||', '??']);
/** Keyword operators that add a branch when they sit in a boolean expression. */
export const BRANCH_KEYWORDS = new Set(['and', 'or']);
export const BOOLEAN_PARENTS = new Set(['boolean_operator', 'binary_expression']);

export const IDENTIFIER_LEAVES = new Set(['name', 'variable_name', 'self']);
export function isIdentifierLike(type: string): boolean {
  return type.endsWith('identifier') || IDENTIFIER_LEAVES.has(type);
}

export function isCommentNode(type: string): boolean {
  return type.includes('comment');
}

/** Doc-comment styles per family: `/** … *\/` blocks and/or line prefixes. */
export const DOC_STYLE: Record<LanguageFamily, { block: boolean; linePrefixes: string[] }> = {
  js: { block: true, linePrefixes: [] },
  python: { block: false, linePrefixes: ['#'] },
  java: { block: true, linePrefixes: [] },
  csharp: { block: true, linePrefixes: ['///'] },
  c: { block: true, linePrefixes: ['///'] },
  go: { block: true, linePrefixes: ['//'] },
  rust: { block: true, linePrefixes: ['///'] },
  php: { block: true, linePrefixes: [] },
  shell: { block: false, linePrefixes: ['#'] },
};
