/**
 * Seller sigma signer. Keys in this file are test keys only.
 * The chain is a fake reader. Nothing here contacts a network.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keccak256 } from '../cs2-core/ecdsa/keccak.js';
import { bigToBytes, bytesToBig, bytesToHex, hexToBytes } from '../cs2-core/ecdsa/bytes.js';
import { P256, SECP256K1 } from '../cs2-core/ecdsa/curves.js';
import { publicPoint, signRawDigest } from '../cs2-core/ecdsa/sign.js';
import { sigmaDigest } from '../cs2-core/line/index.mjs';
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
  REVOKE_BY_KEY_TYPE,
  REVOKE_TYPE,
  revokeRecordId,
  sellerKeyHash,
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
const eipVector = JSON.parse(readFileSync(join(here, 'vectors/eip712.json'), 'utf8'));

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
    transferLog(PAYER, PAYEE, 1n),
    transferLog(PAYER, PAYEE, PRICE),
    authLog(PAYER, NONCE_A),
    authLog(PAYER, NONCE_B),
  ];
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
  return createSeller({ privateKey: SELLER_KEY, reader, k: SIGMA_K, ...extra });
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
  assert.deepEqual(reader.calls.map((call) => (Array.isArray(call) ? call[0] : call)), [
    'chainId', 'hash', 'number', 'number', 'receipt',
  ]);
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
      transferLog(PAYER, PAYEE, 1n),
      transferLog(PAYER, PAYEE, PRICE + 1n),
      authLog(PAYER, NONCE_A),
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
      transferLog(PAYER, PAYEE, 1n),
      transferLog(PAYER, PAYEE, PRICE - 1n),
      authLog(PAYER, NONCE_A),
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
  const signed = await seller(world()).sign({
    payment: payment(),
    authorization: authorization({ nonce: `0x${'00'.repeat(32)}` }),
    K,
    alg: 1,
  });
  assertRefusal(signed, 'nonce_mismatch');
});

test('the second AuthorizationUsed nonce in the settle still matches', async () => {
  const signed = await seller(world()).sign({
    payment: payment(),
    authorization: authorization({ nonce: `0x${NONCE_B}` }),
    K,
    alg: 1,
  });
  assertSigned(signed);
});

test('a transfer from a different address produces no sigma', async () => {
  const reader = world({
    logs: [
      transferLog(OTHER_ADDR, PAYEE, 1n),
      transferLog(OTHER_ADDR, PAYEE, PRICE),
      authLog(PAYER, NONCE_A),
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
      transferLog(PAYER, PAYEE, 1n),
      transferLog(PAYER, PAYEE, PRICE),
      authLog(OTHER_ADDR, NONCE_A),
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
  assertRefusal(second, 'duplicate_sigma');
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
  const who = seller(world());
  const first = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  assertSigned(first);
  const second = await who.sign({
    payment: payment({ localLogIndex: 0 }),
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
    payment: payment({ localLogIndex: 0 }),
    authorization: authorization({ price: '1', nonce: `0x${NONCE_A}` }),
    K,
    alg: 1,
  });
  assertSigned(first);
  const second = await who.sign({
    payment: payment({ localLogIndex: 1 }),
    authorization: authorization({ price: PRICE.toString(), nonce: `0x${NONCE_B}` }),
    K,
    alg: 1,
  });
  assertSigned(second);
  assert.notEqual(first.paymentId, second.paymentId);
  const wrongValue = await seller(world()).sign({
    payment: payment({ localLogIndex: 0 }),
    authorization: authorization({ price: PRICE.toString(), nonce: `0x${NONCE_A}` }),
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

test('a random nonce still verifies on P-256', async () => {
  const who = createSeller({ privateKey: SELLER_KEY, reader: world() });
  const signed = await who.sign({ payment: payment(), authorization: authorization(), K, alg: 1 });
  assertSigned(signed);
  assert.equal(verifySigma({
    digest: signed.digest,
    sigma: signed.sigma,
    publicKey: who.publicKey,
  }).ok, true);
  assert.notEqual(bytesToHex(signed.sigma), sigmaVector.sigma);
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

function controlInput(hourStart, extra = {}) {
  const who = createSeller({ privateKey: SELLER_KEY, reader: world(), k: SIGMA_K });
  return {
    who,
    input: {
      chainId: CHAIN,
      payTo: eipVector.payTo,
      keyAlg: 1,
      key: who.compressedKey,
      expiry: EXPIRY,
      hourStart,
      pinnedContracts: pins(),
      privateKey: BigInt(`0x${eipVector.test_key}`),
      k: BigInt(`0x${eipVector.test_nonce_k}`),
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
  const override = payToControlDigest({
    ...first.input,
    verifyingContract: `0x${CONTRACT_B}`,
  });
  assert.equal(override.hex, digestA.hex);
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

test('PayToControl signs under the pinned contract for the hour and verifies there', () => {
  const { who, input } = controlInput(HOUR_A);
  assert.equal(bytesToHex(who.compressedKey), eipVector.key);
  const signed = signPayToControl(input);
  assert.equal(signed.ok, true, signed.reason);
  assert.equal(bytesToHex(signed.digest), eipVector.digest_a);
  assert.equal(bytesToHex(signed.signature), eipVector.signature_a);
  assert.equal(signed.signature.length, SIGNATURE_LENGTH_PREFIX_BYTES + EOA_SIGNATURE_BYTES);
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

test('a PayToControl signature rejects a tamper, high-S, a legacy y byte, and a bad alg', () => {
  const { who, input } = controlInput(HOUR_A);
  const signed = signPayToControl(input);
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
  assertRefusal(signPayToControl({ ...input, keyAlg: 2 }), 'bad_alg');
  assertRefusal(signPayToControl({ ...input, payTo: `0x${'00'.repeat(20)}` }), 'bad_payment');
  assertRefusal(signPayToControl({ ...input, key: who.publicKey }), 'bad_length');
  assertRefusal(signPayToControl({ ...input, hourStart: HOUR_A + 1n }), 'bad_hour');
  assertRefusal(signPayToControl({ ...input, hourStart: HOUR_A - 7200n }), 'contract_unpinned');
  assertRefusal(signPayToControl({
    ...input,
    pinnedContracts: [
      pins()[0],
      { chainId: CHAIN, address: `0x${'cc'.repeat(20)}`, genesisHourStart: HOUR_A, retireHour: HOUR_B },
    ],
  }), 'ambiguous_contract');
});

test('revoke is signed by the payTo and its id is slot plus keyHash', () => {
  const { who, input } = controlInput(HOUR_A);
  const keyHash = sellerKeyHash(who.compressedKey);
  const revoke = signRevoke({
    ...input,
    keyHash,
    k: 3n,
  });
  assert.equal(revoke.ok, true, revoke.reason);
  assert.equal(revoke.record.domain.verifyingContract, `0x${CONTRACT_A}`);
  assert.equal(Object.hasOwn(revoke.record.message, 'revokedAt'), false);
  assert.equal(verifyRevoke({ ...input, keyHash, signature: revoke.signature }).ok, true);
  const slot = '03'.repeat(32);
  const id = revokeRecordId(slot, keyHash);
  assert.equal(id.ok, true);
  assert.equal(id.hex, revokeRecordId(slot, keyHash).hex);
  assert.notEqual(id.hex, revokeRecordId(slot, '04'.repeat(32)).hex);
  assert.equal(id.bytes.length, 64);
  const byKey = signRevokeByKey({
    chainId: CHAIN,
    keyHash,
    hourStart: HOUR_A,
    pinnedContracts: pins(),
    privateKey: SELLER_KEY,
    k: 4n,
  });
  assert.equal(byKey.ok, true, byKey.reason);
  const yParity = byKey.signature[SIGNATURE_LENGTH_PREFIX_BYTES + EOA_SIGNATURE_BYTES - 1];
  assert.ok(yParity === 0 || yParity === 1);
  assert.equal(verifyRevokeByKey({
    chainId: CHAIN,
    keyHash,
    hourStart: HOUR_A,
    pinnedContracts: pins(),
    signature: byKey.signature,
    publicKey: who.publicKey,
  }).ok, true);
  assertRefusal(verifyRevokeByKey({
    chainId: CHAIN,
    keyHash: `0x${'04'.repeat(32)}`,
    hourStart: HOUR_A,
    pinnedContracts: pins(),
    signature: byKey.signature,
    publicKey: who.publicKey,
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
  const who = createSeller({ privateKey: SELLER_KEY, reader, k: SIGMA_K });
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
  const viaRpc = await createSeller({ privateKey: SELLER_KEY, reader: rpc, k: SIGMA_K }).sign({
    payment: payment(),
    authorization: authorization(),
    K,
    alg: 1,
  });
  assertRefusal(viaRpc, 'chain_unread');
});

test('createSeller does not expose the private key', () => {
  const who = createSeller({ privateKey: SELLER_KEY, reader: world(), k: SIGMA_K });
  assert.equal(Object.hasOwn(who, 'privateKey'), false);
  assert.equal(JSON.stringify(who).includes(SELLER_KEY), false);
  assert.equal(who.publicKey.length, 65);
  assert.equal(who.compressedKey.length, 33);
  const bad = createSeller({ privateKey: 0n, reader: world() });
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
  const digest = hexToBytes(sigmaVector.digest);
  const again = signRawDigest(digest, BigInt(`0x${SELLER_KEY}`), SIGMA_K, P256);
  assert.equal(bytesToHex(again.raw), sigmaVector.sigma);
});
