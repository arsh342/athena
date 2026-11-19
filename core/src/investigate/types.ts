import type { LanguageId } from '../lang/languages.js';
import type { RawFinding } from '../rules/types.js';

export type Exposure = 'public' | 'authenticated' | 'internal';
export type EntryKind = 'route' | 'cli' | 'queue' | 'upload' | 'websocket' | 'cron' | 'script';

export interface EntryPoint {
  file: string;
  line: number;
  kind: EntryKind;
  method?: string;
  route?: string;
  exposure: Exposure;
  guards: string[];
  /** Name of the handler function, or '' for an inline handler. */
  handler: string;
  /** Line range of the handler body (inline handlers or resolved named handlers). */
  range?: [number, number];
}

export interface FnFact {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  /** Last path segment of every callee, e.g. `a.b.run()` -> `run`. */
  calls: string[];
  isAsync: boolean;
}

export interface RouteFact {
  file: string;
  line: number;
  label: string;
  hasAuth: boolean;
  hasValidation: boolean;
  usesInput: boolean;
  /** Router/controller the route belongs to (file by default). */
  group: string;
  declaredPublic: boolean;
}

export interface QueryFact {
  file: string;
  line: number;
  table: string;
  verb: 'select' | 'update' | 'delete';
  hasWhere: boolean;
  hasOwnerFilter: boolean;
  /** True when the surrounding function is not a route handler but a helper (still counted). */
  snippet: string;
}

export interface StateUnion {
  file: string;
  line: number;
  name: string;
  members: string[];
}

export interface FileFacts {
  path: string;
  lang: LanguageId;
  isTest: boolean;
  functions: FnFact[];
  entrypoints: EntryPoint[];
  routes: RouteFact[];
  queries: QueryFact[];
  assignedStates: string[];
  unions: StateUnion[];
}

export interface CodebaseMap {
  entrypoints: EntryPoint[];
  callGraph: Map<string, Set<string>>;
  /** Directories at depth 1-2 that hold source, with file counts (rough components). */
  components: Array<{ path: string; files: number }>;
}

export interface InvestigationOptions {
  publicRoutes?: string[];
}

export type InvestigationFindings = Map<string, RawFinding[]>;

const TEST_DIRS = /(?:^|[\\/])(?:tests?|__tests__|specs?|e2e|cypress|fixtures?|mocks?|__mocks__)[\\/]/i;
const TEST_FILES = /\.(?:test|spec)\.\w+$|_test\.(?:go|py)$|(?:Tests?|IT)\.(?:java|cs)$/;

/** Is this path (relative to the scan root!) test or fixture code? Absolute paths would match the user's own folders. */
export function isTestPath(relativePath: string): boolean {
  return TEST_DIRS.test(relativePath) || TEST_FILES.test(relativePath);
}
