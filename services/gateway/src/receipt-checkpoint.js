/**
 * C2SP tlog-checkpoint (signed note) for the receipt log.
 *
 * The note text is origin, tree size, base64 root, then one extension line.
 * A blank line separates the text from the signature. The signature is a
 * signed-note line: em dash, key name, base64(4-byte key id || ASN.1 ECDSA).
 * The key id is the first four bytes of SHA-256(SPKI DER), which is signature
 * type 0x02 in c2sp.org/signed-note. The issuer ES256 key signs the note text.
 *
 * Each epoch has its own origin (`chit402.com/receipt-log/<epoch>`). A reset
 * is not an RFC 6962 extension of the previous tree, and a log must not sign
 * two inconsistent checkpoints for one origin. The extension line carries the
 * previous epoch's size and root. Monitors that ignore extension lines still
 * see an append-only log inside the epoch.
 *
 * The extension line is non-empty, has no leading or trailing space, and is
 * one line. Integers have no leading zeros. The previous root, when present,
 * is standard base64 with padding.
 */
import crypto from 'crypto';
import { initIssuerKey } from './issuer-key.js';

export const CHECKPOINT_ORIGIN_PREFIX = 'chit402.com/receipt-log';
const EM_DASH = '\u2014';

export function checkpointOrigin(epoch) {
  const n = Number(epoch);
  if (!Number.isInteger(n) || n < 1) throw new Error('bad_epoch');
  return `${CHECKPOINT_ORIGIN_PREFIX}/${n}`;
}

function decimal(n) {
  const value = Number(n);
  if (!Number.isInteger(value) || value < 0) throw new Error('bad_decimal');
  return String(value);
}

function b64Root(hex) {
  const raw = String(hex || '').replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error('bad_root');
  return Buffer.from(raw, 'hex').toString('base64');
}

/**
 * One extension line: `epoch <epoch> <prev_epoch_size> [<base64 prev root>]`.
 * Epoch 1 has prev size 0 and no root. A later epoch includes the previous
 * root. The line is opaque to a client that does not know this name.
 */
export function epochExtensionLine({ epoch, prevEpochSize = 0, prevEpochRoot = null }) {
  const size = Number(prevEpochSize || 0);
  if (!Number.isInteger(size) || size < 0) throw new Error('bad_prev_size');
  if (size === 0) return `epoch ${decimal(epoch)} 0`;
  if (!prevEpochRoot) throw new Error('missing_prev_root');
  return `epoch ${decimal(epoch)} ${decimal(size)} ${b64Root(prevEpochRoot)}`;
}

/**
 * Note text, including its final newline. The blank line before the
 * signature is not part of this string.
 */
export function checkpointNoteText({
  epoch,
  treeSize,
  root,
  prevEpochSize = 0,
  prevEpochRoot = null,
}) {
  const size = Number(treeSize);
  if (!Number.isInteger(size) || size < 1) throw new Error('bad_tree_size');
  const extension = epochExtensionLine({ epoch, prevEpochSize, prevEpochRoot });
  if (!extension || extension.includes('\n') || extension !== extension.trim()) {
    throw new Error('bad_extension');
  }
  return [
    checkpointOrigin(epoch),
    decimal(size),
    b64Root(root),
    extension,
    '',
  ].join('\n');
}

function issuerMaterial(privateKey = null) {
  const key = privateKey || initIssuerKey().privateKey;
  const publicKey = crypto.createPublicKey(key);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const keyId = crypto.createHash('sha256').update(spki).digest().subarray(0, 4);
  return { key, publicKey, spki, keyId };
}

/**
 * Sign `noteText` (the checkpoint body, including its trailing newline).
 * Returns the full signed note, including the separating blank line.
 */
export function signCheckpointNote(noteText, privateKey = null) {
  const text = Buffer.from(String(noteText), 'utf8');
  if (!text.length || text[text.length - 1] !== 0x0a) throw new Error('note_text');
  const { key, keyId } = issuerMaterial(privateKey);
  const der = crypto.sign('sha256', text, { key, dsaEncoding: 'der' });
  const packed = Buffer.concat([keyId, der]).toString('base64');
  const origin = String(noteText).split('\n', 1)[0];
  return `${noteText}\n${EM_DASH} ${origin} ${packed}\n`;
}

export function signTreeCheckpoint(fields, privateKey = null) {
  return signCheckpointNote(checkpointNoteText(fields), privateKey);
}

/**
 * Verify one signed note against a P-256 public key (KeyObject or JWK).
 * Unknown signature names are ignored. A known name with a bad signature
 * fails the note. Returns the parsed body when one signature verifies.
 */
export function verifyCheckpointNote(note, publicKey) {
  const text = String(note || '');
  let parts = text.split('\n');
  if (parts.length && parts[parts.length - 1] === '') parts = parts.slice(0, -1);
  let split = -1;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (parts[i] === '') {
      split = i;
      break;
    }
  }
  if (split < 3) return { ok: false, reason: 'note_shape' };
  const bodyLines = parts.slice(0, split);
  const sigLines = parts.slice(split + 1).filter((line) => line.length > 0);
  if (bodyLines.length < 4) return { ok: false, reason: 'note_shape' };
  if (bodyLines.some((line) => line.length === 0)) return { ok: false, reason: 'empty_line' };
  const noteText = `${bodyLines.join('\n')}\n`;
  const origin = bodyLines[0];
  const treeSize = bodyLines[1];
  const rootB64 = bodyLines[2];
  const extension = bodyLines[3];
  if (!/^(0|[1-9][0-9]*)$/.test(treeSize)) return { ok: false, reason: 'bad_size' };
  let root;
  try {
    root = Buffer.from(rootB64, 'base64');
  } catch {
    return { ok: false, reason: 'bad_root' };
  }
  if (root.length !== 32 || root.toString('base64') !== rootB64) return { ok: false, reason: 'bad_root' };
  const epochLine = parseEpochExtension(extension);
  if (!epochLine) return { ok: false, reason: 'bad_extension' };
  if (origin !== checkpointOrigin(epochLine.epoch)) return { ok: false, reason: 'origin' };

  const keyObj = publicKey?.type === 'public' || publicKey?.type === 'private'
    ? crypto.createPublicKey(publicKey)
    : crypto.createPublicKey({ key: publicKey, format: 'jwk' });
  const spki = keyObj.export({ type: 'spki', format: 'der' });
  const keyId = crypto.createHash('sha256').update(spki).digest().subarray(0, 4);
  let saw = false;
  let verified = false;
  for (const line of sigLines) {
    if (!line.startsWith(`${EM_DASH} `)) return { ok: false, reason: 'sig_line' };
    const rest = line.slice(EM_DASH.length + 1);
    const space = rest.lastIndexOf(' ');
    if (space <= 0) return { ok: false, reason: 'sig_line' };
    const name = rest.slice(0, space);
    const packed = Buffer.from(rest.slice(space + 1), 'base64');
    if (name !== origin) continue;
    if (packed.length < 5 || !packed.subarray(0, 4).equals(keyId)) continue;
    saw = true;
    const ok = crypto.verify('sha256', Buffer.from(noteText), { key: keyObj, dsaEncoding: 'der' }, packed.subarray(4));
    if (ok) verified = true;
    else return { ok: false, reason: 'bad_signature' };
  }
  if (!saw || !verified) return { ok: false, reason: 'no_signature' };
  return {
    ok: true,
    origin,
    tree_size: Number(treeSize),
    root: root.toString('hex'),
    extension,
    epoch: epochLine.epoch,
    prev_epoch_size: epochLine.prevEpochSize,
    prev_epoch_root: epochLine.prevEpochRoot,
  };
}

export function parseEpochExtension(line) {
  const parts = String(line || '').split(' ');
  if (parts[0] !== 'epoch' || parts.length < 3 || parts.length > 4) return null;
  if (!/^[1-9][0-9]*$/.test(parts[1])) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(parts[2])) return null;
  const epoch = Number(parts[1]);
  const prevEpochSize = Number(parts[2]);
  if (prevEpochSize === 0) {
    if (parts.length !== 3) return null;
    return { epoch, prevEpochSize: 0, prevEpochRoot: null };
  }
  if (parts.length !== 4) return null;
  let prev;
  try {
    prev = Buffer.from(parts[3], 'base64');
  } catch {
    return null;
  }
  if (prev.length !== 32 || prev.toString('base64') !== parts[3]) return null;
  return { epoch, prevEpochSize, prevEpochRoot: prev.toString('hex') };
}
