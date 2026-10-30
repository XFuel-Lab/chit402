/**
 * KMS secp256k1 checkpoint signer for Chit Simple v13.
 *
 * Sign path: KMS Sign (MessageType DIGEST) → strict DER → low-S on the
 * secp256k1 order (DS-123) → y-parity by trial recovery → EIP-1559.
 * The client is injected. This module never builds an AWS client and never
 * reads a private key.
 *
 * DS-75: the anchor intent is appended and fsynced before the signature is
 * requested, and the signed raw transaction is appended and fsynced before
 * broadcast. Fee bumps keep the same nonce and the same calldata.
 * DS-65: domain = SHA-256("chit402-checkpoint-v1" || chainId || contract)
 * is committed with the epoch and must sit in the calldata the signature covers.
 */

import { createHash, createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SECP256K1,
  bytesToHex,
  checkpointDomain,
  derToRaw,
  eip1559Decode,
  eip1559Digest,
  eip1559Serialize,
  eip1559TxHash,
  ethereumAddress,
  hexToBytes,
  lowS,
  yParityByTrial,
} from '../../packages/cs2-core/ecdsa/index.js';

const CURVE = SECP256K1;
const MESSAGE_TYPE = 'DIGEST';
const SIGNING_ALGORITHM = 'ECDSA_SHA_256';

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function unavailable() {
  return coded('checkpoint sign unavailable', 'checkpoint_sign_unavailable');
}

function invalid() {
  return coded('checkpoint sign invalid', 'checkpoint_sign_invalid');
}

function kmsConfig(env) {
  const source = env || {};
  const keyId = String(source.CHIT_CHECKPOINT_KMS_KEY_ID || '').trim();
  const region = String(source.CHIT_CHECKPOINT_KMS_REGION || '').trim();
  const pinned = String(source.CHIT_CHECKPOINT_ADDRESS || '').trim();
  if (!keyId || !region) throw coded('checkpoint kms config is incomplete', 'checkpoint_kms_config');
  let timeoutMs = 3000;
  const timeoutRaw = source.CHIT_CHECKPOINT_KMS_TIMEOUT_MS;
  if (timeoutRaw != null && String(timeoutRaw).trim() !== '') {
    const n = Number(timeoutRaw);
    if (Number.isFinite(n) && n > 0) timeoutMs = Math.floor(n);
  }
  return { keyId, region, pinned, timeoutMs };
}

function publicKeyFromSpki(out, pinned) {
  if (out?.KeySpec !== 'ECC_SECG_P256K1') throw coded('checkpoint kms key spec', 'checkpoint_key_type');
  if (out?.KeyUsage !== 'SIGN_VERIFY') throw coded('checkpoint kms key usage', 'checkpoint_key_type');
  const algs = out?.SigningAlgorithms || [];
  const list = Array.isArray(algs) ? algs : [...algs];
  if (!list.includes(SIGNING_ALGORITHM)) throw coded('checkpoint kms signing algorithm', 'checkpoint_key_type');
  let jwk;
  try {
    const key = createPublicKey({ key: Buffer.from(out.PublicKey || []), format: 'der', type: 'spki' });
    jwk = key.export({ format: 'jwk' });
  } catch {
    throw coded('checkpoint kms key is not secp256k1', 'checkpoint_key_type');
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'secp256k1' || !jwk.x || !jwk.y) {
    throw coded('checkpoint kms key is not secp256k1', 'checkpoint_key_type');
  }
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  if (x.length !== 32 || y.length !== 32) throw coded('checkpoint kms key is not secp256k1', 'checkpoint_key_type');
  const publicKey = Buffer.concat([Buffer.from([0x04]), x, y]);
  const address = ethereumAddress(publicKey);
  if (pinned && pinned.toLowerCase() !== address) {
    throw coded('checkpoint address does not match the configured address', 'checkpoint_address_mismatch');
  }
  return { publicKey, address };
}

/**
 * @param {{ client: { send: Function }, env?: NodeJS.ProcessEnv }} opts
 */
export async function createCheckpointSigner({ client, env = {} } = {}) {
  if (!client || typeof client.send !== 'function') {
    throw coded('checkpoint kms client is missing', 'checkpoint_kms_config');
  }
  const { keyId, pinned, timeoutMs } = kmsConfig(env);
  let pub;
  try {
    pub = await client.send({
      name: 'GetPublicKey',
      input: { KeyId: keyId },
    }, { abortSignal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.code === 'checkpoint_key_type' || err?.code === 'checkpoint_address_mismatch' || err?.code === 'checkpoint_kms_config') {
      throw err;
    }
    throw unavailable();
  }
  const material = publicKeyFromSpki(pub, pinned);
  return {
    kind: 'kms-secp256k1',
    keyId,
    address: material.address,
    publicKey: material.publicKey,
    async signDigest(digest) {
      const message = Buffer.isBuffer(digest) ? digest : Buffer.from(digest || []);
      if (message.length !== 32) throw invalid();
      let out;
      try {
        out = await client.send({
          name: 'Sign',
          input: {
            KeyId: keyId,
            Message: message,
            MessageType: MESSAGE_TYPE,
            SigningAlgorithm: SIGNING_ALGORITHM,
          },
        }, { abortSignal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        if (err?.code === 'checkpoint_sign_invalid') throw err;
        throw unavailable();
      }
      let raw;
      try {
        raw = lowS(derToRaw(Buffer.from(out?.Signature || []), CURVE), CURVE);
      } catch {
        throw invalid();
      }
      let yParity;
      try {
        yParity = yParityByTrial(message, raw, material.publicKey, CURVE);
      } catch {
        throw invalid();
      }
      return { raw, r: raw.subarray(0, 32), s: raw.subarray(32), yParity };
    },
    async signEip1559(tx) {
      const digest = eip1559Digest(tx);
      const sig = await this.signDigest(digest);
      const raw = eip1559Serialize(tx, sig);
      return { raw, hash: eip1559TxHash(raw), yParity: sig.yParity, from: material.address };
    },
  };
}

function hex32(value, label) {
  let bytes;
  try {
    bytes = hexToBytes(value);
  } catch {
    throw coded(`${label} must be 32 bytes`, 'bad_anchor');
  }
  if (bytes.length !== 32) throw coded(`${label} must be 32 bytes`, 'bad_anchor');
  return bytesToHex(bytes);
}

function addressHex(value) {
  let bytes;
  try {
    bytes = hexToBytes(value);
  } catch {
    throw coded('contract must be 20 bytes', 'bad_anchor');
  }
  if (bytes.length !== 20) throw coded('contract must be 20 bytes', 'bad_anchor');
  return bytesToHex(bytes);
}

function normalizeAnchor(anchor) {
  const chainId = BigInt(anchor?.chainId);
  const nonce = BigInt(anchor?.nonce);
  const epoch = BigInt(anchor?.epoch);
  const hourStart = BigInt(anchor?.hourStart);
  const size = BigInt(anchor?.size);
  if (chainId < 0n || nonce < 0n || epoch < 0n || hourStart < 0n || size < 0n) {
    throw coded('negative anchor field', 'bad_anchor');
  }
  const to = addressHex(anchor.to);
  const root = hex32(anchor.root, 'root');
  const stateRoot = hex32(anchor.stateRoot, 'stateRoot');
  const calldata = bytesToHex(hexToBytes(anchor.calldata ?? anchor.data ?? ''));
  const domain = bytesToHex(checkpointDomain(chainId, to));
  if (!calldata.includes(domain) || !calldata.includes(root) || !calldata.includes(stateRoot)) {
    throw coded('calldata does not cover the committed anchor', 'intent_payload_mismatch');
  }
  const body = [
    `chainId=${chainId}`,
    `to=${to}`,
    `epoch=${epoch}`,
    `hourStart=${hourStart}`,
    `size=${size}`,
    `root=${root}`,
    `stateRoot=${stateRoot}`,
    `domain=${domain}`,
    `calldata=${calldata}`,
  ].join('|');
  const fingerprint = createHash('sha256').update(body).digest('hex');
  return {
    chainId: chainId.toString(),
    to,
    nonce: nonce.toString(),
    epoch: epoch.toString(),
    hourStart: hourStart.toString(),
    size: size.toString(),
    root,
    stateRoot,
    domain,
    calldata,
    fingerprint,
  };
}

function normalizeFees(fees) {
  let gasLimit;
  let maxFeePerGas;
  let maxPriorityFeePerGas;
  try {
    gasLimit = BigInt(fees?.gasLimit);
    maxFeePerGas = BigInt(fees?.maxFeePerGas);
    maxPriorityFeePerGas = BigInt(fees?.maxPriorityFeePerGas);
  } catch {
    throw coded('bad fees', 'bad_fees');
  }
  if (gasLimit <= 0n || maxFeePerGas <= 0n || maxPriorityFeePerGas < 0n || maxPriorityFeePerGas > maxFeePerGas) {
    throw coded('bad fees', 'bad_fees');
  }
  return {
    gasLimit: gasLimit.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
  };
}

function feesMatch(a, b) {
  return a && b
    && a.gasLimit === b.gasLimit
    && a.maxFeePerGas === b.maxFeePerGas
    && a.maxPriorityFeePerGas === b.maxPriorityFeePerGas;
}

function intentBody(row) {
  return {
    chain: 'base',
    chainId: row.chainId,
    to: row.to,
    nonce: row.nonce,
    epoch: row.epoch,
    hourStart: row.hourStart,
    size: row.size,
    root: row.root,
    stateRoot: row.stateRoot,
    domain: row.domain,
    calldata: row.calldata,
    fingerprint: row.fingerprint,
    from: row.from,
  };
}

/**
 * Append-only intent log. Each record is one JSON line, fsynced before return.
 * @param {string} dir
 * @param {object} [io]
 */
export function openAnchorIntentLog(dir, io = fs) {
  io.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'anchor-intents.jsonl');
  return {
    file,
    append(record) {
      const line = `${JSON.stringify(record)}\n`;
      const fd = io.openSync(file, 'a');
      try {
        io.writeSync(fd, line);
        io.fsyncSync(fd);
      } finally {
        io.closeSync(fd);
      }
    },
    read() {
      if (!io.existsSync(file)) return [];
      const text = io.readFileSync(file, 'utf8');
      if (!text) return [];
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    },
  };
}

/**
 * Write the intent before any signature. The same nonce cannot later carry
 * a different epoch, hour, root, or calldata.
 */
export function commitAnchorIntent(log, anchor, from) {
  const body = normalizeAnchor(anchor);
  const sender = String(from || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(sender)) throw coded('checkpoint address missing', 'bad_anchor');
  const rows = log.read().filter((row) => row.nonce === body.nonce);
  const conflict = rows.find((row) => row.fingerprint !== body.fingerprint || row.from !== sender);
  if (conflict) throw coded('nonce already bound to a different epoch', 'nonce_payload_conflict');
  const existing = rows.find((row) => row.status === 'intent');
  if (existing) return existing;
  const record = {
    v: 1,
    op: 'anchor_intent',
    status: 'intent',
    ...intentBody({ ...body, from: sender }),
    fees: null,
    raw: null,
    tx: null,
    at: new Date().toISOString(),
  };
  log.append(record);
  return record;
}

export async function signCommittedAnchor(signer, log, { nonce, fees }) {
  const key = BigInt(nonce).toString();
  const rows = log.read().filter((row) => row.nonce === key);
  const intent = rows.find((row) => row.status === 'intent');
  if (!intent) throw coded('anchor intent is not committed', 'intent_missing');
  if (intent.from !== signer.address) {
    throw coded('checkpoint address does not match the committed intent', 'checkpoint_address_mismatch');
  }
  const quote = normalizeFees(fees);
  const prior = [...rows].reverse().find((row) => row.status === 'signed' && row.raw && feesMatch(row.fees, quote));
  if (prior) return prior;
  const tx = {
    chainId: BigInt(intent.chainId),
    nonce: BigInt(intent.nonce),
    maxPriorityFeePerGas: BigInt(quote.maxPriorityFeePerGas),
    maxFeePerGas: BigInt(quote.maxFeePerGas),
    gasLimit: BigInt(quote.gasLimit),
    to: intent.to,
    value: 0n,
    data: hexToBytes(intent.calldata),
  };
  const signed = await signer.signEip1559(tx);
  const decoded = eip1559Decode(signed.raw);
  if (decoded.data !== intent.calldata || decoded.nonce !== BigInt(intent.nonce)) {
    throw coded('signed calldata drifted', 'intent_payload_mismatch');
  }
  const record = {
    v: 1,
    op: 'anchor_intent',
    status: 'signed',
    ...intentBody(intent),
    fees: quote,
    raw: bytesToHex(signed.raw),
    hash: bytesToHex(signed.hash),
    yParity: signed.yParity,
    tx: null,
    at: new Date().toISOString(),
  };
  log.append(record);
  return record;
}

export async function broadcastCommittedAnchor(log, { nonce, fees }, send) {
  if (typeof send !== 'function') throw coded('broadcast function missing', 'bad_broadcast');
  const quote = normalizeFees(fees);
  const key = BigInt(nonce).toString();
  const rows = log.read().filter((row) => row.nonce === key);
  const signed = [...rows].reverse().find((row) => (
    (row.status === 'signed' || row.status === 'broadcast') && row.raw && feesMatch(row.fees, quote)
  ));
  if (!signed) throw coded('signed anchor is not committed', 'intent_missing');
  if (!rows.some((row) => row.status === 'intent' && row.fingerprint === signed.fingerprint)) {
    throw coded('broadcast without a committed intent', 'intent_missing');
  }
  const wire = `0x${signed.raw}`;
  const txHash = await send(wire);
  const record = {
    v: 1,
    op: 'anchor_intent',
    status: 'broadcast',
    ...intentBody(signed),
    fees: quote,
    raw: signed.raw,
    hash: signed.hash,
    yParity: signed.yParity,
    tx: String(txHash),
    at: new Date().toISOString(),
  };
  log.append(record);
  return record;
}

/**
 * Commit, sign, then broadcast. send is not called unless both records are
 * already on the log.
 */
export async function broadcastAnchor({ signer, log, anchor, fees, send }) {
  commitAnchorIntent(log, anchor, signer.address);
  await signCommittedAnchor(signer, log, { nonce: anchor.nonce, fees });
  return broadcastCommittedAnchor(log, { nonce: anchor.nonce, fees }, send);
}

/** Per-gas quotes move to 110% + 1. The gas limit stays, so the calldata is the only payload. */
export function bumpFeeQuote(fees) {
  const bump = (value) => (BigInt(value) * 110n) / 100n + 1n;
  return {
    gasLimit: BigInt(fees.gasLimit),
    maxFeePerGas: bump(fees.maxFeePerGas),
    maxPriorityFeePerGas: bump(fees.maxPriorityFeePerGas),
  };
}

/**
 * Re-sign the committed payload at the same nonce with new fees, then broadcast.
 * A different epoch at that nonce is refused by the commit already on the log.
 */
export async function bumpAnchorFees({ signer, log, nonce, fees, send }) {
  const key = BigInt(nonce).toString();
  const intent = log.read().find((row) => row.nonce === key && row.status === 'intent');
  if (!intent) throw coded('anchor intent is not committed', 'intent_missing');
  await signCommittedAnchor(signer, log, { nonce: key, fees });
  return broadcastCommittedAnchor(log, { nonce: key, fees }, send);
}
