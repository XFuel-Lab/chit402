/**
 * §S1 line codec and §S5 slot-key vectors.
 * Expected hashes are computed here, or taken from the §S5 literals.
 * They are not copied out of the implementation.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLineJson, VECTOR_PATH } from './build-line.mjs';
import {
  CONTENT_BYTES,
  HEADER_BYTES,
  LAYOUT,
  LINE_BYTES,
  PAD_BYTES,
  PAYMENT_BYTES,
  REASONS,
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
import { SAMPLE } from './sample.mjs';

const SPEC_TAG_HEX = '636869743430322d73746174652d7631';
const SPEC_CHAIN_HEX = '0000000000002105';
const SPEC_KEYS = {
  payTo: 'c6b40c18d820237cb21ae8016f9f92a5a68f42b5bb30ae56969ff04c7a7b5e14',
  wallet: '4ccc2ec4ceae1ff0046f133bb181b6d489d16271e113279784f446e081f0de9b',
  book: 'e0b35a2c3b103508754c6ba420f0e9bc3c9ae5d75c0f8b8a48dba569cf686af7',
  epoch: '704eb0fa877f4f138ae508a4e5a29dc4c001ffe4415856c2ff7d6453f37c70d7',
};

const PAYMENT_AT = [
  ['chainId', 0, 8],
  ['blockHash', 8, 32],
  ['blockNumber', 40, 8],
  ['blockTime', 48, 8],
  ['txIndex', 56, 4],
  ['localLogIndex', 60, 2],
  ['txHash', 62, 32],
  ['token', 94, 20],
  ['from', 114, 20],
  ['to', 134, 20],
  ['value', 154, 32],
  ['method', 186, 1],
  ['authorizer', 187, 20],
  ['nonce', 207, 32],
  ['saltP', 239, 32],
];

const CONTENT_AT = [
  ['uuid', 0, 16],
  ['sellerIdHash', 16, 32],
  ['sellerKeyId', 48, 32],
  ['requestMethod', 80, 1],
  ['uriDigest', 81, 32],
  ['uriPrefix', 113, 256],
  ['contentDigest', 369, 32],
  ['responseDigest', 401, 32],
  ['saltC', 433, 32],
];

function sha(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function writeBe(buf, offset, value, width) {
  let x = BigInt(value);
  for (let i = width - 1; i >= 0; i -= 1) {
    buf[offset + i] = Number(x & 0xffn);
    x >>= 8n;
  }
}

function putHex(buf, offset, text) {
  const raw = Buffer.from(text, 'hex');
  buf.set(raw, offset);
  return raw.length;
}

function oracleLine(sample) {
  const line = Buffer.alloc(1024);
  line[0] = 0x63;
  line[1] = 0x32;
  const base = 2;
  const p = sample.payment;
  writeBe(line, base + 0, p.chainId, 8);
  putHex(line, base + 8, p.blockHash);
  writeBe(line, base + 40, p.blockNumber, 8);
  writeBe(line, base + 48, p.blockTime, 8);
  writeBe(line, base + 56, p.txIndex, 4);
  writeBe(line, base + 60, p.localLogIndex, 2);
  putHex(line, base + 62, p.txHash);
  putHex(line, base + 94, p.token);
  putHex(line, base + 114, p.from);
  putHex(line, base + 134, p.to);
  writeBe(line, base + 154, p.value, 32);
  writeBe(line, base + 186, p.method, 1);
  putHex(line, base + 187, p.authorizer);
  putHex(line, base + 207, p.nonce);
  putHex(line, base + 239, p.saltP);
  const contentAt = 273;
  const c = sample.content;
  putHex(line, contentAt + 0, c.uuid);
  putHex(line, contentAt + 16, c.sellerIdHash);
  putHex(line, contentAt + 48, c.sellerKeyId);
  writeBe(line, contentAt + 80, c.requestMethod, 1);
  putHex(line, contentAt + 81, c.uriDigest);
  const prefix = Buffer.from(c.uriPrefix, 'utf8');
  assert.ok(prefix.length <= 256);
  line.set(prefix, contentAt + 113);
  putHex(line, contentAt + 369, c.contentDigest);
  putHex(line, contentAt + 401, c.responseDigest);
  putHex(line, contentAt + 433, c.saltC);
  const sigmaAt = 738;
  writeBe(line, sigmaAt, sample.sigma.alg, 1);
  putHex(line, sigmaAt + 1, sample.sigma.sigma);
  return line;
}

function oracleCommit(line) {
  const payment = line.subarray(2, 2 + 271);
  const saltP = payment.subarray(271 - 32);
  const content = line.subarray(273, 273 + 465);
  const saltC = content.subarray(465 - 32);
  const body = content.subarray(0, 465 - 32);
  const header = line.subarray(0, 2);
  const sigmaBlock = line.subarray(738, 738 + 65);
  const P = sha(Buffer.from('pay'), saltP, payment);
  const K = sha(Buffer.from('cnt'), saltC, body);
  const C = sha(Buffer.from('cs2'), header, P, K, sha(sigmaBlock));
  const id = Buffer.concat([
    payment.subarray(0, 8),
    payment.subarray(8, 40),
    payment.subarray(56, 60),
    payment.subarray(60, 62),
  ]);
  const y = Buffer.concat([
    payment.subarray(0, 8),
    payment.subarray(62, 94),
    payment.subarray(60, 62),
  ]);
  const sig = sha(Buffer.from('cs2-sig'), id, K, sigmaBlock.subarray(0, 1));
  return { P, K, C, id, y, sig };
}

function slotPreimage(kind, idHex) {
  return Buffer.concat([
    Buffer.from('chit402-state-v1', 'ascii'),
    Buffer.from([kind]),
    Buffer.from(SPEC_CHAIN_HEX, 'hex'),
    Buffer.from(idHex, 'hex'),
  ]);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function partsOf(decoded) {
  return { payment: decoded.payment, content: decoded.content, sigma: decoded.sigma };
}

function assertFail(result, reason) {
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'reason']);
  assert.ok(REASONS.includes(reason));
  assert.match(result.reason, /^[a-z0-9_]+$/);
  assert.equal(JSON.stringify(result), `{"ok":false,"reason":"${reason}"}`);
}

test('section sizes are the §S1 budget', () => {
  assert.equal(HEADER_BYTES, 2);
  assert.equal(PAYMENT_BYTES, 271);
  assert.equal(CONTENT_BYTES, 465);
  assert.equal(SIGMA_BYTES, 65);
  assert.equal(2 + 271 + 465 + 65, 803);
  assert.equal(USED_BYTES, 803);
  assert.equal(1024 - 803, 221);
  assert.equal(PAD_BYTES, 221);
  assert.equal(LINE_BYTES, 1024);
  assert.equal(LAYOUT.payment, 2);
  assert.equal(LAYOUT.content, 273);
  assert.equal(LAYOUT.sigma, 738);
  assert.equal(LAYOUT.pad, 803);
  assert.deepEqual(paymentOffsets(), PAYMENT_AT);
  assert.deepEqual(contentOffsets(), CONTENT_AT);
  assert.deepEqual(sigmaOffsets(), [['alg', 0, 1], ['sigma', 1, 64]]);
  const payEnd = PAYMENT_AT.reduce((end, [, at, size]) => {
    assert.equal(at, end);
    return end + size;
  }, 0);
  assert.equal(payEnd, 271);
  const contentEnd = CONTENT_AT.reduce((end, [, at, size]) => {
    assert.equal(at, end);
    return end + size;
  }, 0);
  assert.equal(contentEnd, 465);
});

test('§S5 slot keys match the published vectors', () => {
  assert.equal(Buffer.from('chit402-state-v1', 'ascii').toString('hex'), SPEC_TAG_HEX);
  assert.equal(Buffer.from(SPEC_TAG_HEX, 'hex').length, 16);
  const rows = [
    ['payTo', 0x01, '11'.repeat(20)],
    ['wallet', 0x02, '11'.repeat(20)],
    ['book', 0x03, '22'.repeat(32)],
    ['epoch', 0x04, ''],
  ];
  for (const [name, kind, idHex] of rows) {
    const preimage = slotPreimage(kind, idHex);
    assert.equal(hex(sha(preimage)), SPEC_KEYS[name]);
    const got = slotKey({ kind, chainId: 8453, id: idHex === '' ? new Uint8Array(0) : idHex });
    assert.equal(got.ok, true, name);
    assert.equal(got.hex, SPEC_KEYS[name]);
    assert.equal(hex(got.bytes), got.hex);
  }
  const wallet = slotKey({ kind: 0x02, chainId: 8453n, id: Uint8Array.from({ length: 20 }, () => 0x11) });
  assert.equal(wallet.hex, SPEC_KEYS.wallet);
  const epoch = slotKey({ kind: 0x04, chainId: '8453' });
  assert.equal(epoch.hex, SPEC_KEYS.epoch);
});

test('reserved kinds and id widths are rejected', () => {
  const id20 = '11'.repeat(20);
  const id32 = '22'.repeat(32);
  for (const kind of [0, 5, 0xff, -1, 1.5, 256, Number.NaN]) {
    assertFail(slotKey({ kind, chainId: 8453, id: id20 }), 'bad_kind');
  }
  assertFail(slotKey({ kind: -0, chainId: 8453, id: id20 }), 'bad_kind');
  assertFail(slotKey({ kind: 0x01, chainId: 8453, id: '11'.repeat(19) }), 'bad_id_length');
  assertFail(slotKey({ kind: 0x01, chainId: 8453, id: id32 }), 'bad_id_length');
  assertFail(slotKey({ kind: 0x01, chainId: 8453, id: Uint8Array.from({ length: 19 }, () => 1) }), 'bad_id_length');
  assertFail(slotKey({ kind: 0x02, chainId: 8453, id: id32 }), 'bad_id_length');
  assertFail(slotKey({ kind: 0x03, chainId: 8453, id: id20 }), 'bad_id_length');
  assertFail(slotKey({ kind: 0x04, chainId: 8453, id: id20 }), 'bad_id_length');
  assertFail(slotKey({ kind: 0x04, chainId: 8453, id: '00' }), 'bad_id_length');
  assertFail(slotKey({ kind: 0x04, chainId: 8453, id: Uint8Array.of(0) }), 'bad_id_length');
  assertFail(slotKey({ kind: '1', chainId: 8453, id: id20 }), 'bad_kind');
  assertFail(slotKey({ kind: 0x01, chainId: 8453, id: 'ab'.repeat(20).toUpperCase() }), 'bad_hex');
  assert.equal(slotKey({ kind: 0x01, chainId: 8453, id: id20 }).hex, SPEC_KEYS.payTo);
});

test('state hash domains follow §S5 rule 6', () => {
  const empty0 = sha(Buffer.from([0x02]), Buffer.from('empty'));
  const empty1 = sha(Buffer.from([0x01]), empty0, empty0);
  assert.equal(emptyHash(0).hex, hex(empty0));
  assert.equal(emptyHash(1).hex, hex(empty1));
  assert.equal(stateNode(empty0, empty0).hex, hex(empty1));
  const key = Buffer.from(SPEC_KEYS.payTo, 'hex');
  const value = Buffer.from([0x01]);
  const leaf = sha(Buffer.from([0x00]), Buffer.from('chit402-state-v1'), key, sha(value));
  assert.equal(stateLeaf(key, value).hex, hex(leaf));
  assert.equal(stateNode(emptyHash(0).bytes, emptyHash(0).bytes).hex, emptyHash(1).hex);
  assert.equal(emptyHash(64).ok, true);
  assert.equal(emptyHash(64).bytes.length, 32);
  assertFail(emptyHash(65), 'bad_depth');
  assertFail(emptyHash(-1), 'bad_depth');
  assertFail(emptyHash(-0), 'bad_depth');
  assertFail(emptyHash(1.5), 'bad_depth');
  assertFail(stateNode(empty0.subarray(0, 31), empty0), 'bad_length');
  assertFail(stateLeaf(key.subarray(0, 31), value), 'bad_length');
  const emptyValue = stateLeaf(key, new Uint8Array(0));
  assert.equal(emptyValue.hex, hex(sha(Buffer.from([0x00]), Buffer.from('chit402-state-v1'), key, sha(Buffer.alloc(0)))));
});

test('sample line matches an independent encoder', () => {
  const oracle = oracleLine(SAMPLE);
  const encoded = encodeLine(SAMPLE);
  assert.equal(encoded.ok, true);
  assert.equal(encoded.line.length, 1024);
  assert.deepEqual(Buffer.from(encoded.line), oracle);
  assert.equal(encoded.line[0], 0x63);
  assert.equal(encoded.line[1], 0x32);
  assert.equal(hex(encoded.line.subarray(2, 10)), SPEC_CHAIN_HEX);
  assert.equal(hex(encoded.line.subarray(10, 42)), 'ab'.repeat(32));
  assert.ok(encoded.line.subarray(803).every((byte) => byte === 0));
  const commit = oracleCommit(oracle);
  const got = commitments(encoded.line);
  assert.equal(got.ok, true);
  assert.equal(got.hex.P, hex(commit.P));
  assert.equal(got.hex.K, hex(commit.K));
  assert.equal(got.hex.C, hex(commit.C));
  assert.equal(got.hex.sigmaDigest, hex(commit.sig));
  assert.equal(hex(got.P), hex(commit.P));
  const id = canonicalPaymentId(SAMPLE.payment);
  const dedup = yDedupKey(SAMPLE.payment);
  assert.equal(id.hex, hex(commit.id));
  assert.equal(dedup.hex, hex(commit.y));
  assert.equal(id.bytes.length, 46);
  assert.equal(dedup.bytes.length, 42);
  assert.notEqual(id.hex, dedup.hex);
  assert.equal(sigmaDigest(SAMPLE.payment, got.K, SAMPLE.sigma.alg).hex, got.hex.sigmaDigest);
  assert.equal(commitments(SAMPLE).hex.C, got.hex.C);
});

test('round trip keeps every field', () => {
  const encoded = encodeLine(SAMPLE);
  const decoded = decodeLine(encoded.line);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.payment.chainId, 8453n);
  assert.equal(decoded.payment.blockNumber, 12345678n);
  assert.equal(decoded.payment.blockTime, 1700000000n);
  assert.equal(decoded.payment.txIndex, 7);
  assert.equal(decoded.payment.localLogIndex, 4);
  assert.equal(decoded.payment.value, 1000000n);
  assert.equal(decoded.payment.method, 1);
  assert.equal(decoded.content.requestMethod, 2);
  assert.equal(decoded.sigma.alg, 1);
  assert.equal(hex(decoded.payment.blockHash), SAMPLE.payment.blockHash);
  assert.equal(hex(decoded.payment.txHash), SAMPLE.payment.txHash);
  assert.equal(hex(decoded.payment.from), SAMPLE.payment.from);
  assert.equal(hex(decoded.payment.to), SAMPLE.payment.to);
  assert.equal(hex(decoded.payment.authorizer), SAMPLE.payment.authorizer);
  assert.notEqual(hex(decoded.payment.from), hex(decoded.payment.authorizer));
  assert.equal(hex(decoded.payment.saltP), SAMPLE.payment.saltP);
  assert.equal(hex(decoded.content.saltC), SAMPLE.content.saltC);
  assert.equal(hex(decoded.sigma.sigma), SAMPLE.sigma.sigma);
  const prefix = Buffer.from(decoded.content.uriPrefix);
  const text = Buffer.from(SAMPLE.content.uriPrefix, 'utf8');
  assert.deepEqual(prefix.subarray(0, text.length), text);
  assert.ok(prefix.subarray(text.length).every((byte) => byte === 0));
  const again = encodeLine(partsOf(decoded));
  assert.deepEqual(Buffer.from(again.line), Buffer.from(encoded.line));
  const id = canonicalPaymentId(decoded.payment);
  assert.equal(id.hex, canonicalPaymentId(SAMPLE.payment).hex);
});

test('changing one half changes only its commitment', () => {
  const base = commitments(SAMPLE);
  const pay = commitments({
    ...SAMPLE,
    payment: { ...SAMPLE.payment, chainId: 8453 + 1 },
  });
  assert.notEqual(pay.hex.P, base.hex.P);
  assert.equal(pay.hex.K, base.hex.K);
  const saltP = commitments({
    ...SAMPLE,
    payment: { ...SAMPLE.payment, saltP: '56'.repeat(32) },
  });
  assert.notEqual(saltP.hex.P, base.hex.P);
  assert.equal(saltP.hex.K, base.hex.K);
  const body = commitments({
    ...SAMPLE,
    content: { ...SAMPLE.content, uuid: '67'.repeat(16) },
  });
  assert.equal(body.hex.P, base.hex.P);
  assert.notEqual(body.hex.K, base.hex.K);
  const saltC = commitments({
    ...SAMPLE,
    content: { ...SAMPLE.content, saltC: 'ce'.repeat(32) },
  });
  assert.equal(saltC.hex.P, base.hex.P);
  assert.notEqual(saltC.hex.K, base.hex.K);
  const sig = commitments({
    ...SAMPLE,
    sigma: { ...SAMPLE.sigma, sigma: `${'00'.repeat(31)}02${'00'.repeat(31)}02` },
  });
  assert.equal(sig.hex.P, base.hex.P);
  assert.equal(sig.hex.K, base.hex.K);
  assert.notEqual(sig.hex.C, base.hex.C);
  const alg = commitments({
    ...SAMPLE,
    sigma: { ...SAMPLE.sigma, alg: 2 },
  });
  assert.equal(alg.hex.P, base.hex.P);
  assert.equal(alg.hex.K, base.hex.K);
  assert.notEqual(alg.hex.C, base.hex.C);
  assert.notEqual(alg.hex.sigmaDigest, base.hex.sigmaDigest);
  assert.notEqual(hex(encodeLine({ ...SAMPLE, sigma: { ...SAMPLE.sigma, alg: 2 } }).line), hex(encodeLine(SAMPLE).line));
});

test('a payment id missing blockHash is rejected', () => {
  const { blockHash, ...rest } = SAMPLE.payment;
  assert.equal(blockHash.length, 64);
  assertFail(canonicalPaymentId(rest), 'missing_block_hash');
  assertFail(canonicalPaymentId({ ...rest, blockHash: undefined }), 'missing_block_hash');
  assertFail(canonicalPaymentId({ ...rest, blockHash: null }), 'missing_block_hash');
  assertFail(canonicalPaymentId({ ...rest, blockHash: '' }), 'missing_block_hash');
  assertFail(canonicalPaymentId({ ...rest, txHash: SAMPLE.payment.txHash }), 'missing_block_hash');
  assertFail(encodeLine({ ...SAMPLE, payment: rest }), 'missing_block_hash');
  assertFail(commitments({ ...SAMPLE, payment: rest }), 'missing_block_hash');
  assertFail(sigmaDigest(rest, Buffer.alloc(32)), 'missing_block_hash');
  const zeros = '00'.repeat(32);
  assertFail(canonicalPaymentId({ ...SAMPLE.payment, blockHash: zeros }), 'missing_block_hash');
  assertFail(canonicalPaymentId({ ...SAMPLE.payment, blockHash: new Uint8Array(32) }), 'missing_block_hash');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, blockHash: zeros } }), 'missing_block_hash');
  const crafted = Uint8Array.from(encodeLine(SAMPLE).line);
  crafted.fill(0, 10, 42);
  assertFail(decodeLine(crafted), 'missing_block_hash');
  assertFail(commitments(crafted), 'missing_block_hash');
});

test('the dedup key ignores blockHash and the payment id ignores txHash', () => {
  const otherHash = 'ef'.repeat(32);
  const a = canonicalPaymentId(SAMPLE.payment);
  const b = canonicalPaymentId({ ...SAMPLE.payment, blockHash: otherHash });
  assert.notEqual(a.hex, b.hex);
  const y1 = yDedupKey(SAMPLE.payment);
  const y2 = yDedupKey({ ...SAMPLE.payment, blockHash: otherHash });
  assert.equal(y1.hex, y2.hex);
  const y3 = yDedupKey({ chainId: 8453, txHash: SAMPLE.payment.txHash, localLogIndex: 4 });
  assert.equal(y3.hex, y1.hex);
  const moved = yDedupKey({ ...SAMPLE.payment, txHash: otherHash });
  assert.notEqual(moved.hex, y1.hex);
  assert.equal(canonicalPaymentId({ ...SAMPLE.payment, txHash: otherHash }).hex, a.hex);
  assertFail(yDedupKey({ chainId: 8453, blockHash: SAMPLE.payment.blockHash, localLogIndex: 4 }), 'bad_type');
  assertFail(yDedupKey({ chainId: 8453, txHash: '', localLogIndex: 4 }), 'bad_hex');
  assertFail(canonicalPaymentId({ ...SAMPLE.payment, logIndex: 4, localLogIndex: undefined }), 'bad_type');
});

test('non-zero padding is rejected and data bytes still decode', () => {
  const encoded = encodeLine(SAMPLE);
  const line = Uint8Array.from(encoded.line);
  for (const at of [803, 900, 1023]) {
    for (const value of [1, 2, 255]) {
      const bad = line.slice();
      bad[at] = value;
      assertFail(decodeLine(bad), 'bad_padding');
      assertFail(commitments(bad), 'bad_padding');
    }
  }
  const flipped = line.slice();
  flipped[100] ^= 0xff;
  const decoded = decodeLine(flipped);
  assert.equal(decoded.ok, true);
  assert.deepEqual(Buffer.from(encodeLine(partsOf(decoded)).line), Buffer.from(flipped));
  for (let i = 0; i < LINE_BYTES; i += 1) {
    const next = line.slice();
    next[i] ^= 0xff;
    const result = decodeLine(next);
    if (i < 2) assertFail(result, 'bad_header');
    else if (i >= 803) assertFail(result, 'bad_padding');
    else if (!result.ok) {
      assert.ok(['missing_block_hash', 'bad_salt', 'bad_uri', 'bad_sigma'].includes(result.reason), `${i} ${result.reason}`);
    } else {
      assert.deepEqual(Buffer.from(encodeLine(partsOf(result)).line), Buffer.from(next));
    }
  }
});

test('decode rejects the wrong length and a bad header', () => {
  const line = encodeLine(SAMPLE).line;
  for (const length of [0, 1, 802, 803, 1023, 1025, 2048]) {
    const exact = new Uint8Array(length);
    exact.set(line.subarray(0, Math.min(length, line.length)));
    assert.equal(exact.length, length);
    assertFail(decodeLine(exact), 'bad_length');
  }
  assertFail(decodeLine(line.buffer), 'bad_type');
  assertFail(decodeLine(Buffer.from(line).toString('hex')), 'bad_type');
  assertFail(decodeLine(null), 'bad_type');
  const badHeader = line.slice();
  badHeader[1] ^= 0xff;
  assert.equal(badHeader[0], 0x63);
  assert.notEqual(badHeader[1], 0x32);
  assertFail(decodeLine(badHeader), 'bad_header');
  const view = new Uint8Array(1025);
  view.set(line, 0);
  assertFail(decodeLine(view), 'bad_length');
  assert.equal(decodeLine(view.subarray(0, 1024)).ok, true);
});

test('integer width, endianness, and -0 are enforced', () => {
  const line = encodeLine(SAMPLE).line;
  assert.equal(hex(line.subarray(2, 10)), SPEC_CHAIN_HEX);
  const wide = 2n ** 53n + 9n;
  const wideLine = encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, chainId: wide } });
  assert.equal(wideLine.ok, true);
  const wideBytes = Buffer.alloc(8);
  writeBe(wideBytes, 0, wide, 8);
  assert.deepEqual(Buffer.from(wideLine.line.subarray(2, 10)), wideBytes);
  assert.notEqual(hex(wideBytes), hex(Buffer.alloc(8).fill(0) && (() => {
    const lost = Buffer.alloc(8);
    writeBe(lost, 0, BigInt(Number(wide)), 8);
    return lost;
  })()));
  const top = (1n << 255n);
  const topLine = encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, value: top } });
  assert.equal(topLine.line[2 + 154], 0x80);
  assert.equal(decodeLine(topLine.line).payment.value, top);
  assert.equal(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, localLogIndex: 65535 } }).ok, true);
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, localLogIndex: 65536 } }), 'bad_range');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, localLogIndex: '65536' } }), 'bad_range');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, txIndex: 4294967296 } }), 'bad_range');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, txIndex: -1 } }), 'bad_range');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, chainId: -0 } }), 'bad_range');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, chainId: 1.5 } }), 'bad_uint');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, value: 1n << 256n } }), 'bad_range');
  assertFail(canonicalPaymentId({ ...SAMPLE.payment, chainId: -0 }), 'bad_range');
  assertFail(canonicalPaymentId({ ...SAMPLE.payment, localLogIndex: -1 }), 'bad_range');
  const zeroNonce = encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, nonce: '00'.repeat(32) } });
  assert.equal(zeroNonce.ok, true);
  assert.ok(zeroNonce.line.subarray(2 + 207, 2 + 239).every((byte) => byte === 0));
  const asBytes = encodeLine({
    ...SAMPLE,
    payment: { ...SAMPLE.payment, chainId: Uint8Array.from(Buffer.from(SPEC_CHAIN_HEX, 'hex')) },
  });
  assert.deepEqual(Buffer.from(asBytes.line), Buffer.from(line));
});

test('hex is lowercase and unprefixed; text prefixes are UTF-8', () => {
  assertFail(canonicalPaymentId({ ...SAMPLE.payment, blockHash: SAMPLE.payment.blockHash.toUpperCase() }), 'bad_hex');
  assertFail(canonicalPaymentId({ ...SAMPLE.payment, blockHash: `0x${SAMPLE.payment.blockHash}` }), 'bad_hex');
  assertFail(canonicalPaymentId({ ...SAMPLE.payment, blockHash: 'abc' }), 'bad_hex');
  assertFail(canonicalPaymentId({ ...SAMPLE.payment, blockHash: ['ab'] }), 'bad_type');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, token: '22'.repeat(19) } }), 'bad_length');
  const marked = encodeLine({ ...SAMPLE, content: { ...SAMPLE.content, uriPrefix: 'é' } });
  const at = 273 + 113;
  assert.equal(marked.line[at], 0xc3);
  assert.equal(marked.line[at + 1], 0xa9);
  assert.equal(marked.line[at + 2], 0x00);
  assertFail(encodeLine({ ...SAMPLE, content: { ...SAMPLE.content, uriPrefix: 'é'.repeat(200) } }), 'bad_length');
  const raw = new Uint8Array(256);
  raw[0] = 0x00;
  raw[1] = 0xff;
  assertFail(encodeLine({ ...SAMPLE, content: { ...SAMPLE.content, uriPrefix: raw } }), 'bad_uri');
  const upperPrefix = 'AB'.repeat(256);
  assertFail(encodeLine({ ...SAMPLE, content: { ...SAMPLE.content, uriPrefix: upperPrefix } }), 'bad_hex');
});

test('fuzz decode never throws and only returns known reasons', () => {
  const next = mulberry32(0x5eed);
  const garbage = [
    undefined, null, 0, -0, 1.5, '', 'zz', true, Symbol('line'),
    new ArrayBuffer(1024), new DataView(new ArrayBuffer(8)), [], {},
  ];
  for (const value of garbage) {
    let result;
    assert.doesNotThrow(() => { result = decodeLine(value); });
    assertFail(result, result.reason === 'bad_length' ? 'bad_length' : 'bad_type');
  }
  for (let n = 0; n < 64; n += 1) {
    const length = next() % 1200;
    const buf = new Uint8Array(length);
    for (let i = 0; i < buf.length; i += 1) buf[i] = next() & 0xff;
    let result;
    assert.doesNotThrow(() => { result = decodeLine(buf); });
    if (length !== 1024) {
      assertFail(result, 'bad_length');
      continue;
    }
    if (!result.ok) {
      assert.ok(REASONS.includes(result.reason));
      assert.deepEqual(Object.keys(result).sort(), ['ok', 'reason']);
      continue;
    }
    const again = encodeLine(partsOf(result));
    assert.equal(again.ok, true);
    assert.deepEqual(Buffer.from(again.line), Buffer.from(buf));
  }
  for (let n = 0; n < 16; n += 1) {
    const line = new Uint8Array(1024);
    line[0] = 0x63;
    line[1] = 0x32;
    for (let i = 2; i < 803; i += 1) line[i] = next() & 0xff;
    const decoded = decodeLine(line);
    if (!decoded.ok) assert.ok(REASONS.includes(decoded.reason));
    else assert.deepEqual(Buffer.from(encodeLine(partsOf(decoded)).line), Buffer.from(line));
    assert.doesNotThrow(() => slotKey({ kind: next() & 0xff, chainId: next(), id: line.subarray(0, next() % 40) }));
    assert.doesNotThrow(() => emptyHash((next() % 80) - 5));
  }
});

test('salts, URI prefix, low-S, canonical integers, and the authorization key', () => {
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, saltP: '00'.repeat(32) } }), 'bad_salt');
  assertFail(encodeLine({ ...SAMPLE, content: { ...SAMPLE.content, saltC: '00'.repeat(32) } }), 'bad_salt');
  assertFail(encodeLine({
    ...SAMPLE,
    payment: { ...SAMPLE.payment, saltP: '55'.repeat(32) },
    content: { ...SAMPLE.content, saltC: '55'.repeat(32) },
  }), 'bad_salt');
  const reused = Uint8Array.from(encodeLine(SAMPLE).line);
  reused.set(reused.subarray(2 + 239, 2 + 271), 273 + 433);
  assertFail(decodeLine(reused), 'bad_salt');

  assertFail(encodeLine({ ...SAMPLE, content: { ...SAMPLE.content, uriPrefix: `${SAMPLE.content.uriPrefix}\0` } }), 'bad_uri');
  const nulled = Uint8Array.from(encodeLine(SAMPLE).line);
  nulled[273 + 113 + SAMPLE.content.uriPrefix.length] = 0;
  nulled[273 + 113 + SAMPLE.content.uriPrefix.length + 1] = 1;
  assertFail(decodeLine(nulled), 'bad_uri');
  const badUtf8 = Uint8Array.from(encodeLine(SAMPLE).line);
  badUtf8[273 + 113] = 0xff;
  assertFail(decodeLine(badUtf8), 'bad_uri');

  const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const half = P256_N >> 1n;
  function sigmaOf(r, s) {
    const raw = Buffer.alloc(64);
    writeBe(raw, 0, r, 32);
    writeBe(raw, 32, s, 32);
    return raw.toString('hex');
  }
  assert.equal(encodeLine({ ...SAMPLE, sigma: { alg: 1, sigma: sigmaOf(1n, half) } }).ok, true);
  assertFail(encodeLine({ ...SAMPLE, sigma: { alg: 1, sigma: sigmaOf(1n, half + 1n) } }), 'bad_sigma');
  assertFail(encodeLine({ ...SAMPLE, sigma: { alg: 1, sigma: sigmaOf(0n, 1n) } }), 'bad_sigma');
  assertFail(encodeLine({ ...SAMPLE, sigma: { alg: 1, sigma: sigmaOf(P256_N, 1n) } }), 'bad_sigma');
  assertFail(encodeLine({ ...SAMPLE, sigma: { alg: 1, sigma: 'ff'.repeat(64) } }), 'bad_sigma');

  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, chainId: '0001000000' } }), 'bad_uint');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, chainId: '0x2105' } }), 'bad_uint');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, chainId: 'ff' } }), 'bad_uint');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, value: '1e2' } }), 'bad_uint');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, chainId: '18446744073709551616' } }), 'bad_range');
  const wideChain = new Uint8Array(9);
  wideChain.set(Buffer.from(SPEC_CHAIN_HEX, 'hex'), 0);
  wideChain[8] = 0xff;
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, chainId: wideChain } }), 'bad_length');
  assertFail(encodeLine({ ...SAMPLE, payment: { ...SAMPLE.payment, extra: 1 } }), 'unknown_field');
  assertFail(encodeLine({ ...SAMPLE, note: true }), 'unknown_field');

  const auth = authorizationKey({
    chainId: SAMPLE.payment.chainId,
    token: SAMPLE.payment.token,
    authorizer: SAMPLE.payment.authorizer,
    nonce: SAMPLE.payment.nonce,
  });
  assert.equal(auth.ok, true);
  assert.equal(auth.bytes.length, 80);
  const authAgain = authorizationKey({
    chainId: SAMPLE.payment.chainId,
    token: SAMPLE.payment.token,
    authorizer: SAMPLE.payment.authorizer,
    nonce: SAMPLE.payment.nonce,
    blockHash: SAMPLE.payment.blockHash,
  });
  assertFail(authAgain, 'unknown_field');
  assertFail(authorizationKey({
    chainId: 8453,
    token: SAMPLE.payment.token,
    authorizer: SAMPLE.payment.authorizer,
    nonce: '00'.repeat(32),
  }), 'nonce_none');
  const otherNonce = authorizationKey({
    chainId: 8453,
    token: SAMPLE.payment.token,
    authorizer: SAMPLE.payment.authorizer,
    nonce: '45'.repeat(32),
  });
  assert.notEqual(otherNonce.hex, auth.hex);
});

test('the committed vector file matches the spec and the codec', () => {
  const text = readFileSync(VECTOR_PATH, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(text, renderLineJson().replace(/\r\n/g, '\n'));
  const vector = JSON.parse(text);
  assert.equal(vector.schema, 'chit402.cs2.line.v1');
  assert.equal(vector.header_hex, '6332');
  assert.equal(vector.line_bytes, 1024);
  assert.equal(vector.pad_bytes, 221);
  assert.deepEqual(vector.reasons, [...REASONS]);
  assert.equal(vector.implementation_limits.max_empty_depth, 64);
  for (const row of vector.slot_keys) {
    assert.equal(row.chain_id_hex, SPEC_CHAIN_HEX);
    assert.equal(row.preimage_hex.startsWith(SPEC_TAG_HEX), true);
    assert.equal(hex(sha(Buffer.from(row.preimage_hex, 'hex'))), SPEC_KEYS[row.name]);
    assert.equal(row.key_hex, SPEC_KEYS[row.name]);
  }
  const oracle = oracleLine(SAMPLE);
  const commit = oracleCommit(oracle);
  assert.equal(vector.line.line_hex, hex(oracle));
  assert.equal(vector.line.payment_id_hex, hex(commit.id));
  assert.equal(vector.line.y_dedup_hex, hex(commit.y));
  assert.equal(vector.line.P, hex(commit.P));
  assert.equal(vector.line.K, hex(commit.K));
  assert.equal(vector.line.C, hex(commit.C));
  assert.equal(vector.line.sigma_digest, hex(commit.sig));
  const empty0 = sha(Buffer.from([0x02]), Buffer.from('empty'));
  assert.equal(vector.hash_domains.empty[0].hash_hex, hex(empty0));
  assert.equal(vector.hash_domains.empty[1].hash_hex, hex(sha(Buffer.from([0x01]), empty0, empty0)));
  assert.equal(toHex(oracle), vector.line.line_hex);
  assert.equal(vector.multi_log.tx_index, 2);
  assert.equal(vector.multi_log.local_log_index, 9);
  assert.equal(vector.multi_log.tx_index_hex, '00000002');
  assert.equal(vector.multi_log.local_log_index_hex, '0009');
  assert.equal(vector.max_line.local_log_index, 65535);
  assert.equal(encodeLine(vector.max_line.parts).ok, true);
  const expectReason = {
    'bad-padding': 'bad_padding',
    'bad-header': 'bad_header',
    'zero-block-hash': 'missing_block_hash',
    'short-line': 'bad_length',
  };
  for (const row of vector.negatives) {
    assert.equal(row.reason, expectReason[row.id]);
    assert.equal(decodeLine(Uint8Array.from(Buffer.from(row.line_hex, 'hex'))).reason, row.reason);
  }
  assert.match(vector.notes.local_log_index, /not the RPC block logIndex/);
  assert.match(vector.notes.P_salt, /last 32 bytes/);
});
