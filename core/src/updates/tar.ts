import { gunzipSync, gzipSync } from 'node:zlib';

export interface TarEntry { path: string; data: Buffer }

export class TarError extends Error {}

const MAX_ENTRIES = 3000;
const MAX_BYTES = 60 * 1024 * 1024;

/** Read a .tar.gz of regular files only: links, devices, absolute or `..` paths and oversize archives are errors. */
export function readTarGz(gz: Buffer): TarEntry[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(gz, { maxOutputLength: MAX_BYTES });
  } catch (error) {
    throw new TarError(`not a valid gzip archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  const out: TarEntry[] = [];
  let p = 0;
  while (p + 512 <= tar.length) {
    const header = tar.subarray(p, p + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '');
    const size = parseInt(header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 32 : header[i]!;
    if (sum !== parseInt(header.toString('utf8', 148, 154).trim() || '-1', 8)) throw new TarError('corrupt tar header');
    const path = (prefix ? `${prefix}/${name}` : name).replace(/^\.\//, '');
    p += 512;
    if (!Number.isFinite(size) || size < 0 || p + size > tar.length) throw new TarError('truncated archive');
    if (type === '5') {
      p += Math.ceil(size / 512) * 512;
      continue;
    }
    if (type !== '0') throw new TarError(`unsupported entry type "${type}" for ${path} (only regular files are allowed)`);
    if (!path || path.startsWith('/') || path.split('/').includes('..') || path.includes('\\') || path.includes('\0')) throw new TarError(`unsafe path ${JSON.stringify(path)}`);
    out.push({ path, data: Buffer.from(tar.subarray(p, p + size)) });
    if (out.length > MAX_ENTRIES) throw new TarError('too many files');
    p += Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Maintainer-side/test helper: build a .tar.gz from path -> content. */
export function makeTarGz(files: Record<string, string | Buffer>, options: { symlink?: string } = {}): Buffer {
  const blocks: Buffer[] = [];
  const add = (path: string, data: Buffer, type = '0') => {
    const header = Buffer.alloc(512);
    header.write(path, 0, 100);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write('        ', 148);
    header.write(type, 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    let sum = 0;
    for (const b of header) sum += b;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  };
  for (const [path, content] of Object.entries(files)) add(path, Buffer.from(content));
  if (options.symlink) add(options.symlink, Buffer.alloc(0), '2');
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
