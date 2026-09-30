/**
 * Digest of the offline receipt verifier the issuer vouches for.
 * Null until packages/verify publishes BUILD_DIGEST.txt. The tree genesis
 * leaf copies whatever this returns at the moment the tree is created.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIGEST_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/verify/BUILD_DIGEST.txt',
);

export function verifierBuildDigest() {
  try {
    const text = fs.readFileSync(DIGEST_FILE, 'utf8').trim().split(/\s+/)[0];
    if (/^[0-9a-fA-F]{64}$/.test(text)) return text.toLowerCase();
    return null;
  } catch {
    return null;
  }
}
