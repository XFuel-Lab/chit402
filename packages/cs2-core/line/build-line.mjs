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
  canonicalPaymentId,
  commitments,
  contentOffsets,
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
  const digest = sigmaDigest(SAMPLE.payment, committed.K);
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
      C: 'SHA-256(ASCII("cs2") || P || K || SHA-256(sigma))',
      sigma_digest: 'SHA-256(ASCII("cs2-sig") || payment id || K)',
      payment_id: 'chainId (8 BE) || blockHash (32) || txIndex (4 BE) || logIndex (2 BE)',
      y_dedup: 'chainId (8 BE) || txHash (32) || logIndex (2 BE)',
      slot_key: 'SHA-256(ASCII("chit402-state-v1") || kind (1) || chainId (8 BE) || id)',
      state_leaf: 'SHA-256(0x00 || ASCII("chit402-state-v1") || key || SHA-256(value))',
      state_node: 'SHA-256(0x01 || left || right)',
      empty_0: 'SHA-256(0x02 || ASCII("empty"))',
      empty_next: 'SHA-256(0x01 || empty_d || empty_d)',
    },
    notes: {
      block_hash: 'Required on the canonical payment id. Absent, null, and empty are rejected. Thirty-two zero bytes are a present hash.',
      sigma: 'H(sigma) covers the 64-byte signature. The alg byte is stored in the line and is not inside H(sigma).',
      uri_prefix: 'A text prefix is UTF-8, then zero-padded to 256 bytes. A 256-byte value is stored as given.',
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
    },
  };
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
