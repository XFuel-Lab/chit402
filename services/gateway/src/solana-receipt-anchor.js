/**
 * Daily receipt-root anchor on Solana, via the SPL Memo program.
 *
 * The memo is `chit402:root:v1:<scope>:<yyyy-mm-dd>:<root_hex>:<prev_root_hex>`.
 * The signer is SOLANA_ANCHOR_SECRET_KEY (base58 or a JSON byte array) from the
 * process environment. SOLANA_RPC_URL is the cluster RPC. SOLANA_ANCHOR_CLUSTER
 * defaults to mainnet-beta; devnet is for tests and the smoke script.
 *
 * This module reads process.env only. It does not load environment files and
 * it does not log the secret. A missing key or RPC leaves the head pending.
 */
import crypto from 'crypto';

export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const MEMO_PREFIX = 'chit402:root:v1';
export const ZERO_ROOT = '0'.repeat(64);
export const SOLANA_CLUSTERS = new Set(['mainnet-beta', 'devnet', 'testnet']);

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function encodeLength(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error('bad_length');
  if (n <= 0x7f) return Buffer.from([n]);
  if (n <= 0x3fff) return Buffer.from([(n & 0x7f) | 0x80, n >> 7]);
  return Buffer.from([(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14]);
}

export function base58Encode(buf) {
  const bytes = Buffer.from(buf);
  if (bytes.length === 0) return '';
  const digits = [0];
  for (let i = 0; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '';
  for (let k = 0; bytes[k] === 0 && k < bytes.length - 1; k += 1) out += '1';
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58_ALPHABET[digits[i]];
  return out;
}

export function base58Decode(str) {
  if (typeof str !== 'string' || str.length === 0) throw new Error('bad_base58');
  const bytes = [0];
  for (let i = 0; i < str.length; i += 1) {
    const value = BASE58_ALPHABET.indexOf(str[i]);
    if (value < 0) throw new Error('bad_base58');
    let carry = value;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; str[k] === '1' && k < str.length - 1; k += 1) bytes.push(0);
  return Buffer.from(bytes.reverse());
}

function privateKeyFromSeed(seed) {
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

export function publicKeyFromSeed(seed) {
  const der = crypto.createPublicKey(privateKeyFromSeed(seed)).export({ format: 'der', type: 'spki' });
  return Buffer.from(der.subarray(der.length - 32));
}

/**
 * Accept a Solana keypair (64 bytes) or a 32-byte seed.
 * JSON arrays are the `solana-keygen` file shape. Base58 is the CLI display form.
 * @returns {{ seed: Buffer, publicKey: Buffer }}
 */
export function parseSolanaSecretKey(raw) {
  if (raw == null || String(raw).trim() === '') throw new Error('no_key');
  const text = String(raw).trim();
  let bytes;
  try {
    if (text.startsWith('[')) {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr) || arr.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        throw new Error('bad_key');
      }
      bytes = Buffer.from(arr);
    } else {
      bytes = base58Decode(text);
    }
  } catch (err) {
    if (err.message === 'bad_key' || err.message === 'bad_base58') throw new Error('bad_key');
    throw new Error('bad_key');
  }
  if (bytes.length !== 64 && bytes.length !== 32) throw new Error('bad_key');
  const seed = Buffer.from(bytes.subarray(0, 32));
  const derived = publicKeyFromSeed(seed);
  if (bytes.length === 64) {
    const embedded = bytes.subarray(32, 64);
    if (!embedded.equals(derived)) throw new Error('bad_key');
  }
  return { seed, publicKey: derived };
}

export function normalizeRootHex(rootHex) {
  const root = String(rootHex || '').replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('bad_root');
  return root;
}

export const MEMO_PREFIX_V2 = 'chit402:root:v2';

export function solanaAnchorMemo({
  scope = 'global',
  day,
  rootHex,
  prevRootHex = ZERO_ROOT,
  epoch = null,
  prevEpochRoot = null,
  prevEpochSize = 0,
  bundleIndexHash = null,
} = {}) {
  const book = String(scope || 'global');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(book)) throw new Error('bad_scope');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('bad_day');
  const root = normalizeRootHex(rootHex);
  const prev = normalizeRootHex(prevRootHex || ZERO_ROOT);
  if (epoch == null) return `${MEMO_PREFIX}:${book}:${day}:${root}:${prev}`;
  const epochNo = Number(epoch);
  if (!Number.isInteger(epochNo) || epochNo < 1) throw new Error('bad_epoch');
  const prevEpoch = prevEpochRoot ? normalizeRootHex(prevEpochRoot) : ZERO_ROOT;
  const size = Number(prevEpochSize || 0);
  if (!Number.isInteger(size) || size < 0) throw new Error('bad_epoch_size');
  const bundle = bundleIndexHash ? normalizeRootHex(bundleIndexHash) : ZERO_ROOT;
  return `${MEMO_PREFIX_V2}:${book}:${day}:${root}:${prev}:${epochNo}:${prevEpoch}:${size}:${bundle}`;
}

function memoIdentity(scope, day, root, prev) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(scope)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (!/^[0-9a-f]{64}$/.test(root) || !/^[0-9a-f]{64}$/.test(prev)) return null;
  return { scope, day, root, prev };
}

/** Parse a v1 or v2 memo. Returns null when the text is not this scheme. */
export function parseAnchorMemo(memo) {
  const parts = String(memo || '').split(':');
  if (parts[0] !== 'chit402' || parts[1] !== 'root') return null;
  if (parts.length === 7 && parts[2] === 'v1') {
    return memoIdentity(parts[3], parts[4], parts[5], parts[6]);
  }
  if (parts.length === 11 && parts[2] === 'v2') {
    const base = memoIdentity(parts[3], parts[4], parts[5], parts[6]);
    if (!base) return null;
    const epoch = Number(parts[7]);
    const prevEpoch = parts[8];
    const size = Number(parts[9]);
    const bundle = parts[10];
    if (!Number.isInteger(epoch) || epoch < 1) return null;
    if (!/^[0-9a-f]{64}$/.test(prevEpoch) || !/^[0-9a-f]{64}$/.test(bundle)) return null;
    if (!Number.isInteger(size) || size < 0) return null;
    return {
      version: 2,
      ...base,
      epoch,
      prev_epoch_root: prevEpoch,
      prev_epoch_size: size,
      bundle_index_hash: bundle,
    };
  }
  return null;
}

export function memoScope(memo) {
  return parseAnchorMemo(memo)?.scope || null;
}

export function solanaAnchorCluster(override) {
  const raw = String(override ?? process.env.SOLANA_ANCHOR_CLUSTER ?? 'mainnet-beta').trim() || 'mainnet-beta';
  if (!SOLANA_CLUSTERS.has(raw)) throw new Error('bad_cluster');
  return raw;
}

/**
 * Legacy transaction: fee payer signs one SPL Memo instruction.
 * The memo program id is the only readonly non-signer.
 */
export function buildSignedMemoTransaction({ seed, publicKey, blockhash, memo }) {
  const programId = base58Decode(MEMO_PROGRAM_ID);
  if (programId.length !== 32) throw new Error('bad_program');
  const hash = base58Decode(blockhash);
  if (hash.length !== 32) throw new Error('bad_blockhash');
  const data = Buffer.from(String(memo), 'utf8');
  const ix = Buffer.concat([
    Buffer.from([1]),
    encodeLength(1),
    Buffer.from([0]),
    encodeLength(data.length),
    data,
  ]);
  const message = Buffer.concat([
    Buffer.from([1, 0, 1]),
    encodeLength(2),
    publicKey,
    programId,
    hash,
    encodeLength(1),
    ix,
  ]);
  const signature = crypto.sign(null, message, privateKeyFromSeed(seed));
  if (signature.length !== 64) throw new Error('bad_signature');
  return Buffer.concat([encodeLength(1), signature, message]);
}

async function rpcCall(rpcUrl, method, params, fetchImpl) {
  const res = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`solana_http_${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'solana_rpc_error');
  return json.result;
}

/**
 * JSON-RPC connection with the three calls a memo submit needs.
 * Tests pass their own object with the same methods.
 */
export function jsonRpcConnection(rpcUrl, fetchImpl = globalThis.fetch) {
  if (!rpcUrl) throw new Error('no_rpc');
  return {
    async getLatestBlockhash() {
      const result = await rpcCall(rpcUrl, 'getLatestBlockhash', [{ commitment: 'confirmed' }], fetchImpl);
      const blockhash = result?.value?.blockhash;
      if (!blockhash) throw new Error('no_blockhash');
      return { blockhash };
    },
    async sendRawTransaction(raw) {
      const b64 = Buffer.from(raw).toString('base64');
      const sig = await rpcCall(rpcUrl, 'sendTransaction', [
        b64,
        { encoding: 'base64', preflightCommitment: 'confirmed' },
      ], fetchImpl);
      if (typeof sig !== 'string' || sig.length === 0) throw new Error('no_signature');
      return sig;
    },
    async confirmTransaction(signature) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const result = await rpcCall(rpcUrl, 'getSignatureStatuses', [
          [signature],
          { searchTransactionHistory: true },
        ], fetchImpl);
        const row = result?.value?.[0];
        if (row?.err) throw new Error('tx_err');
        if (row && (row.confirmationStatus === 'confirmed' || row.confirmationStatus === 'finalized')) {
          return { slot: row.slot ?? null };
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error('confirm_timeout');
    },
  };
}

export async function sendSolanaMemoAnchor({ memo, secretKey, rpc, connection }) {
  const parsed = parseSolanaSecretKey(secretKey);
  try {
    const conn = connection || jsonRpcConnection(rpc);
    const { blockhash } = await conn.getLatestBlockhash();
    const raw = buildSignedMemoTransaction({
      seed: parsed.seed,
      publicKey: parsed.publicKey,
      blockhash,
      memo,
    });
    const signature = await conn.sendRawTransaction(raw);
    try {
      const confirmed = await conn.confirmTransaction(signature);
      return { signature, slot: confirmed?.slot ?? null };
    } catch (err) {
      if (err?.message === 'tx_err') throw err;
      // The memo was already broadcast. Recording the signature keeps a retry
      // from posting a second memo for the same day.
      return { signature, slot: null };
    }
  } finally {
    parsed.seed.fill(0);
  }
}

function pendingSolana(reason, { cluster = null, memo = null } = {}) {
  return {
    status: 'pending',
    signature: null,
    slot: null,
    cluster,
    memo,
    reason,
  };
}

/**
 * Build the Solana half of a tree head. Sends only when the key and RPC are
 * set. `connection` replaces the JSON-RPC client in tests.
 */
export async function describeSolanaAnchor({
  rootHex,
  prevRootHex = ZERO_ROOT,
  day,
  scope = 'global',
  connection = null,
  epoch = null,
  prevEpochRoot = null,
  prevEpochSize = 0,
  bundleIndexHash = null,
} = {}) {
  let cluster = null;
  let memo = null;
  try {
    cluster = solanaAnchorCluster();
    memo = solanaAnchorMemo({
      scope,
      day,
      rootHex,
      prevRootHex,
      epoch,
      prevEpochRoot,
      prevEpochSize,
      bundleIndexHash,
    });
  } catch (err) {
    return pendingSolana(err.message || 'bad_memo', { cluster, memo });
  }
  const key = process.env.SOLANA_ANCHOR_SECRET_KEY || '';
  const rpc = process.env.SOLANA_RPC_URL || '';
  if (!String(key).trim()) return pendingSolana('no_key', { cluster, memo });
  if (!String(rpc).trim() && !connection) return pendingSolana('no_rpc', { cluster, memo });
  try {
    const result = await sendSolanaMemoAnchor({
      memo,
      secretKey: key,
      rpc,
      connection,
    });
    return {
      status: 'anchored',
      signature: result.signature,
      slot: result.slot ?? null,
      cluster,
      memo,
      reason: null,
    };
  } catch (err) {
    const reason = err.message || 'send_failed';
    return pendingSolana(reason === 'no_key' ? 'bad_key' : reason, { cluster, memo });
  }
}
