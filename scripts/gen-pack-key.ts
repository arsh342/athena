/**
 * Maintainer: create the Ed25519 key pair for signing packs.
 *   node --import tsx scripts/gen-pack-key.ts <private-key-output-path>
 * Keep the private key out of the repository (store it as the PACK_SIGNING_KEY secret) and paste the printed public key
 * into core/src/updates/signature.ts (PACK_PUBLIC_KEY).
 */
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) throw new Error('usage: gen-pack-key.ts <private-key-output-path>');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
