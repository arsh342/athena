import { spawn } from 'node:child_process';
import {
  describeUpdate, dbStatus, ecosystemsFor, fetchLatestPack, installPack, needsUpdate, PACK_PUBLIC_KEY, packState, PackRejected,
  rollbackPack, runUpdate, updateRunning,
} from '@athena/core';
import { writeInfo } from '../utils/output.js';

const PACK_REPO = 'arsh342/athena';

export interface UpdateOptions { ecosystem?: string; rollback?: boolean; packs?: boolean; path?: string; quiet?: boolean }

/** `athena update`: refresh advisory data (+KEV, EPSS) for the ecosystems you use, then the signed rule/skill pack. */
export async function updateCommand(opts: UpdateOptions = {}): Promise<number> {
  if (opts.rollback) {
    const r = rollbackPack();
    if (!r) {
      writeInfo('no pack is active, nothing to roll back');
      return 2;
    }
    writeInfo(`rolled back pack ${r.from} -> ${r.to ?? 'built-in skills only'}`);
    return 0;
  }
  const requested = opts.ecosystem?.split(',').map((s) => s.trim()).filter(Boolean);
  const ecosystems = requested && requested.length > 0 ? requested : await ecosystemsFor(opts.path ?? process.cwd());
  let exit = 0;
  if (ecosystems.length === 0) writeInfo('no ecosystems detected here; use --ecosystem npm,PyPI,... to choose');
  else {
    if (!opts.quiet) writeInfo(`updating advisory data for ${ecosystems.join(', ')} (first sync downloads each ecosystem once; later syncs fetch only changes)`);
    const summary = await runUpdate({ ecosystems });
    if (!summary) {
      writeInfo('another update is already running');
      return 0;
    }
    for (const line of describeUpdate(summary)) writeInfo(line);
    if (summary.errors.length > 0) exit = 1;
  }
  if (opts.packs !== false) {
    try {
      const state = packState();
      const pack = await fetchLatestPack({ repo: PACK_REPO, currentVersion: state.current });
      if (!pack) writeInfo(`rule pack: up to date${state.current ? ` (${state.current})` : ''}`);
      else {
        const manifest = await installPack({ tarGz: pack.tarGz, signature: pack.signature, publicKey: PACK_PUBLIC_KEY, ...(pack.sha256 ? { expectedSha256: pack.sha256 } : {}) });
        writeInfo(`rule pack ${manifest.version} installed (${manifest.skills.length} skills${manifest.changelog?.length ? `, ${manifest.changelog.length} new detections` : ''})`);
      }
    } catch (error) {
      writeInfo(`rule pack not updated: ${error instanceof PackRejected ? `rejected — ${error.message}` : error instanceof Error ? error.message : String(error)}`);
      if (error instanceof PackRejected) exit = 1;
    }
  }
  return exit;
}

/**
 * Start a detached background update when local advisory data is older than `intervalHours`. Never waits, never throws;
 * only refreshes ecosystems that were already synced with `athena update`.
 */
export function startBackgroundUpdate(intervalHours: number): boolean {
  try {
    if (dbStatus().length === 0 || !needsUpdate(intervalHours) || updateRunning()) return false;
    const entry = process.argv[1];
    if (!entry) return false;
    const child = spawn(process.execPath, [entry, 'update', '--no-packs', '--quiet'], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}
