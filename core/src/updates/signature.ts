import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

/**
 * Ed25519 public key (PEM) that official rule/skill packs are signed with. It is provisioned by the maintainer
 * (scripts/gen-pack-key.ts creates the pair; the private key never enters the repository). Empty until provisioned:
 * the CLI then refuses official packs instead of trusting an unknown signer.
 */
export const PACK_PUBLIC_KEY = '';

export const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** Verify a detached base64 Ed25519 signature over `data`. Any malformed input is simply "not valid". */
export function verifyDetached(data: Buffer, signatureB64: string, publicKeyPem: string): boolean {
  try {
    if (!publicKeyPem.trim()) return false;
    const key: KeyObject = createPublicKey(publicKeyPem);
    return verify(null, data, key, Buffer.from(signatureB64.trim(), 'base64'));
  } catch {
    return false;
  }
}

/** Maintainer-side signing (used by scripts/build-pack.ts and tests). */
export function signDetached(data: Buffer, privateKeyPem: string): string {
  return sign(null, data, privateKeyPem).toString('base64');
}
