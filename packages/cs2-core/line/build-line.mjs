/**
 * Write packages/cs2-core/vectors/line.json from the line codec.
 * The file is a consumer vector. Tests recompute the same bytes from §S1
 * and §S5 without trusting this script's hash calls alone.
 *
 *   node packages/cs2-core/line/build-line.mjs
 *   node packages/cs2-core/line/build-line.mjs --check
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTENT_BYTES,
  HEADER_BYTES,
  LINE_BYTES,
  MAX_EMPTY_DEPTH,
  PAD_BYTES,
  PAYMENT_BYTES,
  REASONS,
  SCHEMA,
  SIGMA_BYTES,
  USED_BYTES,
  authorizationKey,
  canonicalPaymentId,
  commitments,
  contentOffsets,
  decodeLine,
  emptyHash,
  encodeLine,
  paymentOffsets,
  sigmaDigest,
  sigmaOffsets,
  slotKey,
  stateLeaf,
  stateNode,
  toHex,
  yDedupKey,
} from './index.mjs';
import { SAMPLE, SAMPLE_CHAIN_ID } from './sample.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const VECTOR_PATH = join(HERE, '..', 'vectors', 'line.json');

const SPEC_KEYS = Object.freeze({
  payTo: 'c6b40c18d820237cb21ae8016f9f92a5a68f42b5bb30ae56969ff04c7a7b5e14',
  wallet: '4ccc2ec4ceae1ff0046f133bb181b6d489d16271e113279784f446e081f0de9b',
  book: 'e0b35a2c3b103508754c6ba420f0e9bc3c9ae5d75c0f8b8a48dba569cf686af7',
  epoch: '704eb0fa877f4f138ae508a4e5a29dc4c001ffe4415856c2ff7d6453f37c70d7',
});

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function slotPreimage(kind, idHex) {
  return Buffer.concat([
    Buffer.from('chit402-state-v1', 'ascii'),
    Buffer.from([kind]),
    Buffer.from('0000000000002105', 'hex'),
    Buffer.from(idHex, 'hex'),
  ]);
}

function slotRow(name, kind, idHex) {
  const preimage = slotPreimage(kind, idHex);
  const independent = sha256Hex(preimage);
  if (independent !== SPEC_KEYS[name]) {
    throw new Error(`spec literal drifted for ${name}`);
  }
  const got = slotKey({ kind, chainId: SAMPLE_CHAIN_ID, id: idHex });
  if (!got.ok || got.hex !== independent) {
    throw new Error(`slotKey drifted for ${name}`);
  }
  return {
    name,
    kind,
    kind_hex: kind.toString(16).padStart(2, '0'),
    chain_id: SAMPLE_CHAIN_ID,
    chain_id_hex: '0000000000002105',
    id_hex: idHex,
    preimage_hex: preimage.toString('hex'),
    key_hex: got.hex,
  };
}

function offsetRows(rows) {
  return rows.map(([name, at, size]) => ({ name, at, size }));
}

export function vectorDocument() {
  const encoded = encodeLine(SAMPLE);
  if (!encoded.ok) throw new Error(encoded.reason);
  const committed = commitments(encoded.line);
  if (!committed.ok) throw new Error(committed.reason);
  const digest = sigmaDigest(SAMPLE.payment, committed.K, SAMPLE.sigma.alg);
  if (!digest.ok || digest.hex !== committed.hex.sigmaDigest) {
    throw new Error('sigmaDigest drifted from commitments');
  }
  const leafKey = SPEC_KEYS.payTo;
  const leaf = stateLeaf(leafKey, Uint8Array.of(0x01));
  const empty0 = emptyHash(0);
  const empty1 = emptyHash(1);
  const node = stateNode(empty0.bytes, empty0.bytes);
  if (!leaf.ok || !empty0.ok || !empty1.ok || !node.ok) throw new Error('hash domain failed');
  if (node.hex !== empty1.hex) throw new Error('empty depth 1 must be the node of two empty depth-0 hashes');

  return {
    schema: SCHEMA,
    hash: 'SHA-256',
    source: 'SIMPLE §S1 line and §S5 slot key. Synthetic fields, not a payment.',
    line_bytes: LINE_BYTES,
    used_bytes: USED_BYTES,
    pad_bytes: PAD_BYTES,
    header_hex: '6332',
    header_ascii: 'c2',
    header_reading: 'Pinned 2-byte line type. SIMPLE §S1 gives the header 2 bytes and calls it cs2, line type. The bytes are ASCII c and 2. The commitment domain string cs2 is 3 bytes and is not the header.',
    domains: {
      pay: 'pay',
      cnt: 'cnt',
      line: 'cs2',
      sigma: 'cs2-sig',
      state: 'chit402-state-v1',
      empty: 'empty',
    },
    formulas: {
      P: 'SHA-256(ASCII("pay") || salt_p || payment half)',
      K: 'SHA-256(ASCII("cnt") || salt_c || content half without salt_c)',
      C: 'SHA-256(ASCII("cs2") || header || P || K || SHA-256(alg || sigma))',
      sigma_digest: 'SHA-256(ASCII("cs2-sig") || payment id || K || alg)',
      payment_id: 'chainId (8 BE) || blockHash (32) || txIndex (4 BE) || localLogIndex (2 BE)',
      y_dedup: 'chainId (8 BE) || txHash (32) || localLogIndex (2 BE)',
      authorization_key: 'chainId (8 BE) || token (20) || authorizer (20) || nonce (32); nonce zero yields no key',
      slot_key: 'SHA-256(ASCII("chit402-state-v1") || kind (1) || chainId (8 BE) || id)',
      state_leaf: 'SHA-256(0x00 || ASCII("chit402-state-v1") || key || SHA-256(value))',
      state_node: 'SHA-256(0x01 || left || right)',
      empty_0: 'SHA-256(0x02 || ASCII("empty"))',
      empty_next: 'SHA-256(0x01 || empty_d || empty_d)',
    },
    notes: {
      block_hash: 'Required on the canonical payment id. Absent, null, empty, and 32 zero bytes are rejected.',
      P_salt: 'salt_p is prepended and is also the last 32 bytes of the payment half, matching the written formula.',
      sigma: 'H(alg || sigma) is the 65-byte block. The sigma message also binds alg. r and s are P-256 low-S: 1 <= r < n and 1 <= s <= n/2.',
      header: 'The 2 header bytes are inside C, so a future line type cannot reuse this C.',
      uri_prefix: 'NUL-free UTF-8, then zero fill to 256 bytes. A NUL with later non-zero bytes is rejected. A 512-char lowercase hex string is raw bytes.',
      local_log_index: 'Receipt-local index of the Transfer log inside the transaction, not the RPC block logIndex. The sample uses txIndex 7 and localLogIndex 4: the Transfer is the fifth log in that receipt.',
      salts: 'salt_p and salt_c must each be non-zero and must differ. The codec does not prove they came from a CSPRNG.',
      y_dedup: 'The dedup key does not include blockHash, so one Transfer under two block hashes counts once.',
      empty_depth: 'max_empty_depth is an implementation limit, not a wire field.',
    },
    implementation_limits: {
      max_empty_depth: MAX_EMPTY_DEPTH,
    },
    sizes: {
      header: HEADER_BYTES,
      payment: PAYMENT_BYTES,
      content: CONTENT_BYTES,
      sigma: SIGMA_BYTES,
    },
    payment_fields: offsetRows(paymentOffsets()),
    content_fields: offsetRows(contentOffsets()),
    sigma_fields: offsetRows(sigmaOffsets()),
    reasons: [...REASONS],
    slot_keys: [
      slotRow('payTo', 0x01, '11'.repeat(20)),
      slotRow('wallet', 0x02, '11'.repeat(20)),
      slotRow('book', 0x03, '22'.repeat(32)),
      slotRow('epoch', 0x04, ''),
    ],
    hash_domains: {
      leaf: {
        key_hex: leafKey,
        value_hex: '01',
        hash_hex: leaf.hex,
      },
      node: {
        left_hex: empty0.hex,
        right_hex: empty0.hex,
        hash_hex: node.hex,
      },
      empty: [
        { depth: 0, hash_hex: empty0.hex },
        { depth: 1, hash_hex: empty1.hex },
      ],
    },
    line: {
      sample: SAMPLE,
      uri_prefix_text: SAMPLE.content.uriPrefix,
      line_hex: toHex(encoded.line),
      payment_id_hex: canonicalPaymentId(SAMPLE.payment).hex,
      y_dedup_hex: yDedupKey(SAMPLE.payment).hex,
      P: committed.hex.P,
      K: committed.hex.K,
      C: committed.hex.C,
      sigma_digest: committed.hex.sigmaDigest,
      authorization_key_hex: authorizationKey({
        chainId: SAMPLE.payment.chainId,
        token: SAMPLE.payment.token,
        authorizer: SAMPLE.payment.authorizer,
        nonce: SAMPLE.payment.nonce,
      }).hex,
    },
    multi_log: multiLogRow(),
    max_line: maxLineRow(),
    negatives: negativeRows(encoded.line),
  };
}

function multiLogRow() {
  const payment = { ...SAMPLE.payment, txIndex: 2, localLogIndex: 9 };
  const id = canonicalPaymentId(payment);
  if (!id.ok) throw new Error(id.reason);
  return {
    tx_index: 2,
    local_log_index: 9,
    note: 'localLogIndex 9 is the Transfer inside this receipt. It is not a block log index.',
    payment_id_hex: id.hex,
    tx_index_hex: id.hex.slice(80, 88),
    local_log_index_hex: id.hex.slice(88, 92),
  };
}

function maxLineRow() {
  const parts = {
    payment: {
      ...SAMPLE.payment,
      chainId: '18446744073709551615',
      blockNumber: '18446744073709551615',
      blockTime: '18446744073709551615',
      txIndex: 4294967295,
      localLogIndex: 65535,
      value: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      method: 255,
    },
    content: SAMPLE.content,
    sigma: SAMPLE.sigma,
  };
  const encoded = encodeLine(parts);
  if (!encoded.ok) throw new Error(encoded.reason);
  const committed = commitments(encoded.line);
  if (!committed.ok) throw new Error(committed.reason);
  return {
    parts,
    line_hex: toHex(encoded.line),
    payment_id_hex: canonicalPaymentId(parts.payment).hex,
    C: committed.hex.C,
    local_log_index: 65535,
  };
}

function negativeRows(line) {
  const pad = Uint8Array.from(line);
  pad[USED_BYTES] = 1;
  const header = Uint8Array.from(line);
  header[1] = 0;
  const zeroHash = Uint8Array.from(line);
  zeroHash.fill(0, HEADER_BYTES + 8, HEADER_BYTES + 40);
  const short = line.slice(0, LINE_BYTES - 1);
  const rows = [
    ['bad-padding', pad],
    ['bad-header', header],
    ['zero-block-hash', zeroHash],
    ['short-line', short],
  ];
  return rows.map(([id, bytes]) => {
    const got = decodeLine(bytes);
    if (got.ok) throw new Error(`${id} decoded`);
    return { id, reason: got.reason, line_hex: toHex(bytes) };
  });
}

export function renderLineJson() {
  return `${JSON.stringify(vectorDocument(), null, 2)}\n`;
}

function main() {
  const check = process.argv.includes('--check');
  const text = renderLineJson();
  if (check) {
    const have = readFileSync(VECTOR_PATH, 'utf8');
    if (have !== text) {
      process.stderr.write('line.json does not match the codec\n');
      process.exit(1);
    }
    process.stdout.write('line.json matches\n');
    return;
  }
  writeFileSync(VECTOR_PATH, text);
  process.stdout.write(`${VECTOR_PATH}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
