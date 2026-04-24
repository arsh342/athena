import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type { CodeUnit, CodeUnitKind, CodeUnitMetadata } from '../types.js';

const supportedScriptKinds: Record<string, ts.ScriptKind> = {
  '.js': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
  '.ts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
};

export async function parseFile(filePath: string): Promise<CodeUnit[]> {
  const source = await readFile(filePath, 'utf8');
  return parseSource(filePath, source);
}

export function parseSource(filePath: string, source: string): CodeUnit[] {
  const scriptKind = supportedScriptKinds[filePath.match(/\.[^.]+$/)?.[0] ?? '.ts'] ?? ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const units: CodeUnit[] = [];

  function visit(node: ts.Node): void {
    const unit = createUnit(node, sourceFile, source, filePath);
    if (unit && unit.metadata.loc >= 3) {
      units.push(unit);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return units;
}

function createUnit(node: ts.Node, sourceFile: ts.SourceFile, source: string, filePath: string): CodeUnit | null {
  const kind = getKind(node);
  if (!kind) return null;

  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const startLine = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(end).line + 1;
  const code = source.slice(start, end);
  const name = getName(node);
  const metadata = getMetadata(node, sourceFile, source, code, start);

  return {
    id: createHash('sha1').update(`${filePath}:${startLine}:${endLine}:${name}`).digest('hex').slice(0, 12),
    name,
    kind,
    filePath,
    startLine,
    endLine,
    code,
    metadata,
  };
}

function getKind(node: ts.Node): CodeUnitKind | null {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isMethodDeclaration(node)) return 'method';
  if (ts.isArrowFunction(node)) return 'arrow';
  return null;
}

function getName(node: ts.Node): string {
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
    return node.name.getText();
  }

  if (ts.isArrowFunction(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  }

  return '<anonymous>';
}

function getMetadata(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  source: string,
  code: string,
  start: number,
): CodeUnitMetadata {
  const lines = code.split(/\r?\n/);
  const commentLines = lines.filter((line) => /^\s*(\/\/|\/\*|\*|\*\/)/.test(line)).length;
  const loc = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
  }).length;
  const identifiers = collectIdentifiers(node);
  const parameters = collectParameters(node);
  const hasJSDoc = /\/\*\*[\s\S]*?\*\/\s*$/.test(source.slice(Math.max(0, start - 400), start));

  return {
    loc,
    commentLines,
    commentRatio: commentLines / Math.max(1, loc + commentLines),
    identifiers,
    nestingDepth: maxNestingDepth(node, sourceFile),
    parameters,
    hasJSDoc,
    complexity: estimateComplexity(node),
  };
}

function collectIdentifiers(node: ts.Node): string[] {
  const identifiers: string[] = [];
  function visit(child: ts.Node): void {
    if (ts.isIdentifier(child)) identifiers.push(child.text);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return identifiers;
}

function collectParameters(node: ts.Node): string[] {
  if (!('parameters' in node)) return [];
  return Array.from((node as ts.SignatureDeclaration).parameters ?? [])
    .map((parameter) => parameter.name.getText())
    .filter(Boolean);
}

function maxNestingDepth(node: ts.Node, sourceFile: ts.SourceFile, depth = 0): number {
  let nextDepth = depth;
  if (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isSwitchStatement(node) ||
    ts.isTryStatement(node)
  ) {
    nextDepth += 1;
  }

  let max = nextDepth;
  ts.forEachChild(node, (child) => {
    max = Math.max(max, maxNestingDepth(child, sourceFile, nextDepth));
  });
  return max;
}

function estimateComplexity(node: ts.Node): number {
  let complexity = 1;
  function visit(child: ts.Node): void {
    if (
      ts.isIfStatement(child) ||
      ts.isForStatement(child) ||
      ts.isForInStatement(child) ||
      ts.isForOfStatement(child) ||
      ts.isWhileStatement(child) ||
      ts.isCaseClause(child) ||
      child.kind === ts.SyntaxKind.QuestionQuestionToken ||
      child.kind === ts.SyntaxKind.BarBarToken ||
      child.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      complexity += 1;
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  return complexity;
}
