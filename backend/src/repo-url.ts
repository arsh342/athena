import { isIP } from 'node:net';

const ALLOWED_PROTOCOLS = new Set(['https:']);

function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split('.').map(Number);
    if (octets.length !== 4 || octets.some((item) => Number.isNaN(item) || item < 0 || item > 255)) return true;

    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;

    return false;
  }

  if (ipVersion === 6) {
    if (normalized === '::1') return true;
    if (normalized.startsWith('fe80:')) return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  }

  return false;
}

export function validateRepoUrl(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'repoUrl is required' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'repoUrl must be a valid URL' };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, error: 'Only https repository URLs are allowed' };
  }

  if (!parsed.hostname || isPrivateOrLocalHost(parsed.hostname)) {
    return { ok: false, error: 'Private or local repository hosts are not allowed' };
  }

  parsed.hash = '';
  return { ok: true, value: parsed.toString() };
}
