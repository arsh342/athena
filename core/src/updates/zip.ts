import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

/** Minimal streaming-friendly ZIP reader (stored and deflate entries, no ZIP64 data descriptors needed for OSV exports). */
export async function* zipEntries(path: string): AsyncGenerator<{ name: string; read: () => Promise<Buffer> }> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 70_000);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i -= 1) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip file');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) {
      const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd);
      if (loc < 0) throw new Error('zip64 locator missing');
      const z64 = Number(tail.readBigUInt64LE(loc + 8));
      const rec = Buffer.alloc(56);
      await fh.read(rec, 0, 56, z64);
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    let p = 0;
    for (let n = 0; n < count; n += 1) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip directory');
      const method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
      for (let q = 0; q + 4 <= extra.length;) {
        const id = extra.readUInt16LE(q);
        const len = extra.readUInt16LE(q + 2);
        if (id === 1) {
          let r = q + 4;
          if (usize === 0xffffffff) { usize = Number(extra.readBigUInt64LE(r)); r += 8; }
          if (csize === 0xffffffff) { csize = Number(extra.readBigUInt64LE(r)); r += 8; }
          if (offset === 0xffffffff) offset = Number(extra.readBigUInt64LE(r));
        }
        q += 4 + len;
      }
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      yield {
        name,
        read: async () => {
          const head = Buffer.alloc(30);
          await fh.read(head, 0, 30, offset);
          const dataStart = offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
          const raw = Buffer.alloc(csize);
          await fh.read(raw, 0, csize, dataStart);
          return method === 0 ? raw : inflateRawSync(raw);
        },
      };
    }
  } finally {
    await fh.close();
  }
}
