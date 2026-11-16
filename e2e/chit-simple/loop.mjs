/**
 * One local loop: EIP-3009 payment, core line, seal, anchor, fetch, verify.
 * Testnet dummy data. The signer is the public Hardhat development key.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bytesToHex } from '../../packages/cs2-core/ecdsa/bytes.js';
import { SECP256K1, eip1559Digest, eip1559Serialize, eip1559TxHash, ethereumAddress } from '../../packages/cs2-core/ecdsa/index.js';
import { publicPoint, signRawDigest } from '../../packages/cs2-core/ecdsa/sign.js';
import { LAYOUT, encodeLine } from '../../packages/cs2-core/line/index.mjs';
import { SAMPLE } from '../../packages/cs2-core/line/sample.mjs';
import { deriveKeyPair } from '../../packages/cs2-core/seal/hpke.js';
import { closeHour, openSealer } from '../../services/chit-sealer/close.js';
import { buildAnchorCalldata } from '../../services/chit-sealer/calldata.js';
import { fetchReceipt, noteAnchored, openStore } from '../../services/chit-store/store.js';
import { checkReceiptInput } from '../../packages/verify/dist/check-input.js';
import { CHAIN_ID, USDC, deployAnchor, installUsdc, rpc, startChain } from './chain.mjs';
import { makeSnapshot } from './snapshot.mjs';

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const AUTH = '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5';
const HOUR = 3600;
const FEES = { gasLimit: '800000', maxFeePerGas: '2000000000', maxPriorityFeePerGas: '1000000000' };
/** Well-known Hardhat account 1. A public development key, not a secret. */
const CHECKPOINT_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const DEV_SCALAR = BigInt(CHECKPOINT_KEY);

function devSigner(address) {
  return {
    address,
    feeCeiling: '100000000000000',
    async signEip1559(tx) {
      const digest = eip1559Digest(tx);
      for (let k = 3n; k < 80n; k += 1n) {
        try {
          const sig = signRawDigest(digest, DEV_SCALAR, k, SECP256K1);
          const raw = eip1559Serialize(tx, sig);
          return { raw, hash: eip1559TxHash(raw), yParity: sig.yParity };
        } catch { /* next dev nonce */ }
      }
      throw new Error('dev signer could not sign');
    },
  };
}

export function coreLine(payment) {
  const encoded = encodeLine({
    payment,
    content: { ...SAMPLE.content, sellerKeyId: '00'.repeat(32) },
    sigma: { alg: 1, sigma: `${'00'.repeat(31)}01${'00'.repeat(31)}01` },
  });
  if (!encoded.ok) throw new Error(encoded.reason);
  const line = new Uint8Array(encoded.line);
  line.fill(0, LAYOUT.sigma, LAYOUT.sigma + LAYOUT.sigmaBytes);
  return line;
}

async function sendRaw(provider, wire) {
  void provider;
  const raw = wire.startsWith('0x') ? wire : `0x${wire}`;
  const hash = await rpc('eth_sendRawTransaction', [raw]);
  const start = Date.now();
  let rec = null;
  while (Date.now() - start < 15000) {
    rec = await rpc('eth_getTransactionReceipt', [hash]);
    if (rec) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!rec || rec.status !== '0x1') throw new Error('execution reverted');
  return hash;
}

export function observe(store, event, expect) {
  if (Number(event.chainId) !== expect.chainId) return { ok: true, released: false };
  if (String(event.contract).toLowerCase() !== expect.contract) return { ok: true, released: false };
  if (String(event.from).toLowerCase() !== expect.checkpoint) return { ok: true, released: false };
  return noteAnchored(store, { ...event, finalized: true });
}

export async function openLoop() {
  const chain = await startChain();
  const address = ethereumAddress(publicPoint(DEV_SCALAR, SECP256K1));
  if (address.toLowerCase() !== '0x70997970c51812dc3a010c7d01b50e0d17dc79c8') {
    throw new Error('dev key address does not match the Hardhat account');
  }
  const anchor = await deployAnchor(chain.wallet, address);
  const usdc = await installUsdc(chain.wallet);
  const latest = await rpc('eth_getBlockByNumber', ['latest', false]);
  const firstHour = Math.ceil((Number(latest.timestamp) + 10) / HOUR) * HOUR;
  const derived = deriveKeyPair(Uint8Array.of(7, 7, 7, 7));
  if (!derived.ok) throw new Error(derived.reason);
  const root = mkdtempSync(join(tmpdir(), 'chit-loop-'));
  const storeDir = join(root, 'store');
  const sealerDir = join(root, 'sealer');
  mkdirSync(storeDir);
  mkdirSync(sealerDir);
  const book = {
    id: 'aa'.repeat(32),
    token: 'book-token',
    bookPk: derived.pk,
    wallets: [chain.wallet.address],
  };
  const store = openStore(storeDir, { books: [book] });
  const clock = { now: firstHour + HOUR + 20 };
  const sealer = openSealer({
    dir: sealerDir,
    store,
    signer: devSigner(address),
    chainId: CHAIN_ID,
    contract: anchor.address,
    clock: () => clock.now,
  });
  const pin = {
    chainId: CHAIN_ID,
    address: anchor.address,
    codeHash: anchor.codeHash,
    predecessor: `0x${'00'.repeat(20)}`,
    checkpoint: address.toLowerCase(),
    genesisHourStart: firstHour,
    retireHourStart: null,
  };
  const snapshot = makeSnapshot(pin);
  return {
    chain, anchor, usdc, store, sealer, clock, book, firstHour, snapshot, address,
    async stop() { await chain.stop(); },
  };
}

async function mineAt(loop, atLeast) {
  const latest = await rpc('eth_getBlockByNumber', ['latest', false]);
  const next = Math.max(atLeast, Number(latest.timestamp) + 1);
  loop.clock.now = Math.max(loop.clock.now, next);
  await rpc('evm_setNextBlockTimestamp', [next]);
  return next;
}

export async function pay(loop, nonce = bytesToHex(loop.sealer.randomBytes(32))) {
  const payer = loop.chain.wallet.address;
  const next = async () => Number(await rpc('eth_getTransactionCount', [payer, 'latest']));
  await mineAt(loop, loop.clock.now);
  await (await loop.usdc.mint(payer, 5_000_000n, { nonce: await next() })).wait();
  await mineAt(loop, loop.clock.now + 1);
  const tx = await loop.usdc.transferWithAuthorization(
    loop.chain.wallet.address,
    `0x${'11'.repeat(20)}`,
    1_000_000n,
    0,
    2n ** 64n - 1n,
    `0x${nonce}`,
    0,
    `0x${'00'.repeat(32)}`,
    `0x${'00'.repeat(32)}`,
    { nonce: await next() },
  );
  const rec = await tx.wait(1, 20);
  const block = await rpc('eth_getBlockByHash', [rec.blockHash, false]);
  const transfer = rec.logs.find((log) => log.topics[0].toLowerCase() === TRANSFER && log.address.toLowerCase() === USDC);
  return {
    chainId: CHAIN_ID,
    blockHash: rec.blockHash.slice(2),
    blockNumber: Number(rec.blockNumber),
    blockTime: Number(block.timestamp),
    txIndex: Number(rec.index),
    localLogIndex: Number(transfer.index),
    txHash: rec.hash.slice(2),
    token: USDC.slice(2),
    from: loop.chain.wallet.address.slice(2).toLowerCase(),
    to: '11'.repeat(20),
    value: '1000000',
    method: 1,
    authorizer: loop.chain.wallet.address.slice(2).toLowerCase(),
    nonce,
    saltP: bytesToHex(loop.sealer.randomBytes(32)),
  };
}

export async function sealHour(loop, hourStart, lines) {
  const started = Date.now();
  await mineAt(loop, Math.max(loop.clock.now, hourStart + HOUR));
  const closed = await closeHour(loop.sealer, {
    hourStart,
    lines,
    fees: FEES,
    send: (wire) => sendRaw(loop.chain.provider, wire),
  });
  return { ...closed, elapsedMs: Date.now() - started };
}

export function release(loop, record) {
  return observe(loop.store, {
    epoch: record.epoch,
    hourStart: record.hourStart,
    size: record.size,
    root: record.root,
    stateRoot: record.stateRoot,
    chainId: CHAIN_ID,
    contract: loop.anchor.address,
    from: loop.address,
  }, {
    chainId: CHAIN_ID,
    contract: loop.anchor.address,
    checkpoint: loop.address.toLowerCase(),
  });
}

export function receiptOf(body, contract) {
  return {
    v: 13,
    schema: 'chit402.cs2.receipt.v1',
    line: body.line.startsWith('0x') ? body.line : `0x${body.line}`,
    index: body.index,
    epoch: body.epoch,
    contract,
    proof: body.proof,
    slotKey: body.slotKey,
    slotValue: body.slotValue,
    slotProof: body.slotProof,
    paymentProof: body.paymentProof,
    saltedBook: body.saltedBook,
  };
}

export async function verifyBody(loop, body) {
  const receipt = receiptOf(body, loop.anchor.address);
  const outcome = await checkReceiptInput(JSON.stringify(receipt), loop.snapshot.options(loop.chain.urls));
  return {
    exit: outcome.verdict.exit_code,
    reason: outcome.verdict.reason,
    message: outcome.verdict.message,
  };
}

export async function runOnce() {
  const loop = await openLoop();
  try {
    const payment = await pay(loop);
    const line = coreLine(payment);
    const closed = await sealHour(loop, loop.firstHour, [{ line, bookId: loop.book.id, bookPk: new Uint8Array(32).fill(9) }]);
    if (!closed.ok) throw new Error(closed.reason || 'close failed');
    const noted = release(loop, closed.record);
    if (!noted.released) throw new Error('anchor was not released');
    const id = loop.sealer.state.commits.at(-1).receipts[0].id;
    const fetched = fetchReceipt(loop.store, { receiptId: id, bookId: loop.book.id, token: loop.book.token });
    if (!fetched.ok) throw new Error(`fetch ${fetched.status}`);
    const verdict = await verifyBody(loop, fetched.body);
    return { verdict, elapsedMs: closed.elapsedMs, hourStart: loop.firstHour, contract: loop.anchor.address };
  } finally {
    await loop.stop();
  }
}

export async function unfinishedReverts(loop) {
  const future = loop.firstHour + HOUR;
  const built = buildAnchorCalldata({
    chainId: CHAIN_ID,
    contract: loop.anchor.address,
    epoch: 1,
    hourStart: future,
    size: 1,
    root: '11'.repeat(32),
    stateRoot: '22'.repeat(32),
    proof: [],
  });
  const domain = await loop.anchor.contract.domain();
  let reverted = '';
  try {
    await loop.anchor.contract.anchor(
      domain,
      1,
      future,
      1,
      `0x${'11'.repeat(32)}`,
      `0x${'22'.repeat(32)}`,
      [],
    );
  } catch (err) {
    reverted = `${err.shortMessage || ''} ${err.message || err}`;
  }
  void built;
  return reverted.includes('HourNotFinished');
}
