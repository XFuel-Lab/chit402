/**
 * Seller sigma signer. Keys in this file are test keys only.
 * The chain is a fake reader. Nothing here contacts a network.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keccak256 } from '../cs2-core/ecdsa/keccak.js';
import { bigToBytes, bytesToBig, bytesToHex, hexToBytes } from '../cs2-core/ecdsa/bytes.js';
import { P256, SECP256K1 } from '../cs2-core/ecdsa/curves.js';
import { publicPoint, signRawDigest } from '../cs2-core/ecdsa/sign.js';
import { sigmaDigest } from '../cs2-core/line/index.mjs';
import { possessionPreimage } from '../cs2-core/eip712/index.mjs';
import { readAgreedPayment, selectNonce } from './chain.mjs';
import { productionPinList, setTestPinSigning } from './pins.mjs';

setTestPinSigning(true);
import { createMemoryStore } from './testing/memory-store.mjs';
import {
  BOOK_ACTION,
  BOOK_ACTION_TYPE,
  createRpcReader,
  createSeller,
  DOMAIN_FIELDS,
  DOMAIN_NAME,
  DOMAIN_TYPE,
  DOMAIN_VERSION,
  encodeSignatureField,
  EOA_SIGNATURE_BYTES,
  hashChit,
  hashTypedData,
  isLowS,
  payToControlDigest,
  PAYTO_CONTROL,
  PAYTO_CONTROL_TYPE,
  TIME_UNIT,
  contractForHour,
  matchAuthorization,
  REVOKE_BY_KEY_TYPE,
  REVOKE_TYPE,
  revokeRecordId,
  ALG_REGISTRY,
  KEY_ALG_P256,
  KEY_ALG_SECP256K1,
  canonicalKey,
  keyHash,
  signPayToControl,
  signRevoke,
  signRevokeByKey,
  SIGNATURE_LENGTH_PREFIX_BYTES,
  STATEMENT_RECORD_TYPE,
  verifyPayToControl,
  verifyRevoke,
  verifyRevokeByKey,
  verifySigma,
} from './index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const text = new TextEncoder();
const topic = (sig) => bytesToHex(keccak256(text.encode(sig)));
const TRANSFER = topic('Transfer(address,address,uint256)');
const AUTH = topic('AuthorizationUsed(address,bytes32)');

const CHAIN = 84532;
const HASH = 'ab'.repeat(32);
const OTHER = 'bc'.repeat(32);
const TX = 'cd'.repeat(32);
const OTHER_TX = 'de'.repeat(32);
const PAYER = '33'.repeat(20);
const PAYEE = '11'.repeat(20);
const OTHER_ADDR = '66'.repeat(20);
const TOKEN = '22'.repeat(20);
const NONCE_A = '44'.repeat(32);
const NONCE_B = '55'.repeat(32);
const K = 'ee'.repeat(32);
const PRICE = 1000000n;
const SELLER_KEY = '11'.repeat(32);
const SIGMA_K = 9n;

const sigmaVector = JSON.parse(readFileSync(join(here, 'vectors/sigma.json'), 'utf8'));
const eipVector = JSON.parse(readFileSync(join(here, '../cs2-core/eip712/vectors/eip712.json'), 'utf8'));

function padAddress(hex20) {
  return `${'0'.repeat(24)}${hex20}`;
}

function padUint(value) {
  return value.toString(16).padStart(64, '0');
}

function transferLog(from, to, value, token = TOKEN) {
  return {
    address: token,
    topics: [`0x${TRANSFER}`, `0x${padAddress(from)}`, `0x${padAddress(to)}`],
    data: `0x${padUint(value)}`,
    logIndex: 99,
  };
}

function authLog(authorizer, nonce) {
  return {
    address: TOKEN,
    topics: [`0x${AUTH}`, `0x${padAddress(authorizer)}`, `0x${nonce}`],
    data: '0x',
    logIndex: 98,
  };
}

function defaultLogs() {
  return [
    authLog(PAYER, NONCE_A),
    transferLog(PAYER, PAYEE, PRICE),
    authLog(PAYER, NONCE_B),
    transferLog(PAYER, PAYEE, 1n),
  ];
}

function readersOf(reader, n = 3) {
  return Array.from({ length: n }, () => ({
    getChainId: () => reader.getChainId(),
    getBlockByHash: (hash) => reader.getBlockByHash(hash),
    getBlockByNumber: (tag) => reader.getBlockByNumber(tag),
    getReceipt: (hash) => reader.getReceipt(hash),
  }));
}

function world(opts = {}) {
  const hash = opts.blockHash || HASH;
  const number = opts.number ?? 50n;
  const head = opts.head ?? 50n;
  const canonicalHash = Object.hasOwn(opts, 'canonicalHash') ? opts.canonicalHash : hash;
  const txHash = opts.txHash || TX;
  const txIndex = opts.txIndex ?? 2;
  const logs = opts.logs || defaultLogs();
  const txs = [];
  for (let i = 0; i < txIndex; i += 1) txs.push(OTHER_TX);
  txs[txIndex] = txHash;
  const calls = [];
  return {
    calls,
    async getChainId() {
      calls.push('chainId');
      if (opts.chainThrows) throw new Error(opts.chainThrows);
      return opts.chainId ?? CHAIN;
    },
    async getBlockByHash(got) {
      calls.push(['hash', got]);
      if (opts.missingHash) return null;
      if (got !== hash) return null;
      return {
        number,
        hash: `0x${hash}`,
        timestamp: 1700000000,
        transactions: txs.map((item) => `0x${item}`),
      };
    },
    async getBlockByNumber(tag) {
      calls.push(['number', typeof tag === 'bigint' ? tag.toString() : String(tag)]);
      if (tag === 'finalized') {
        if (opts.noHead) return null;
        return { number: head, hash: `0x${'ff'.repeat(32)}`, timestamp: 1, transactions: [] };
      }
      if (typeof tag === 'bigint' && tag === number) {
        if (canonicalHash == null) return null;
        return {
          number,
          hash: `0x${canonicalHash}`,
          timestamp: 1700000000,
          transactions: txs.map((item) => `0x${item}`),
        };
      }
      return null;
    },
    async getReceipt(got) {
      calls.push(['receipt', got]);
      if (got !== txHash) return null;
      return {
        status: opts.status ?? 1,
        blockHash: `0x${opts.receiptBlockHash || hash}`,
        transactionHash: `0x${txHash}`,
        transactionIndex: opts.receiptIndex ?? txIndex,
        logs,
      };
    },
  };
}

function payment(over = {}) {
  return {
    chainId: CHAIN,
    blockHash: HASH,
    txIndex: 2,
    localLogIndex: 1,
    txHash: TX,
    ...over,
  };
}

function authorization(over = {}) {
  return {
    payer: `0x${PAYER}`,
    payee: `0x${PAYEE}`,
    price: PRICE.toString(),
    nonce: `0x${NONCE_A}`,
    token: `0x${TOKEN}`,
    ...over,
  };
}

function seller(reader, extra = {}) {
  return createSeller({
    privateKey: SELLER_KEY,
    store: extra.store || createMemoryStore(),
    token: extra.token || TOKEN,
    payee: extra.payee || PAYEE,
    readers: extra.readers || readersOf(reader),
  });
}

function assertRefusal(result, reason) {
  assert.equal(result.ok, false, result.reason);
  assert.equal(result.reason, reason);
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'reason']);
  assert.equal(JSON.stringify(result).includes(SELLER_KEY), false);
}

function assertSigned(result) {
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(Object.keys(result).sort(), ['alg', 'digest', 'ok', 'paymentId', 'sigma']);
  assert.equal(result.alg, 1);
  assert.equal(result.sigma.length, 64);
  assert.equal(result.digest.length, 32);
  assert.equal(JSON.stringify({
    alg: result.alg,
    paymentId: result.paymentId,
    sigma: bytesToHex(result.sigma),
    digest: bytesToHex(result.digest),
  }).includes(SELLER_KEY), false);
}

test('the Transfer topic is the canonical ERC-20 topic', () => {
  assert.equal(TRANSFER, 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
  assert.equal(AUTH, '98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5');
});

test('signs when payer, payee, price and nonce match a canonical finalized block', async () => {
  const reader = world();
  const who = seller(reader);
  const signed = await who.sign({
    payment: payment({ blockHash: `0x${HASH.toUpperCase()}` }),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertSigned(signed);
  assert.equal(bytesToHex(signed.digest), sigmaVector.digest);
  assert.equal(bytesToHex(signed.sigma), sigmaVector.sigma);
  assert.equal(signed.paymentId, sigmaVector.payment_id);
  const codec = sigmaDigest({
    chainId: CHAIN,
    blockHash: HASH,
    txIndex: 2,
    localLogIndex: 1,
  }, K, 1);
  assert.equal(codec.hex, sigmaVector.digest);
  const verified = verifySigma({
    digest: signed.digest,
    sigma: signed.sigma,
    publicKey: who.publicKey,
  });
  assert.equal(verified.ok, true);
  const kinds = reader.calls.map((call) => (Array.isArray(call) ? call[0] : call));
  assert.deepEqual(kinds.slice(0, 5), ['chainId', 'hash', 'number', 'number', 'receipt']);
  assert.equal(kinds.length, 15);
  assert.equal(reader.calls[1][1], HASH);
  assert.equal(reader.calls[2][1], 'finalized');
  assert.equal(reader.calls[3][1], '50');
});

test('a payer mismatch produces no sigma', async () => {
  const who = seller(world());
  const signed = await who.sign({
    payment: payment(),
    authorization: authorization({ payer: `0x${OTHER_ADDR}` }),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'payer_mismatch');
});

test('a payee mismatch produces no sigma', async () => {
  const who = seller(world());
  const signed = await who.sign({
    payment: payment(),
    authorization: authorization({ payee: `0x${OTHER_ADDR}` }),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'payee_mismatch');
});

test('a price above the call produces no sigma', async () => {
  const reader = world({
    logs: [
      authLog(PAYER, NONCE_A),
      transferLog(PAYER, PAYEE, PRICE + 1n),
    ],
  });
  const signed = await seller(reader).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'price_mismatch');
});

test('a price below the call produces no sigma', async () => {
  const reader = world({
    logs: [
      authLog(PAYER, NONCE_A),
      transferLog(PAYER, PAYEE, PRICE - 1n),
    ],
  });
  const signed = await seller(reader).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'price_mismatch');
});

test('a nonce mismatch produces no sigma', async () => {
  const signed = await seller(world()).sign({
    payment: payment(),
    authorization: authorization({ nonce: `0x${'77'.repeat(32)}` }),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'nonce_mismatch');
});

test('a zero nonce produces no sigma', async () => {
  const zero = '00'.repeat(32);
  const signed = await seller(world({
    logs: [authLog(PAYER, zero), transferLog(PAYER, PAYEE, PRICE)],
  })).sign({
    payment: payment(),
    authorization: authorization({ nonce: `0x${zero}` }),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'nonce_mismatch');
});

test('the second AuthorizationUsed nonce in the settle still matches', async () => {
  const signed = await seller(world()).sign({
    payment: payment({ localLogIndex: 3 }),
    authorization: authorization({ price: '1', nonce: `0x${NONCE_B}` }),
    K,
    alg: 1,
  });
  assertSigned(signed);
});

test('a transfer from a different address produces no sigma', async () => {
  const reader = world({
    logs: [
      authLog(PAYER, NONCE_A),
      transferLog(OTHER_ADDR, PAYEE, PRICE),
    ],
  });
  const signed = await seller(reader).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'payer_mismatch');
});

test('an AuthorizationUsed authorizer that is not the payer produces no sigma', async () => {
  const reader = world({
    logs: [
      authLog(OTHER_ADDR, NONCE_A),
      transferLog(PAYER, PAYEE, PRICE),
    ],
  });
  const signed = await seller(reader).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'payer_mismatch');
});

test('a token mismatch produces no sigma', async () => {
  const signed = await seller(world()).sign({
    payment: payment(),
    authorization: authorization({ token: `0x${OTHER_ADDR}` }),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'token_mismatch');
});

test('a reorged block produces no sigma', async () => {
  const reader = world({ canonicalHash: OTHER });
  const signed = await seller(reader).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'reorged');
});

test('a block above the finalized head produces no sigma', async () => {
  const reader = world({ number: 51n, head: 50n });
  const signed = await seller(reader).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'not_finalized');
});

test('a missing finalized head produces no sigma', async () => {
  const signed = await seller(world({ noHead: true })).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'not_finalized');
});

test('a zero blockHash produces no sigma and does not read the chain', async () => {
  const reader = world();
  const signed = await seller(reader).sign({
    payment: payment({ blockHash: '0'.repeat(64) }),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'missing_block_hash');
  assert.equal(reader.calls.length, 0);
});

test('a missing blockHash produces no sigma and does not read the chain', async () => {
  const reader = world();
  const body = payment();
  delete body.blockHash;
  const signed = await seller(reader).sign({
    payment: body,
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'missing_block_hash');
  assert.equal(reader.calls.length, 0);
});

test('the wrong blockHash for a real transfer produces no sigma', async () => {
  const calls = [];
  const realTxs = [OTHER_TX, OTHER_TX, TX];
  const otherTxs = [OTHER_TX, OTHER_TX, OTHER_TX];
  const reader = {
    calls,
    async getChainId() { calls.push('chainId'); return CHAIN; },
    async getBlockByHash(got) {
      calls.push(['hash', got]);
      if (got === HASH) {
        return { number: 40n, hash: `0x${HASH}`, timestamp: 10, transactions: realTxs.map((t) => `0x${t}`) };
      }
      if (got === OTHER) {
        return { number: 41n, hash: `0x${OTHER}`, timestamp: 11, transactions: otherTxs.map((t) => `0x${t}`) };
      }
      return null;
    },
    async getBlockByNumber(tag) {
      calls.push(['number', typeof tag === 'bigint' ? tag.toString() : String(tag)]);
      if (tag === 'finalized') {
        return { number: 41n, hash: `0x${'ff'.repeat(32)}`, timestamp: 12, transactions: [] };
      }
      if (tag === 40n) {
        return { number: 40n, hash: `0x${HASH}`, timestamp: 10, transactions: realTxs.map((t) => `0x${t}`) };
      }
      if (tag === 41n) {
        return { number: 41n, hash: `0x${OTHER}`, timestamp: 11, transactions: otherTxs.map((t) => `0x${t}`) };
      }
      return null;
    },
    async getReceipt() {
      calls.push('receipt');
      return {
        status: 1,
        blockHash: `0x${HASH}`,
        transactionHash: `0x${TX}`,
        transactionIndex: 2,
        logs: defaultLogs(),
      };
    },
  };
  const signed = await seller(reader).sign({
    payment: payment({ blockHash: OTHER }),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'tx_mismatch');
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'hash' && call[1] === OTHER), true);
});

test('the same payment id with a second nonce is refused', async () => {
  const who = seller(world());
  const first = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  assertSigned(first);
  const second = await who.sign({
    payment: payment(),
    authorization: authorization({ nonce: `0x${NONCE_B}` }),
    K,
    alg: 1,
  });
  assertRefusal(second, 'nonce_mismatch');
});

test('the payment claim is refused even when the authorization claim would succeed', async () => {
  const pays = new Set();
  const store = {
    claim(id) {
      if (!id.startsWith('pay:')) return true;
      if (pays.has(id)) return false;
      pays.add(id);
      return true;
    },
    release() {},
    has() { return false; },
  };
  const who = seller(world(), { store });
  assertSigned(await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 }));
  assertRefusal(await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 }), 'duplicate_sigma');
});

test('a second sigma for the same payment id is refused', async () => {
  const who = seller(world());
  const first = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  assertSigned(first);
  const second = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  assertRefusal(second, 'duplicate_sigma');
  assert.equal(JSON.stringify(second).includes(bytesToHex(first.sigma)), false);
});

test('one authorization cannot sign a second transfer', async () => {
  const logs = [
    authLog(PAYER, NONCE_A),
    transferLog(PAYER, PAYEE, PRICE),
    authLog(PAYER, NONCE_A),
    transferLog(PAYER, PAYEE, 1n),
  ];
  const who = seller(world({ logs }));
  const first = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  assertSigned(first);
  const second = await who.sign({
    payment: payment({ localLogIndex: 3 }),
    authorization: authorization({ price: '1' }),
    K,
    alg: 1,
  });
  assertRefusal(second, 'duplicate_sigma');
});

test('a mismatch does not consume the once-slot', async () => {
  const who = seller(world());
  const missed = await who.sign({
    payment: payment(),
    authorization: authorization({ payee: `0x${OTHER_ADDR}` }),
    K,
    alg: 1,
  });
  assertRefusal(missed, 'payee_mismatch');
  const signed = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  assertSigned(signed);
});

test('a disallowed alg produces no sigma and does not read the chain', async () => {
  const reader = world();
  const signed = await seller(reader).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 2,
  });
  assertRefusal(signed, 'bad_alg');
  assert.equal(reader.calls.length, 0);
});

test('a transaction hash without a log index is refused before the chain read', async () => {
  const reader = world();
  const body = payment();
  delete body.localLogIndex;
  const signed = await seller(reader).sign({
    payment: body,
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'ambiguous_transfer');
  assert.equal(reader.calls.length, 0);
});

test('a multi-transfer settle binds the log index and the value', async () => {
  const who = seller(world());
  const first = await who.sign({
    payment: payment({ localLogIndex: 3 }),
    authorization: authorization({ price: '1', nonce: `0x${NONCE_B}` }),
    K,
    alg: 1,
  });
  assertSigned(first);
  const second = await who.sign({
    payment: payment({ localLogIndex: 1 }),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertSigned(second);
  assert.notEqual(first.paymentId, second.paymentId);
  const wrongValue = await seller(world()).sign({
    payment: payment({ localLogIndex: 3 }),
    authorization: authorization({ price: PRICE.toString(), nonce: `0x${NONCE_B}` }),
    K,
    alg: 1,
  });
  assertRefusal(wrongValue, 'price_mismatch');
});

test('a high-S sigma is rejected', async () => {
  const who = seller(world());
  const signed = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  assertSigned(signed);
  const high = new Uint8Array(64);
  high.set(signed.sigma.subarray(0, 32), 0);
  high.set(bigToBytes(P256.order - bytesToBig(signed.sigma.subarray(32)), 32), 32);
  const verdict = verifySigma({ digest: signed.digest, sigma: high, publicKey: who.publicKey });
  assertRefusal(verdict, 'bad_sigma');
});

test('a flipped sigma byte is rejected', async () => {
  const who = seller(world());
  const signed = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  const flipped = new Uint8Array(signed.sigma);
  flipped[0] ^= 0x01;
  const verdict = verifySigma({ digest: signed.digest, sigma: flipped, publicKey: who.publicKey });
  assert.equal(verdict.ok, false);
});

test('RFC 6979 nonces differ across payments and a caller nonce is refused', async () => {
  const who = seller(world());
  const first = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  assertSigned(first);
  const second = await who.sign({
    payment: payment({ localLogIndex: 3 }),
    authorization: authorization({ price: '1', nonce: `0x${NONCE_B}` }),
    K,
    alg: 1,
  });
  assertSigned(second);
  assert.notEqual(bytesToHex(first.sigma.subarray(0, 32)), bytesToHex(second.sigma.subarray(0, 32)));
  assert.equal(bytesToHex(first.sigma), sigmaVector.sigma);
  assertRefusal(await who.sign({ payment: payment({ txIndex: 1 }), authorization: authorization(), K, alg: 1, k: 9n }), 'bad_key');
});

test('low-S uses the curve it is given', () => {
  const between = (P256.order >> 1n) + 1n;
  assert.ok(between <= (SECP256K1.order >> 1n));
  assert.equal(isLowS(bigToBytes(P256.order >> 1n, 32), P256), true);
  assert.equal(isLowS(bigToBytes(between, 32), P256), false);
  assert.equal(isLowS(bigToBytes(between, 32), SECP256K1), true);
  assert.equal(isLowS(bigToBytes((SECP256K1.order >> 1n) + 1n, 32), SECP256K1), false);
});

test('the EIP-712 Mail vector matches the published digest', () => {
  const types = {
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  };
  const domain = {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  };
  const message = {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  };
  assert.equal(bytesToHex(hashTypedData(domain, types, 'Mail', message)), eipVector.mail_digest);
  assert.equal(eipVector.mail_digest, 'be609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2');
});

const HOUR_A = 1800000000n;
const HOUR_B = 1800036000n;
const CONTRACT_A = 'aa'.repeat(20);
const CONTRACT_B = 'bb'.repeat(20);
const EXPIRY = 1800086400n;

function pins() {
  return [
    { chainId: CHAIN, address: `0x${CONTRACT_A}`, genesisHourStart: HOUR_A, retireHour: HOUR_B },
    { chainId: CHAIN, address: `0x${CONTRACT_B}`, genesisHourStart: HOUR_B },
  ];
}

function k1Compressed(scalar) {
  const pub = publicPoint(scalar, P256);
  const out = new Uint8Array(33);
  out[0] = (pub[64] & 1) ? 3 : 2;
  out.set(pub.subarray(1, 33), 1);
  return out;
}

function controlInput(hourStart, extra = {}) {
  const key = k1Compressed(BigInt(`0x${eipVector.slot_scalar}`));
  return {
    key,
    input: {
      chainId: CHAIN,
      payTo: eipVector.payTo,
      keyAlg: 1,
      key,
      expiry: EXPIRY,
      hourStart,
      privateKey: BigInt(`0x${eipVector.test_key}`),
      keyPrivateKey: BigInt(`0x${eipVector.slot_scalar}`),
      store: createMemoryStore(),
      ...extra,
    },
  };
}

test('two contracts on one chainId produce different PayToControl digests', () => {
  assert.equal(DOMAIN_NAME, 'Chit402');
  assert.equal(DOMAIN_VERSION, '13');
  assert.equal(DOMAIN_TYPE, eipVector.domain_type);
  assert.equal(PAYTO_CONTROL_TYPE, eipVector.payto_control_type);
  assert.equal(REVOKE_TYPE, eipVector.revoke_type);
  assert.equal(REVOKE_BY_KEY_TYPE, eipVector.revoke_by_key_type);
  assert.equal(BOOK_ACTION_TYPE, eipVector.book_action_type);
  assert.equal(STATEMENT_RECORD_TYPE, eipVector.statement_record_type);
  assert.equal(DOMAIN_FIELDS.some((field) => field.name === 'salt'), false);
  assert.equal(DOMAIN_FIELDS.some((field) => field.name === 'verifyingContract'), true);
  const first = controlInput(HOUR_A);
  const digestA = payToControlDigest(first.input);
  const digestB = payToControlDigest({ ...first.input, hourStart: HOUR_B });
  assert.equal(digestA.hex, eipVector.digest_a);
  assert.equal(digestB.hex, eipVector.digest_b);
  assert.notEqual(digestA.hex, digestB.hex);
  assertRefusal(payToControlDigest({
    ...first.input,
    verifyingContract: `0x${CONTRACT_B}`,
  }), 'bad_payment');
  const bookA = hashChit(BOOK_ACTION, {
    bookId: '01'.repeat(32),
    eventHash: '02'.repeat(32),
    kind: 1,
    seq: 1n,
    expiry: EXPIRY,
  }, BigInt(CHAIN), CONTRACT_A);
  const bookB = hashChit(BOOK_ACTION, {
    bookId: '01'.repeat(32),
    eventHash: '02'.repeat(32),
    kind: 1,
    seq: 1n,
    expiry: EXPIRY,
  }, BigInt(CHAIN), CONTRACT_B);
  assert.equal(bookA.ok, true);
  assert.notEqual(bookA.hex, bookB.hex);
});

test('PayToControl signs under the pinned contract for the hour and verifies there', async () => {
  const { key, input } = controlInput(HOUR_A);
  assert.equal(bytesToHex(key), eipVector.key);
  const signed = await signPayToControl(input);
  assert.equal(signed.ok, true, signed.reason);
  assert.equal(bytesToHex(signed.digest), eipVector.digest_a);
  assert.equal(bytesToHex(signed.signature), eipVector.signature_a);
  assert.equal(signed.signature.length, (SIGNATURE_LENGTH_PREFIX_BYTES + EOA_SIGNATURE_BYTES) + (SIGNATURE_LENGTH_PREFIX_BYTES + 64));
  const yParity = signed.signature[SIGNATURE_LENGTH_PREFIX_BYTES + EOA_SIGNATURE_BYTES - 1];
  assert.ok(yParity === 0 || yParity === 1);
  assert.equal(signed.record.domain.name, DOMAIN_NAME);
  assert.equal(signed.record.domain.version, DOMAIN_VERSION);
  assert.equal(signed.record.domain.verifyingContract, `0x${CONTRACT_A}`);
  assert.equal(Object.hasOwn(signed.record.message, 'validFrom'), false);
  assert.equal(Object.hasOwn(signed.record.message, 'revokedAt'), false);
  assert.equal(signed.record.message.expiry, EXPIRY.toString());
  assert.equal(JSON.stringify(signed.record).includes(eipVector.test_key), false);
  const verified = verifyPayToControl({ ...input, signature: signed.signature });
  assert.equal(verified.ok, true);
  assert.equal(verified.signer, eipVector.signer);
  const kept = bytesToHex(signed.signature);
  const underNext = verifyPayToControl({ ...input, hourStart: HOUR_B, signature: signed.signature });
  assertRefusal(underNext, 'bad_signature');
  assert.equal(bytesToHex(signed.signature), kept);
  const still = verifyPayToControl({ ...input, signature: signed.signature });
  assert.equal(still.ok, true);
});

test('a PayToControl signature rejects a tamper, high-S, a legacy y byte, and a bad alg', async () => {
  const { key, input } = controlInput(HOUR_A);
  const signed = await signPayToControl(input);
  const flipped = new Uint8Array(signed.signature);
  flipped[10] ^= 0x01;
  assertRefusal(verifyPayToControl({ ...input, signature: flipped }), 'bad_signature');
  const inner = signed.signature.subarray(SIGNATURE_LENGTH_PREFIX_BYTES);
  const highInner = new Uint8Array(inner);
  const s = bytesToBig(inner.subarray(32, 64));
  highInner.set(bigToBytes(SECP256K1.order - s, 32), 32);
  highInner[64] = inner[64] === 0 ? 1 : 0;
  assertRefusal(verifyPayToControl({
    ...input,
    signature: encodeSignatureField(highInner),
  }), 'bad_signature');
  const legacy = new Uint8Array(inner);
  legacy[64] = inner[64] + 27;
  assertRefusal(verifyPayToControl({
    ...input,
    signature: encodeSignatureField(legacy),
  }), 'bad_signature');
  assertRefusal(verifyPayToControl({ ...input, signature: inner }), 'bad_signature');
  const longer = encodeSignatureField(concatBytes(inner, new Uint8Array([1, 2, 3, 4, 5])));
  assertRefusal(verifyPayToControl({ ...input, signature: longer }), 'bad_signature');
  const shorter = encodeSignatureField(inner.subarray(0, EOA_SIGNATURE_BYTES - 1));
  assertRefusal(verifyPayToControl({ ...input, signature: shorter }), 'bad_signature');
  assertRefusal(await signPayToControl({ ...input, keyAlg: 2 }), 'bad_alg');
  assertRefusal(await signPayToControl({
    ...input,
    payTo: `0x${'00'.repeat(20)}`,
    store: createMemoryStore(),
  }), 'bad_payment');
  assertRefusal(await signPayToControl({ ...input, key: new Uint8Array(65) }), 'bad_length');
  const uncompressed = new Uint8Array(key);
  uncompressed[0] = 0x04;
  assertRefusal(await signPayToControl({ ...input, key: uncompressed }), 'bad_length');
  assertRefusal(verifyPayToControl({ ...input, key: uncompressed, signature: signed.signature }), 'bad_length');
  assertRefusal(await signPayToControl({ ...input, hourStart: HOUR_A + 1n }), 'bad_hour');
  assertRefusal(await signPayToControl({ ...input, hourStart: HOUR_A - 7200n }), 'contract_unpinned');
  assertRefusal(await signPayToControl({ ...input, pinnedContracts: pins() }), 'bad_payment');
  assertRefusal(await signPayToControl({ ...input, expiry: HOUR_A }), 'bad_payment');
  assertRefusal(verifyPayToControl({
    ...input,
    hourStart: HOUR_B,
    expiry: HOUR_A + 1n,
    signature: signed.signature,
  }), 'bad_payment');
});

test('revoke is signed by the payTo and its id is slot plus keyHash', async () => {
  const { key, input } = controlInput(HOUR_A);
  const hashed = keyHash(1, key);
  assert.equal(hashed.ok, true);
  const revoke = await signRevoke({
    chainId: CHAIN,
    hourStart: HOUR_A,
    payTo: input.payTo,
    keyHash: hashed.bytes,
    privateKey: input.privateKey,
  });
  assert.equal(revoke.ok, true, revoke.reason);
  assert.equal(revoke.record.message.keyHash, `0x${hashed.hex}`);
  assertRefusal(await signRevoke({
    chainId: CHAIN,
    hourStart: HOUR_A,
    payTo: input.payTo,
    keyHash: hashed.hex,
    privateKey: input.privateKey,
  }), 'bad_length');
  assert.equal(revoke.record.domain.verifyingContract, `0x${CONTRACT_A}`);
  assert.equal(Object.hasOwn(revoke.record.message, 'revokedAt'), false);
  assert.equal(verifyRevoke({
    chainId: CHAIN,
    hourStart: HOUR_A,
    payTo: input.payTo,
    keyHash: hashed.bytes,
    signature: revoke.signature,
  }).ok, true);
  const trailingRevoke = new Uint8Array(revoke.signature.length + 1);
  trailingRevoke.set(revoke.signature);
  assertRefusal(verifyRevoke({
    chainId: CHAIN,
    hourStart: HOUR_A,
    payTo: input.payTo,
    keyHash: hashed.bytes,
    signature: trailingRevoke,
  }), 'bad_signature');
  const wide = new Uint8Array(66);
  wide.set(revoke.signature.subarray(2));
  assertRefusal(verifyRevoke({
    chainId: CHAIN,
    hourStart: HOUR_A,
    payTo: input.payTo,
    keyHash: hashed.bytes,
    signature: encodeSignatureField(wide),
  }), 'bad_signature');
  const highRevoke = new Uint8Array(revoke.signature);
  const rs = highRevoke.subarray(2, 66);
  rs.set(bigToBytes(SECP256K1.order - bytesToBig(rs.subarray(32)), 32), 32);
  highRevoke[66] ^= 1;
  assertRefusal(verifyRevoke({
    chainId: CHAIN,
    hourStart: HOUR_A,
    payTo: input.payTo,
    keyHash: hashed.bytes,
    signature: highRevoke,
  }), 'bad_signature');
  const legacyRevoke = new Uint8Array(revoke.signature);
  legacyRevoke[66] = revoke.signature[66] + 27;
  assertRefusal(verifyRevoke({
    chainId: CHAIN,
    hourStart: HOUR_A,
    payTo: input.payTo,
    keyHash: hashed.bytes,
    signature: legacyRevoke,
  }), 'bad_signature');
  const slot = '03'.repeat(32);
  const id = revokeRecordId(slot, hashed.bytes);
  assert.equal(id.ok, true);
  assert.equal(id.hex, revokeRecordId(slot, hashed.bytes).hex);
  assert.equal(revokeRecordId(slot, 'ab'.repeat(32)).reason, 'bad_length');
  assert.equal(revokeRecordId(slot, `0x${'ab'.repeat(32).toUpperCase()}`).reason, 'bad_length');
  assert.notEqual(id.hex, revokeRecordId(slot, `0x${'cd'.repeat(32)}`).hex);
  assert.equal(id.bytes.length, 64);
  const byKey = await signRevokeByKey({
    chainId: CHAIN,
    keyHash: hashed.bytes,
    key,
    keyAlg: 1,
    hourStart: HOUR_A,
    privateKey: input.keyPrivateKey,
  });
  assert.equal(byKey.ok, true, byKey.reason);
  assert.equal(byKey.signature.length, 64);
  assert.equal(verifyRevokeByKey({
    chainId: CHAIN,
    keyHash: hashed.bytes,
    key,
    keyAlg: 1,
    hourStart: HOUR_A,
    signature: byKey.signature,
  }).ok, true);
  assertRefusal(await signRevokeByKey({
    chainId: CHAIN,
    keyHash: `0x${'04'.repeat(32)}`,
    key,
    keyAlg: 1,
    hourStart: HOUR_A,
    privateKey: input.keyPrivateKey,
  }), 'bad_payment');
  const { keyAlg: omittedAlg, ...noAlg } = {
    chainId: CHAIN,
    keyHash: hashed.bytes,
    key,
    keyAlg: 1,
    hourStart: HOUR_A,
    privateKey: input.keyPrivateKey,
    store: createMemoryStore(),
  };
  assertRefusal(await signRevokeByKey(noAlg), 'bad_alg');
  const shortHash = hashed.bytes.subarray(0, 31);
  const longHash = new Uint8Array(33);
  longHash.set(hashed.bytes);
  assertRefusal(await signRevoke({
    chainId: CHAIN,
    hourStart: HOUR_A,
    payTo: input.payTo,
    keyHash: shortHash,
    privateKey: input.privateKey,
  }), 'bad_length');
  assertRefusal(await signRevoke({
    chainId: CHAIN,
    hourStart: HOUR_A,
    payTo: input.payTo,
    keyHash: longHash,
    privateKey: input.privateKey,
  }), 'bad_length');
  assertRefusal(verifyRevoke({
    chainId: CHAIN,
    hourStart: HOUR_A,
    payTo: input.payTo,
    keyHash: shortHash,
    signature: revoke.signature,
  }), 'bad_length');
  assert.equal(hashChit('Revoke', {
    payTo: input.payTo,
    keyHash: hashed.hex,
  }, BigInt(CHAIN), CONTRACT_A).ok, false);
  assert.equal(hashChit('Revoke', {
    payTo: input.payTo,
    keyHash: `0x${hashed.hex.toUpperCase()}`,
  }, BigInt(CHAIN), CONTRACT_A).ok, false);
  assertRefusal(verifyRevokeByKey({
    chainId: CHAIN,
    keyHash: hashed.bytes,
    key: k1Compressed(3n),
    keyAlg: 1,
    hourStart: HOUR_A,
    signature: byKey.signature,
  }), 'bad_signature');
  const laterHour = HOUR_B + 3600n * 5000n;
  const laterSigned = await signRevokeByKey({
    chainId: CHAIN,
    keyHash: hashed.bytes,
    key,
    keyAlg: 1,
    hourStart: HOUR_B,
    privateKey: input.keyPrivateKey,
    store: createMemoryStore(),
  });
  assert.equal(laterSigned.ok, true, laterSigned.reason);
  const later = verifyRevokeByKey({
    chainId: CHAIN,
    keyHash: hashed.bytes,
    key,
    keyAlg: 1,
    hourStart: laterHour,
    signature: laterSigned.signature,
  });
  assert.equal(later.ok, true);
  assertRefusal(verifyRevokeByKey({
    chainId: CHAIN,
    keyHash: hashed.bytes,
    key,
    keyAlg: 1,
    hourStart: HOUR_A,
    signature: laterSigned.signature,
  }), 'bad_signature');
});

function concatBytes(left, right) {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

test('a chain id mismatch produces no sigma', async () => {
  const signed = await seller(world({ chainId: 1 })).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'chain_mismatch');
});

test('an unknown block produces no sigma', async () => {
  const signed = await seller(world({ missingHash: true })).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'unknown_block');
});

test('a failed receipt produces no sigma', async () => {
  const signed = await seller(world({ status: 0 })).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'bad_payment');
});

test('a receipt whose blockHash disagrees with the request produces no sigma', async () => {
  const signed = await seller(world({ receiptBlockHash: OTHER })).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'tx_mismatch');
});

test('a receipt whose transaction index disagrees produces no sigma', async () => {
  const signed = await seller(world({ receiptIndex: 0 })).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'tx_mismatch');
});

test('the rpc reader loads the payment by block hash and the finalized tag', async () => {
  const calls = [];
  const fetchImpl = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ method: body.method, params: body.params, redirect: opts.redirect });
    const result = rpcResult(body.method, body.params);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
  const reader = createRpcReader('http://rpc.test/local', { fetchImpl });
  const who = seller(reader, { readers: readersOf(reader) });
  const again = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  assertSigned(again);
  assert.equal(bytesToHex(again.sigma), sigmaVector.sigma);
  const methods = calls.map((call) => call.method);
  assert.ok(methods.includes('eth_chainId'));
  assert.ok(methods.includes('eth_getBlockByHash'));
  assert.equal(calls.find((call) => call.method === 'eth_getBlockByHash').params[1], false);
  assert.equal(calls.find((call) => call.method === 'eth_getBlockByNumber').params[0], 'finalized');
  assert.equal(calls.every((call) => call.redirect === 'error'), true);
  assert.equal(methods.includes('eth_getBlockByNumber'), true);
  const hashAt = methods.indexOf('eth_getBlockByHash');
  const numberAt = methods.indexOf('eth_getBlockByNumber');
  assert.ok(hashAt >= 0 && hashAt < numberAt);
});

function rpcResult(method, params) {
  if (method === 'eth_chainId') return '0x14a34';
  const block = {
    number: '0x32',
    hash: `0x${HASH}`,
    timestamp: '0x6553f100',
    transactions: [`0x${OTHER_TX}`, `0x${OTHER_TX}`, `0x${TX}`],
  };
  if (method === 'eth_getBlockByHash') return block;
  if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') {
    return { number: '0x32', hash: `0x${'ff'.repeat(32)}`, timestamp: '0x1', transactions: [] };
  }
  if (method === 'eth_getBlockByNumber') return block;
  if (method === 'eth_getTransactionReceipt') {
    return {
      status: '0x1',
      blockHash: `0x${HASH}`,
      transactionHash: `0x${TX}`,
      transactionIndex: '0x2',
      logs: defaultLogs(),
    };
  }
  return null;
}

test('a reader failure does not echo the thrown text', async () => {
  const reader = world({ chainThrows: SELLER_KEY });
  const signed = await seller(reader).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'chain_unread');
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: { message: SELLER_KEY } }),
  });
  const rpc = createRpcReader('http://rpc.test/local', { fetchImpl });
  const viaRpc = await seller(rpc, { readers: readersOf(rpc) }).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(viaRpc, 'chain_unread');
});

test('createSeller does not expose the private key', () => {
  const who = seller(world());
  assert.equal(Object.hasOwn(who, 'privateKey'), false);
  assert.equal(JSON.stringify(who).includes(SELLER_KEY), false);
  assert.equal(who.publicKey.length, 65);
  assert.equal(who.compressedKey.length, 33);
  const bad = createSeller({ privateKey: 0n, store: createMemoryStore(), token: TOKEN, payee: PAYEE, readers: [world(), world(), world()] });
  assertRefusal(bad, 'bad_key');
  assertRefusal(createSeller({ privateKey: SELLER_KEY, token: TOKEN, payee: PAYEE, readers: [world(), world(), world()] }), 'bad_type');
  assertRefusal(bad, 'bad_key');
});

test('a refusal is logged as the reason alone', async () => {
  const seen = [];
  const signed = await seller(world()).sign({
    payment: payment(),
    authorization: authorization({ payer: `0x${OTHER_ADDR}` }),
    K,
    alg: 1,
    onRefuse(reason) { seen.push([...arguments]); },
  });
  assertRefusal(signed, 'payer_mismatch');
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], ['payer_mismatch']);
});

test('topic, width, nonce, pin, and signature-field gaps', async () => {
  const short = transferLog(PAYER, PAYEE, PRICE);
  short.data = `0x${padUint(PRICE).slice(2)}`;
  assertRefusal(await seller(world({ logs: [authLog(PAYER, NONCE_A), short] })).sign({
    payment: payment(), authorization: authorization(), K, alg: 1,
  }), 'bad_payment');
  const wrongTransfer = transferLog(PAYER, PAYEE, PRICE);
  wrongTransfer.topics[0] = `0x${'ab'.repeat(32)}`;
  assertRefusal(await seller(world({ logs: [authLog(PAYER, NONCE_A), wrongTransfer] })).sign({
    payment: payment(), authorization: authorization(), K, alg: 1,
  }), 'bad_payment');
  const four = transferLog(PAYER, PAYEE, PRICE);
  four.topics = [...four.topics, `0x${'00'.repeat(32)}`];
  assertRefusal(await seller(world({ logs: [authLog(PAYER, NONCE_A), four] })).sign({
    payment: payment(), authorization: authorization(), K, alg: 1,
  }), 'bad_payment');
  const wrongAuth = authLog(PAYER, NONCE_A);
  wrongAuth.topics[0] = `0x${'cd'.repeat(32)}`;
  assertRefusal(await seller(world({ logs: [wrongAuth, transferLog(PAYER, PAYEE, PRICE)] })).sign({
    payment: payment(), authorization: authorization(), K, alg: 1,
  }), 'nonce_mismatch');
  const foreign = { ...authLog(PAYER, NONCE_A), address: OTHER_ADDR };
  assertRefusal(await seller(world({ logs: [foreign, transferLog(PAYER, PAYEE, PRICE)] })).sign({
    payment: payment(), authorization: authorization(), K, alg: 1,
  }), 'nonce_mismatch');
  assertRefusal(await seller(world()).sign({
    payment: payment({ localLogIndex: '1' }), authorization: authorization(), K, alg: 1,
  }), 'bad_uint');
  assertRefusal(await seller(world()).sign({
    payment: payment({ blockHash: `0X${HASH.toUpperCase()}` }), authorization: authorization(), K, alg: 1,
  }), 'missing_block_hash');
  const zeroAuth = matchAuthorization(
    { ...authorization(), nonce: `0x${'00'.repeat(32)}` },
    { payer: PAYER, authorizer: PAYER, payee: PAYEE, token: TOKEN, price: PRICE, nonce: '00'.repeat(32) },
  );
  assert.equal(zeroAuth.reason, 'nonce_mismatch');
  const zeroSelect = await selectNonce({
    ok: true,
    token: TOKEN,
    payer: PAYER,
    localLogIndex: 1,
    auths: [{ token: TOKEN, authorizer: PAYER, nonce: '00'.repeat(32), logIndex: 0 }],
  }, `0x${'00'.repeat(32)}`);
  assert.equal(zeroSelect.ok, false);
  assert.equal(zeroSelect.reason, 'nonce_mismatch');
});

test('a duplicate authorization releases the payment claim', async () => {
  const logs = [
    authLog(PAYER, NONCE_A),
    transferLog(PAYER, PAYEE, PRICE),
    authLog(PAYER, NONCE_A),
    transferLog(PAYER, PAYEE, 1n),
    authLog(PAYER, NONCE_B),
    transferLog(PAYER, PAYEE, 1n),
  ];
  const held = new Set();
  const claims = [];
  const releases = [];
  const store = {
    claim(id) {
      claims.push(id);
      if (held.has(id)) return false;
      held.add(id);
      return true;
    },
    release(id) {
      releases.push(id);
      held.delete(id);
    },
    has(id) { return held.has(id); },
  };
  const who = seller(world({ logs }), { store });
  assertSigned(await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 }));
  assertRefusal(await who.sign({
    payment: payment({ localLogIndex: 3 }),
    authorization: authorization({ price: '1' }),
    K,
    alg: 1,
  }), 'duplicate_sigma');
  const secondPay = claims.filter((id) => id.startsWith('pay:'))[1];
  assert.equal(store.has(secondPay), false);
  assert.equal(releases.includes(secondPay), true);
  assertSigned(await who.sign({
    payment: payment({ localLogIndex: 5 }),
    authorization: authorization({ price: '1', nonce: `0x${NONCE_B}` }),
    K,
    alg: 1,
  }));
});

test('verifySigma rejects a sigma that is not exactly 64 bytes', async () => {
  const who = seller(world());
  const signed = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  const longer = new Uint8Array(65);
  longer.set(signed.sigma);
  assertRefusal(verifySigma({ digest: signed.digest, sigma: longer, publicKey: who.publicKey }), 'bad_sigma');
});

test('trailing signature bytes and a caller token are refused', async () => {
  const { key, input } = controlInput(HOUR_A);
  const signed = await signPayToControl(input);
  assert.equal(signed.ok, true, signed.reason);
  const trailing = new Uint8Array(signed.signature.length + 1);
  trailing.set(signed.signature);
  assertRefusal(verifyPayToControl({ ...input, signature: trailing }), 'bad_signature');
  const bad = '99'.repeat(20);
  const logs = [
    { ...authLog(PAYER, NONCE_A), address: bad },
    transferLog(PAYER, PAYEE, PRICE, bad),
  ];
  assertRefusal(await seller(world({ logs })).sign({
    payment: payment(),
    authorization: authorization({ token: `0x${bad}` }),
    K,
    alg: 1,
  }), 'token_mismatch');
  assert.equal(keyHash(1, key).hex, eipVector.key_hash);
  assert.notEqual(eipVector.domain_separator_a, eipVector.domain_separator_b);
  assert.equal(eipVector.time_unit, TIME_UNIT);
  assert.equal(eipVector.expiry_allows_admission, true);
  assert.equal(eipVector.expiry_allows_later_hour, false);
  const core = await import('../cs2-core/eip712/index.mjs');
  assert.equal(keyHash, core.keyHash);
  assert.equal(DOMAIN_TYPE, core.DOMAIN_TYPE);
  assert.equal(bytesToHex(keccak256(new TextEncoder().encode(DOMAIN_TYPE))), eipVector.domain_typehash);
  assert.equal(bytesToHex(keccak256(new TextEncoder().encode(PAYTO_CONTROL_TYPE))), eipVector.payto_control_typehash);
  assert.equal(bytesToHex(keccak256(new TextEncoder().encode(REVOKE_TYPE))), eipVector.revoke_typehash);
  assert.equal(bytesToHex(keccak256(new TextEncoder().encode(REVOKE_BY_KEY_TYPE))), eipVector.revoke_by_key_typehash);
});

test('a chain payee or token that is not the pin is refused', async () => {
  const otherPayee = transferLog(PAYER, OTHER_ADDR, PRICE);
  assertRefusal(await seller(world({
    logs: [authLog(PAYER, NONCE_A), otherPayee],
  })).sign({ payment: payment(), authorization: authorization(), K, alg: 1 }), 'payee_mismatch');
  const otherToken = transferLog(PAYER, PAYEE, PRICE, OTHER_ADDR);
  const otherAuth = { ...authLog(PAYER, NONCE_A), address: OTHER_ADDR };
  assertRefusal(await seller(world({
    logs: [otherAuth, otherToken],
  })).sign({ payment: payment(), authorization: authorization(), K, alg: 1 }), 'token_mismatch');
});

test('pin chain filter and a zero pin address are refused', () => {
  assert.equal(contractForHour(
    [{ chainId: 1, address: `0x${CONTRACT_A}`, genesisHourStart: HOUR_A }],
    CHAIN,
    HOUR_A,
  ).reason, 'contract_unpinned');
  assert.equal(contractForHour(
    [{ chainId: CHAIN, address: `0x${'00'.repeat(20)}`, genesisHourStart: HOUR_A }],
    CHAIN,
    HOUR_A,
  ).reason, 'bad_payment');
  assert.equal(contractForHour([
    { chainId: CHAIN, address: `0x${CONTRACT_A}`, genesisHourStart: HOUR_A, retireHour: HOUR_B },
    { chainId: CHAIN, address: `0x${'cc'.repeat(20)}`, genesisHourStart: HOUR_A, retireHour: HOUR_B },
  ], CHAIN, HOUR_A).reason, 'ambiguous_contract');
  const split = [world(), world({ missingHash: true }), world({ number: 51n, head: 50n })];
  return seller(split[0], { readers: split }).sign({
    payment: payment(), authorization: authorization(), K, alg: 1,
  }).then((out) => assertRefusal(out, 'chain_unread'));
});

test('the package does not use the number-only finality helper or log payloads', () => {
  const names = readdirSync(here).filter((name) => name.endsWith('.mjs')
    && name !== 'seller.test.mjs'
    && name !== 'run-mutants.mjs');
  assert.ok(names.includes('sigma.mjs'));
  for (const name of names) {
    const source = readFileSync(join(here, name), 'utf8');
    assert.equal(source.includes('evmFinality'), false, name);
    assert.equal(source.includes('x402-chain'), false, name);
    assert.equal(source.includes('console.'), false, name);
    assert.equal(source.includes('isValidSignature'), false, name);
    assert.equal(source.includes('eth_call'), false, name);
    assert.equal(source.includes('process.env'), false, name);
    if (name !== 'typed-data.mjs') {
      assert.equal(source.includes(`'${DOMAIN_NAME}'`), false, name);
      assert.equal(source.includes(`"${DOMAIN_NAME}"`), false, name);
      assert.equal(source.includes(DOMAIN_TYPE), false, name);
      assert.equal(source.includes(PAYTO_CONTROL_TYPE), false, name);
      assert.equal(source.includes(REVOKE_TYPE), false, name);
      assert.equal(source.includes(REVOKE_BY_KEY_TYPE), false, name);
    }
  }
});

test('sigma is signed on P-256, not secp256k1', async () => {
  const who = seller(world());
  const signed = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  assertSigned(signed);
  const k1 = publicPoint(BigInt(`0x${SELLER_KEY}`), SECP256K1);
  const wrongCurve = verifySigma({ digest: signed.digest, sigma: signed.sigma, publicKey: k1 });
  assert.equal(wrongCurve.ok, false);
  assert.equal(bytesToHex(signed.sigma), sigmaVector.sigma);
  assert.equal(readFileSync(join(here, 'index.mjs'), 'utf8').includes('setNonceHookForTests'), false);
  assert.equal(readFileSync(join(here, 'index.mjs'), 'utf8').includes('signSigma'), false);
  assert.equal(readFileSync(join(here, 'index.mjs'), 'utf8').includes('evmFinality'), false);
  assert.equal(existsSync(join(here, 'nonce-hook.mjs')), false);
});

test('a deep import of an internal module fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chit-exports-'));
  try {
    const nm = join(dir, 'node_modules');
    mkdirSync(nm);
    symlinkSync(here, join(nm, 'chit-seller'));
    symlinkSync(join(here, '../cs2-core'), join(nm, 'cs2-core'));
    const script = `
      const paths = [
        'chit-seller/sigma.mjs',
        'chit-seller/nonce-hook.mjs',
        'chit-seller/eip712.mjs',
        'chit-seller/rfc6979.mjs',
        'cs2-core/eip712/key-hash.mjs',
        'cs2-core/eip712/registry.mjs',
      ];
      let failed = 0;
      for (const spec of paths) {
        try {
          await import(spec);
        } catch (err) {
          if (err && (err.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || err.code === 'ERR_MODULE_NOT_FOUND')) failed += 1;
          else throw err;
        }
      }
      if (failed !== paths.length) process.exit(1);
      await import('chit-seller');
      await import('cs2-core/eip712');
    `;
    writeFileSync(join(dir, 'probe.mjs'), script);
    const run = spawnSync(process.execPath, ['probe.mjs'], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an async store signs one sigma and a failed claim is a refusal', async () => {
  const held = new Set();
  const asyncStore = {
    async claim(id) {
      if (held.has(id)) return false;
      held.add(id);
      return true;
    },
    async release(id) { held.delete(id); },
    async has(id) { return held.has(id); },
  };
  const who = seller(world(), { store: asyncStore });
  const req = { payment: payment(), authorization: authorization(), K, alg: 1 };
  assertSigned(await who.sign(req));
  assertRefusal(await who.sign(req), 'duplicate_sigma');
  const { input } = controlInput(HOUR_A);
  const refusing = {
    claim() { return Promise.resolve(false); },
    release() { return Promise.resolve(); },
    has() { return Promise.resolve(false); },
  };
  const hashed = keyHash(1, input.key);
  assertRefusal(await signRevokeByKey({
    chainId: CHAIN,
    hourStart: HOUR_A,
    keyHash: hashed.bytes,
    key: input.key,
    keyAlg: 1,
    privateKey: input.keyPrivateKey,
    store: refusing,
  }), 'bad_payment');
  const truthy = {
    async claim() { return 'yes'; },
    async release() {},
    async has() { return false; },
  };
  const yes = await seller(world(), { store: truthy }).sign(req);
  assertRefusal(yes, 'duplicate_sigma');
  const thrower = {
    async claim() { throw new Error('db down'); },
    async release() {},
    async has() { return false; },
  };
  const thrown = await seller(world(), { store: thrower }).sign(req);
  assertRefusal(thrown, 'duplicate_sigma');
  assert.equal(JSON.stringify(thrown).includes('db down'), false);
});

test('a third party cannot tombstone a key', async () => {
  const { key, input } = controlInput(HOUR_A);
  const victim = keyHash(1, key);
  const attackerKey = k1Compressed(0xbadn);
  assertRefusal(await signRevokeByKey({
    chainId: CHAIN,
    hourStart: HOUR_A,
    keyHash: victim.bytes,
    key: attackerKey,
    keyAlg: 1,
    privateKey: input.keyPrivateKey,
  }), 'bad_key');
  assertRefusal(await signRevokeByKey({
    chainId: CHAIN,
    hourStart: HOUR_A,
    keyHash: victim.bytes,
    key: attackerKey,
    keyAlg: 1,
    privateKey: 0xbadn,
  }), 'bad_payment');
  const digest = hashChit('RevokeByKey', { keyHash: victim.bytes }, BigInt(CHAIN), CONTRACT_A);
  assert.equal(digest.ok, true);
  const forged = signRawDigest(possessionPreimage(digest.bytes), 0xbadn, 12345n, P256);
  assertRefusal(verifyRevokeByKey({
    chainId: CHAIN,
    hourStart: HOUR_A,
    keyHash: victim.bytes,
    key,
    keyAlg: 1,
    signature: forged.raw,
  }), 'bad_signature');
  assertRefusal(verifyRevokeByKey({
    chainId: CHAIN,
    hourStart: HOUR_A,
    keyHash: victim.bytes,
    key: attackerKey,
    keyAlg: 1,
    signature: forged.raw,
  }), 'bad_signature');
  const own = await signRevokeByKey({
    chainId: CHAIN,
    hourStart: HOUR_A,
    keyHash: victim.bytes,
    key,
    keyAlg: 1,
    privateKey: input.keyPrivateKey,
  });
  assert.equal(own.ok, true, own.reason);
  assert.equal(verifyRevokeByKey({
    chainId: CHAIN,
    hourStart: HOUR_A,
    keyHash: victim.bytes,
    key,
    keyAlg: 1,
    signature: own.signature,
  }).ok, true);
  assertRefusal(verifyRevokeByKey({
    chainId: CHAIN,
    hourStart: HOUR_A,
    keyHash: victim.bytes,
    key,
    signature: own.signature,
  }), 'bad_alg');
});

test('off-curve keys and tombstones are refused, and the same key may bind a second payTo', async () => {
  const { key, input } = controlInput(HOUR_A);
  const off = new Uint8Array(33);
  off[0] = 2;
  off[32] = 1;
  assert.equal(canonicalKey(1, off).reason, 'bad_key');
  assertRefusal(await signPayToControl({ ...input, key: off, store: createMemoryStore() }), 'bad_key');
  const hashed = keyHash(1, key);
  assertRefusal(await signPayToControl({
    ...input,
    tombstones: [hashed.bytes],
    store: createMemoryStore(),
  }), 'bad_payment');
  const held = createMemoryStore();
  const first = await signPayToControl({ ...input, store: held });
  assert.equal(first.ok, true, first.reason);
  const renewed = await signPayToControl({ ...input, store: held, expiry: EXPIRY + 3600n });
  assert.equal(renewed.ok, true, renewed.reason);
  const otherKey = k1Compressed(9n);
  assertRefusal(await signPayToControl({
    ...input,
    store: held,
    key: otherKey,
    keyPrivateKey: 9n,
  }), 'bad_payment');
  assertRefusal(await signPayToControl({
    ...input, store: held, payTo: `0x${'12'.repeat(20)}`,
  }), 'bad_payment');
  assert.equal((await signPayToControl({
    ...input, store: held, operatorOverride: true, payTo: `0x${'12'.repeat(20)}`,
  })).ok, true);
  const second = await signPayToControl({ ...input, store: createMemoryStore() });
  assert.equal(second.ok, true, second.reason);
  assert.equal(verifyPayToControl({ ...input, signature: second.signature }).ok, true);
  assertRefusal(verifyPayToControl({
    ...input,
    signature: second.signature.subarray(0, SIGNATURE_LENGTH_PREFIX_BYTES + EOA_SIGNATURE_BYTES),
  }), 'bad_signature');
  const other = k1Compressed(3n);
  const wrong = new Uint8Array(second.signature);
  const otherSigned = await signPayToControl({
    ...input,
    key: other,
    keyPrivateKey: 3n,
    store: createMemoryStore(),
  });
  assert.equal(otherSigned.ok, true, otherSigned.reason);
  wrong.set(otherSigned.signature.subarray(SIGNATURE_LENGTH_PREFIX_BYTES + EOA_SIGNATURE_BYTES), SIGNATURE_LENGTH_PREFIX_BYTES + EOA_SIGNATURE_BYTES);
  assertRefusal(verifyPayToControl({ ...input, signature: wrong }), 'bad_signature');
  assertRefusal(await signPayToControl({ ...input, key: other, store: createMemoryStore() }), 'bad_key');
  const tomb = {
    claim() { return true; },
    release() {},
    has(id) { return id.startsWith('tomb:'); },
  };
  assertRefusal(await signPayToControl({ ...input, store: tomb }), 'bad_payment');
  assertRefusal(await signPayToControl({ ...input, keyAlg: 2, key: new Uint8Array(65), store: createMemoryStore() }), 'bad_alg');
  const prefixed = new Uint8Array(key);
  prefixed[0] = 4;
  assertRefusal(await signPayToControl({ ...input, key: prefixed, expiry: 'x', store: createMemoryStore() }), 'bad_length');
  assertRefusal(await signPayToControl({ ...input, key: prefixed, expiry: HOUR_A, store: createMemoryStore() }), 'bad_length');
});

test('quorum counts distinct readers and pairs an AuthorizationUsed with its Transfer', async () => {
  const one = world();
  const same = createSeller({
    privateKey: SELLER_KEY,
    store: createMemoryStore(),
    token: TOKEN,
    payee: PAYEE,
    readers: [one, one, one],
  });
  assertRefusal(await same.sign({ payment: payment(), authorization: authorization(), K, alg: 1 }), 'chain_unread');
  const pair = await readAgreedPayment([world(), world()], payment());
  assert.equal(pair.reason, 'chain_unread');
  const four = authLog(PAYER, NONCE_A);
  four.topics = [...four.topics, `0x${'00'.repeat(32)}`];
  assertRefusal(await seller(world({ logs: [four, transferLog(PAYER, PAYEE, PRICE)] })).sign({
    payment: payment(), authorization: authorization(), K, alg: 1,
  }), 'nonce_mismatch');
  const distant = [authLog(PAYER, NONCE_A), transferLog(PAYER, OTHER_ADDR, 5n), transferLog(PAYER, PAYEE, PRICE)];
  assertRefusal(await seller(world({ logs: distant })).sign({
    payment: payment({ localLogIndex: 2 }), authorization: authorization(), K, alg: 1,
  }), 'nonce_mismatch');
  const cheap = world({ logs: [authLog(PAYER, NONCE_A), transferLog(PAYER, PAYEE, PRICE - 1n)] });
  const dear = world({ logs: [authLog(PAYER, NONCE_A), transferLog(PAYER, PAYEE, PRICE)] });
  const quiet = world({ missingHash: true });
  assert.equal((await readAgreedPayment([cheap, dear, quiet], payment())).reason, 'chain_unread');
  const otherNonce = world({ logs: [authLog(PAYER, NONCE_B), transferLog(PAYER, PAYEE, PRICE)] });
  assert.equal((await readAgreedPayment([dear, otherNonce, quiet], payment())).reason, 'chain_unread');
  assertRefusal(await seller(world({
    logs: [authLog(PAYER, NONCE_A), transferLog(PAYER, OTHER_ADDR, PRICE)],
  })).sign({
    payment: payment(),
    authorization: authorization({ payee: `0x${OTHER_ADDR}` }),
    K,
    alg: 1,
  }), 'payee_mismatch');
  assert.equal(productionPinList(), null);
  assert.equal(contractForHour([{
    chainId: CHAIN,
    address: `0x${'aa'.repeat(20)}`,
    genesisHourStart: HOUR_A,
  }], CHAIN, HOUR_A).reason, 'bad_payment');
  assertRefusal(createSeller({
    privateKey: SELLER_KEY, store: createMemoryStore(), token: TOKEN, payee: PAYEE, readers: readersOf(world()), k: 7n,
  }), 'bad_key');
  assertRefusal(await seller(world()).sign({
    payment: payment(), authorization: authorization(), K, alg: 1, k: 7n,
  }), 'bad_key');
  const { input } = controlInput(HOUR_A);
  assertRefusal(await signPayToControl({ ...input, k: 7n }), 'bad_key');
  assertRefusal(await signPayToControl({ ...input, digest: new Uint8Array(32) }), 'bad_payment');
  const pop = JSON.parse(readFileSync(join(here, '../cs2-core/eip712/vectors/pop.json'), 'utf8'));
  const popKey = hexToBytes(pop.key);
  assertRefusal(await signPayToControl({
    ...input,
    key: popKey,
    keyPrivateKey: BigInt(`0x${pop.scalar}`),
    store: createMemoryStore(),
  }), 'bad_key');
  assertRefusal(createSeller({
    privateKey: pop.scalar,
    store: createMemoryStore(),
    token: TOKEN,
    payee: PAYEE,
    readers: readersOf(world()),
  }), 'bad_key');
  const prefixed = encodeSignatureField(new Uint8Array(64));
  assert.equal(prefixed[0], 0);
  assert.equal(prefixed[1], 64);
  setTestPinSigning(false);
  assert.equal((await signPayToControl({ ...input, store: createMemoryStore() })).ok, false);
  setTestPinSigning(true);
  const shared = createMemoryStore();
  const { input: bound } = controlInput(HOUR_A);
  assert.equal((await signPayToControl({ ...bound, store: shared })).ok, true);
  assertRefusal(await signPayToControl({ ...bound, store: shared, chainId: 11155111 }), 'bad_payment');
  const noScalar = { ...controlInput(HOUR_A).input };
  delete noScalar.keyPrivateKey;
  assertRefusal(await signPayToControl({ ...noScalar, store: createMemoryStore() }), 'bad_key');
  const tombThrow = {
    async has(id) {
      if (String(id).startsWith('tomb:')) throw new Error('tomb down');
      return false;
    },
    async claim() { return true; },
    async release() {},
  };
  assertRefusal(await signPayToControl({ ...bound, store: tombThrow }), 'bad_payment');
  const yesClaim = {
    async has() { return false; },
    async claim() { return 'yes'; },
    async release() {},
  };
  assertRefusal(await signPayToControl({ ...bound, store: yesClaim }), 'bad_payment');
  const core = await import('../cs2-core/eip712/index.mjs');
  assert.deepEqual(ALG_REGISTRY, core.ALG_REGISTRY);
  assert.equal(KEY_ALG_P256, 0x01);
  assert.equal(KEY_ALG_SECP256K1, 0x02);
  assert.equal('signSigma' in (await import('./index.mjs')), false);
});

test('H1 a live key renews, a revoke rotates, and a revoked key stays dead', async () => {
  const store = createMemoryStore();
  const k1 = BigInt(`0x${eipVector.slot_scalar}`);
  const pay = (scalar, extra = {}) => {
    const { input } = controlInput(HOUR_A);
    return {
      ...input,
      key: k1Compressed(scalar),
      keyPrivateKey: scalar,
      store,
      ...extra,
    };
  };
  const other = `0x${'77'.repeat(20)}`;
  const third = `0x${'79'.repeat(20)}`;
  const fresh = `0x${'13'.repeat(20)}`;
  assert.equal((await signPayToControl(pay(k1))).ok, true);
  assert.equal((await signPayToControl(pay(k1, { expiry: EXPIRY + 3600n }))).ok, true);
  assertRefusal(await signPayToControl(pay(k1 + 1n)), 'bad_payment');
  assertRefusal(await signPayToControl(pay(k1, { payTo: other })), 'bad_payment');
  assert.equal((await signPayToControl(pay(k1, { payTo: other, operatorOverride: true }))).ok, true);
  assert.equal((await signPayToControl(pay(k1 + 2n, { payTo: third }))).ok, true);
  const hash = keyHash(1, k1Compressed(k1));
  const revoked = await signRevoke({
    chainId: CHAIN,
    hourStart: HOUR_A,
    payTo: eipVector.payTo,
    keyHash: hash.bytes,
    privateKey: BigInt(`0x${eipVector.test_key}`),
    store,
  });
  assert.equal(revoked.ok, true, revoked.reason);
  assert.equal((await signPayToControl(pay(k1 + 1n))).ok, true);
  assertRefusal(await signPayToControl(pay(k1)), 'bad_payment');
  assertRefusal(await signPayToControl(pay(k1, { payTo: fresh })), 'bad_payment');
  const tomb = await signRevokeByKey({
    chainId: CHAIN,
    hourStart: HOUR_A,
    keyHash: hash.bytes,
    key: k1Compressed(k1),
    keyAlg: 1,
    privateKey: k1,
    store,
  });
  assert.equal(tomb.ok, true, tomb.reason);
  assert.equal((await signPayToControl(pay(k1 + 3n, { payTo: fresh }))).ok, true);
  assertRefusal(await signPayToControl(pay(k1, { payTo: fresh, operatorOverride: true })), 'bad_payment');
});

test('H2 a failed claim releases the ids already taken', async () => {
  const held = new Set();
  const failing = {
    has: (id) => held.has(id),
    claim: (id) => {
      if (String(id).startsWith('open:')) return false;
      if (held.has(id)) return false;
      held.add(id);
      return true;
    },
    release: (id) => { held.delete(id); },
  };
  const { input } = controlInput(HOUR_A);
  assertRefusal(await signPayToControl({ ...input, store: failing }), 'bad_payment');
  assert.equal(held.size, 0);
});

test('H4 the key scalar is required and distinct from the payTo scalar', async () => {
  const { input } = controlInput(HOUR_A);
  const missing = { ...input, store: createMemoryStore() };
  delete missing.keyPrivateKey;
  assertRefusal(await signPayToControl(missing), 'bad_key');
  const scalar = 9n;
  assertRefusal(await signPayToControl({
    ...input,
    key: k1Compressed(scalar),
    privateKey: scalar,
    keyPrivateKey: scalar,
    store: createMemoryStore(),
  }), 'bad_key');
});
