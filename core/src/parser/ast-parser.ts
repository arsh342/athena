import { readFile } from 'node:fs/promises';

import { detectLanguage, type LanguageId } from '../lang/languages.js';
import { getLoadedParser, getParser, ParserUnavailableError } from '../lang/parser-pool.js';
import { extractUnits, extractWithParser } from '../lang/units.js';
import type { CodeUnit } from '../types.js';

export interface ParseFileResult {
  units: CodeUnit[];
  error?: string;
  /** Detected language; absent when the file could not be read or is not a supported language. */
  language?: LanguageId;
  /** True when the language's grammar could not be loaded (a coverage gap, not a file problem). */
  parserUnavailable?: boolean;
  /** Number of lines in the file. */
  lines?: number;
}

export async function parseFile(filePath: string): Promise<CodeUnit[]> {
  return (await parseFileDetailed(filePath)).units;
}

const TEXT_PROBE_BYTES = 8192;

/** Reads, detects the language and extracts units; reports read, text, grammar and syntax problems. */
export async function parseFileDetailed(filePath: string): Promise<ParseFileResult> {
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    return { units: [], error: error instanceof Error ? error.message : String(error) };
  }
  if (bytes.subarray(0, TEXT_PROBE_BYTES).includes(0)) return { units: [], error: 'not a text file' };
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { units: [], error: 'not a text file' };
  }

  const newline = source.indexOf('\n');
  const language = detectLanguage(filePath, newline === -1 ? source : source.slice(0, newline));
  if (!language) return { units: [], error: 'unsupported language' };
  const lines = countLines(source);

  try {
    const { units, error } = await extractUnits(filePath, source, language);
    return error ? { units, error, language, lines } : { units, language, lines };
  } catch (error) {
    if (error instanceof ParserUnavailableError) {
      return { units: [], error: 'parser unavailable', language, parserUnavailable: true, lines };
    }
    throw error;
  }
}

/**
 * Synchronous parse for callers that already loaded the grammar (see warmParsers).
 * Throws if the language's parser has not been loaded yet.
 */
export function parseSource(filePath: string, source: string): CodeUnit[] {
  const newline = source.indexOf('\n');
  const language = detectLanguage(filePath, newline === -1 ? source : source.slice(0, newline)) ?? 'typescript';
  const parser = getLoadedParser(language);
  if (!parser) throw new Error('call parseFileDetailed first or await warmParsers()');
  return extractWithParser(parser, filePath, source, language).units;
}

/** Load grammars ahead of time (all supported languages by default). Grammars that fail to load are skipped. */
export async function warmParsers(langs?: LanguageId[]): Promise<void> {
  const all: LanguageId[] = ['javascript', 'typescript', 'tsx', 'python', 'java', 'csharp', 'c', 'cpp', 'go', 'rust', 'php', 'shell'];
  await Promise.all((langs ?? all).map((lang) => getParser(lang).catch(() => undefined)));
}

function countLines(source: string): number {
  if (source.length === 0) return 0;
  let count = 1;
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) count += 1;
  return source.endsWith('\n') ? count - 1 : count;
}
