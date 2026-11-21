import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { athenaHome } from '../util/athena-home.js';

export interface DepsClientOptions {
  osvUrl?: string;
  registries?: Partial<Record<'npm' | 'pypi' | 'crates' | 'packagist' | 'nuget' | 'maven' | 'goproxy', string>>;
  /** Use only cached answers (any age). */
  offline?: boolean;
  cacheDir?: string;
  /** Registry metadata TTL (default 24 h). */
  ttlMs?: number;
  /** Advisory TTL (default 6 h). */
  advisoryTtlMs?: number;
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
  now?: () => number;
}

export type Fetched<T> =
  | { kind: 'ok'; data: T; cachedAt?: number }
  | { kind: 'notfound' }
  | { kind: 'unavailable'; reason: string };

export const DEFAULT_URLS = {
  osv: 'https://api.osv.dev',
  npm: 'https://registry.npmjs.org',
  pypi: 'https://pypi.org',
  crates: 'https://crates.io',
  packagist: 'https://repo.packagist.org',
  nuget: 'https://api.nuget.org',
  maven: 'https://search.maven.org',
  goproxy: 'https://proxy.golang.org',
};

/** HTTP + cache with a concurrency limit. Server errors and rate limits become `unavailable`, never "not found". */
/** Registry responses above this size are skipped and reported as an unavailable lookup. */
export const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

export class DepsClient {
  readonly offline: boolean;
  readonly osvUrl: string;
  readonly urls: typeof DEFAULT_URLS;
  readonly stats = { requests: 0, cacheHits: 0, unavailable: 0, oldestCache: Number.POSITIVE_INFINITY };
  private readonly cacheDir: string;
  private readonly ttl: number;
  private readonly advisoryTtl: number;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly now: () => number;
  private readonly limit: number;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(options: DepsClientOptions = {}) {
    this.offline = options.offline ?? false;
    this.osvUrl = options.osvUrl ?? DEFAULT_URLS.osv;
    this.urls = { ...DEFAULT_URLS, osv: this.osvUrl, ...(options.registries ?? {}) };
    this.cacheDir = options.cacheDir ?? join(athenaHome(), 'cache', 'deps');
    this.ttl = options.ttlMs ?? 24 * 3600 * 1000;
    this.advisoryTtl = options.advisoryTtlMs ?? 6 * 3600 * 1000;
    this.timeout = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    this.now = options.now ?? Date.now;
    this.limit = options.concurrency ?? 8;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }

  private keyFile(method: string, url: string, body?: string): string {
    return join(this.cacheDir, `${createHash('sha1').update(`${method} ${url} ${body ?? ''}`).digest('hex')}.json`);
  }

  private async readCache<T>(file: string, maxAge: number | null): Promise<{ data: T; at: number; notfound?: boolean } | null> {
    try {
      const entry = JSON.parse(await readFile(file, 'utf8')) as { at: number; data: T; notfound?: boolean };
      if (maxAge !== null && this.now() - entry.at > maxAge) return null;
      return entry;
    } catch {
      return null;
    }
  }

  private async writeCache(file: string, entry: { at: number; data: unknown; notfound?: boolean }): Promise<void> {
    try {
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(file, JSON.stringify(entry));
    } catch {
      // the cache is best effort
    }
  }

  /** `advisory` selects the shorter TTL. A 404 is cached as "not found" for the same TTL. */
  /**
   * `slim` reduces a response to the fields the caller uses BEFORE it is cached or returned: registry documents list every release of a package
   * (tens of MB for popular ones) and keeping them whole made a scan's memory grow by hundreds of MB. Responses larger than `maxBytes` are not read at all.
   */
  async json<T>(method: 'GET' | 'POST', url: string, options: { body?: unknown; advisory?: boolean; headers?: Record<string, string>; slim?: (data: any) => unknown; maxBytes?: number } = {}): Promise<Fetched<T>> {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const file = this.keyFile(method, url, body);
    const ttl = options.advisory ? this.advisoryTtl : this.ttl;
    const fresh = await this.readCache<T>(file, ttl);
    if (fresh) {
      this.stats.cacheHits += 1;
      this.stats.oldestCache = Math.min(this.stats.oldestCache, fresh.at);
      return fresh.notfound ? { kind: 'notfound' } : { kind: 'ok', data: fresh.data, cachedAt: fresh.at };
    }
    if (this.offline) {
      const stale = await this.readCache<T>(file, null);
      if (stale) {
        this.stats.cacheHits += 1;
        this.stats.oldestCache = Math.min(this.stats.oldestCache, stale.at);
        return stale.notfound ? { kind: 'notfound' } : { kind: 'ok', data: stale.data, cachedAt: stale.at };
      }
      this.stats.unavailable += 1;
      return { kind: 'unavailable', reason: 'offline and not cached' };
    }
    return this.slot(async () => {
      let reason = 'request failed';
      for (let attempt = 0; attempt <= this.retries; attempt += 1) {
        this.stats.requests += 1;
        try {
          const response = await fetch(url, {
            method,
            headers: { accept: 'application/json', 'user-agent': 'athena-cli', ...(body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
            ...(body ? { body } : {}),
            signal: AbortSignal.timeout(this.timeout),
          });
          if (response.status === 404 || response.status === 410) {
            await this.writeCache(file, { at: this.now(), data: null, notfound: true });
            return { kind: 'notfound' } as const;
          }
          if (response.status === 429 || response.status >= 500) {
            reason = `HTTP ${response.status}`;
            if (attempt < this.retries) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
            continue;
          }
          if (!response.ok) {
            this.stats.unavailable += 1;
            return { kind: 'unavailable', reason: `HTTP ${response.status}` } as const;
          }
          const length = Number(response.headers.get('content-length') ?? 0);
          const cap = options.maxBytes ?? MAX_RESPONSE_BYTES;
          if (length > cap) {
            await response.body?.cancel().catch(() => {});
            this.stats.unavailable += 1;
            return { kind: 'unavailable', reason: `response too large (${Math.round(length / 1048576)} MB)` } as const;
          }
          const raw = (await response.json()) as unknown;
          const data = (options.slim ? options.slim(raw) : raw) as T;
          await this.writeCache(file, { at: this.now(), data });
          return { kind: 'ok', data } as const;
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error);
          if (attempt < this.retries) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        }
      }
      this.stats.unavailable += 1;
      return { kind: 'unavailable', reason } as const;
    });
  }
}
