import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { athenaHome } from '@athena/core';

/** User-level settings, kept in ~/.athena/settings.json (mode 0600). Sharing is off until the person turns it on. */
export interface Settings {
  share?: 'on' | 'off';
  /** The one-time consent question has been asked (the answer is in `share`). */
  shareAsked?: boolean;
  /** The collection server. There is no built-in default: sharing does nothing until one is set. */
  shareUrl?: string;
  installId?: string;
  installIdCreatedAt?: string;
  /** Earlier install ids, so "delete everything I sent" reaches records sent before a rotation. */
  pastInstallIds?: string[];
  sentTotal?: number;
}

export const INSTALL_ID_DAYS = 90;
const MAX_PAST_IDS = 20;

const file = (home?: string): string => join(home ?? athenaHome(), 'settings.json');

export function loadSettings(home?: string): Settings {
  try {
    const raw = JSON.parse(readFileSync(file(home), 'utf8')) as Settings;
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings: Settings, home?: string): void {
  const dir = home ?? athenaHome();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = file(home);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, target);
}

/** A random id with no link to the person or machine. Rotated every 90 days; the old one is remembered only so deletion can reach it. */
export function ensureInstallId(settings: Settings, now: Date = new Date()): Settings {
  const created = settings.installIdCreatedAt ? Date.parse(settings.installIdCreatedAt) : NaN;
  const fresh = settings.installId && Number.isFinite(created) && now.getTime() - created < INSTALL_ID_DAYS * 86_400_000;
  if (fresh) return settings;
  const past = settings.installId ? [...(settings.pastInstallIds ?? []), settings.installId].slice(-MAX_PAST_IDS) : (settings.pastInstallIds ?? []);
  return { ...settings, installId: randomBytes(16).toString('hex'), installIdCreatedAt: now.toISOString(), pastInstallIds: past };
}

/** Where to send: ATHENA_SHARE_URL, else the saved setting. Must be https (http only for localhost, for development). */
export function shareUrl(settings: Settings, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.ATHENA_SHARE_URL ?? settings.shareUrl ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return raw;
  } catch { /* not a URL */ }
  return null;
}

export interface SharingState { on: boolean; reason: string }

/**
 * Whether labels may be sent right now. Off unless the person turned it on; a repository can force it off for everyone who scans it
 * (a repository setting of "on" is ignored); never in CI; and nothing happens without a server address.
 */
export function sharingState(settings: Settings, repoShare: 'off' | 'on' | undefined, env: NodeJS.ProcessEnv, ci: boolean): SharingState {
  if (settings.share !== 'on') return { on: false, reason: 'sharing is off' };
  if (repoShare === 'off') return { on: false, reason: 'this repository turns sharing off (athena.config.json)' };
  if (ci) return { on: false, reason: 'not sent from CI' };
  if (!shareUrl(settings, env)) return { on: false, reason: 'no collection server is configured (set ATHENA_SHARE_URL)' };
  return { on: true, reason: 'sharing is on' };
}
