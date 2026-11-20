/**
 * Local chain proof. Testnet dummy data. The signer is a public Hardhat key.
 * One node, two proxies. Ports differ, so the verifier treats them as two RPCs.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { SECP256K1, ethereumAddress } from '../../../packages/cs2-core/ecdsa/index.js';
import { publicPoint } from '../../../packages/cs2-core/ecdsa/sign.js';
import { checkReceiptInput } from '../../../packages/verify/dist/check-input.js';
import { PAYMENT_SLOT_MISSING, treeSizeFromHead } from '../../../packages/verify/dist/v13/core/decide.js';
import { buildAnchorCalldata } from '../../../services/chit-sealer/calldata.js';
import { recover } from '../../../services/chit-sealer/close.js';
import { fetchReceipt } from '../../../services/chit-store/store.js';
import { CHAIN_ID, deployAnchor, rpc } from '../chain.mjs';
import {
  coreLine,
  listenAnchored,
  openLoop,
  pay,
  sealHour,
  sendFrom,
  verifyBody,
} from '../loop.mjs';

/** Well-known Hardhat account 2. A public development key, not a secret. */
const ACCOUNT2 = ethereumAddress(publicPoint(0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365an, SECP256K1));

const HOUR = 3600;
const TABLE = join(import.meta.dirname, '..', 'tamper-matrix.json');

function flip(hex, byteIndex) {
  const prefixed = hex.startsWith('0x');
  const body = prefixed ? hex.slice(2) : hex;
  const at = byteIndex * 2;
  const next = (Number.parseInt(body.slice(at, at + 2), 16) ^ 0x01).toString(16).padStart(2, '0');
  return `${prefixed ? '0x' : ''}${body.slice(0, at)}${next}${body.slice(at + 2)}`;
}

function setMutate(loop, fn) {
  loop.chain.proxy.state.mutate = fn;
  loop.chain.mirror.state.mutate = fn;
}

function clearMutate(loop) {
  loop.chain.proxy.state.mutate = null;
  loop.chain.mirror.state.mutate = null;
}

function proofWords(calldata) {
  const hex = String(calldata).replace(/^0x/i, '');
  const bytes = Buffer.from(hex, 'hex');
  const lenAt = 4 + 7 * 32;
  const len = Number(BigInt(`0x${bytes.subarray(lenAt, lenAt + 32).toString('hex')}`));
  const proof = [];
  for (let i = 0; i < len; i += 1) {
    const start = lenAt + 32 + i * 32;
    proof.push(bytes.subarray(start, start + 32).toString('hex'));
  }
  return proof;
}

async function anchorTuple(to, from, record, proof) {
  const built = buildAnchorCalldata({
    chainId: CHAIN_ID,
    contract: to,
    epoch: record.epoch,
    hourStart: record.hourStart,
    size: record.size,
    root: record.root,
    stateRoot: record.stateRoot,
    proof,
  });
  const hash = await rpc('eth_sendTransaction', [{
    from,
    to,
    data: `0x${built.calldata}`,
    gas: '0x200000',
  }]);
  const rec = await rpc('eth_getTransactionReceipt', [hash]);
  if (!rec || rec.status !== '0x1') throw new Error(`foreign anchor status ${rec && rec.status}`);
}

async function broadcast(wire) {
  const raw = wire.startsWith('0x') ? wire : `0x${wire}`;
  const hash = await rpc('eth_sendRawTransaction', [raw]);
  const start = Date.now();
  let rec = null;
  while (Date.now() - start < 15000) {
    rec = await rpc('eth_getTransactionReceipt', [hash]);
    if (rec) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!rec || rec.status !== '0x1') throw new Error('broadcast reverted');
  return hash;
}

describe('p0-9 local chain', () => {
  test('twenty-four hours, one green receipt, and the tamper matrix', async () => {
    let loop;
    const rows = [];
    const samples = [];
    try {
      loop = await openLoop();
      const callerPk = new Uint8Array(32).fill(9);
      let body = null;
      let payment = null;
      const hour0 = loop.firstHour;
      loop.clock.now = hour0 + HOUR + 40;
      payment = await pay(loop);
      const held = await sealHour(loop, hour0, [{
        line: coreLine(payment),
        bookId: loop.book.id,
        bookPk: callerPk,
      }], async () => {
        throw new Error('hold');
      });
      assert.equal(held.committed, true, held.reason);
      const commit = loop.sealer.state.commits.at(-1);
      const proof = proofWords(commit.calldata);
      const other = await deployAnchor(loop.chain.wallet, ACCOUNT2);
      await anchorTuple(other.address, ACCOUNT2, commit, proof);
      const foreign = await listenAnchored(loop);
      assert.equal(foreign.released, false);
      const pendingId = commit.receipts[0].id;
      const still = fetchReceipt(loop.store, { receiptId: pendingId, bookId: loop.book.id, token: loop.book.token });
      rows.push({ id: 'T17', expected: 202, exit: still.status, reason: still.body?.state || 'not_released' });
      assert.equal(still.status, 202);

      const recovered = await recover(loop.sealer, { send: broadcast });
      assert.equal(recovered.ok, true, recovered.reason);
      loop.rpcUrl = loop.chain.urls[0];
      setMutate(loop, (req, res) => {
        if (req.method === 'eth_getTransactionByHash' && res.result && res.result.from) res.result.from = ACCOUNT2;
        return res;
      });
      const lied = await listenAnchored(loop);
      assert.equal(lied.released, false, 'a rewritten sender released the hour');
      clearMutate(loop);
      loop.rpcUrl = undefined;
      const noted0 = await listenAnchored(loop);
      assert.equal(noted0.released, true, 'hour 0 did not release');
      samples.push(held.elapsedMs);
      const fetched0 = fetchReceipt(loop.store, { receiptId: pendingId, bookId: loop.book.id, token: loop.book.token });
      assert.equal(fetched0.ok, true);
      body = fetched0.body;

      for (let step = 1; step < 24; step += 1) {
        const hour = loop.firstHour + step * HOUR;
        loop.clock.now = hour + HOUR + 40;
        const closed = await sealHour(loop, hour, []);
        assert.equal(closed.ok, true, closed.reason);
        if (step === 1) {
          loop.rpcUrl = loop.chain.urls[0];
          setMutate(loop, (req, res) => {
            if (req.method === 'eth_getBlockByNumber' && req.params?.[0] === 'finalized' && res.result) {
              res.result.number = '0x1';
            }
            return res;
          });
          const early = await listenAnchored(loop);
          assert.equal(early.released, false, 'an unfinalized hour was released');
          clearMutate(loop);
          loop.rpcUrl = undefined;
        }
        const noted = await listenAnchored(loop);
        assert.equal(noted.released, true, `hour ${step} did not release`);
        samples.push(closed.elapsedMs);
      }
      const green = await verifyBody(loop, body);
      rows.push({ id: 'green', expected: 0, exit: green.exit, reason: green.reason });
      assert.equal(green.exit, 0, `${green.reason || ''} ${green.message || ''}`);

      const future = loop.firstHour + 24 * HOUR;
      loop.clock.now = future + 10;
      const latest = await rpc('eth_getBlockByNumber', ['latest', false]);
      const stamp = Math.max(future + 10, Number(latest.timestamp) + 1);
      await rpc('evm_setNextBlockTimestamp', [stamp]);
      await rpc('evm_mine', []);
      const built = buildAnchorCalldata({
        chainId: CHAIN_ID,
        contract: loop.anchor.address,
        epoch: 25,
        hourStart: future,
        size: 1,
        root: '11'.repeat(32),
        stateRoot: '22'.repeat(32),
        proof: [],
      });
      let unfinished = '';
      try {
        await rpc('eth_call', [{
          from: loop.address,
          to: loop.anchor.address,
          data: built.calldata,
        }, 'latest']);
      } catch (err) {
        unfinished = `${err.shortMessage || ''} ${err.message || err} ${err.info?.error?.message || ''}`;
      }
      assert.match(unfinished, /HourNotFinished|439e52db/);

      const base = () => ({
        v: 13,
        schema: 'chit402.cs2.receipt.v1',
        line: body.line.startsWith('0x') ? body.line : `0x${body.line}`,
        index: body.index,
        epoch: body.epoch,
        contract: loop.anchor.address,
        proof: body.proof,
        slotKey: body.slotKey,
        slotValue: body.slotValue,
        slotProof: body.slotProof,
        paymentProof: body.paymentProof,
        saltedBook: body.saltedBook,
      });
      const check = async (id, expected, receipt, reasonIncludes, message) => {
        let timer;
        const got = await Promise.race([
          checkReceiptInput(JSON.stringify(receipt), loop.snapshot.options(loop.chain.urls)),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timeout ${id}`)), 20000);
          }),
        ]).finally(() => clearTimeout(timer));
        const verdict = { exit: got.verdict.exit_code, reason: got.verdict.reason };
        rows.push({ id, expected, exit: verdict.exit, reason: verdict.reason });
        assert.notEqual(verdict.exit, 0, id);
        assert.equal(verdict.exit, expected, `${id} ${verdict.reason}`);
        if (reasonIncludes) assert.match(String(verdict.reason), reasonIncludes);
        if (message) assert.equal(got.verdict.message, message);
        return verdict;
      };

      const lineHex = base().line;
      await check('T1', 1, { ...base(), line: flip(lineHex, 1023) });
      await check('T2', 1, { ...base(), line: flip(lineHex, 738) });
      await check('T3', 2, { ...base(), contract: `0x${'44'.repeat(20)}` }, /contract_not_pinned/);

      const otherBlock = await rpc('eth_getBlockByNumber', ['0x1', false]);
      assert.notEqual(otherBlock.hash.slice(2).toLowerCase(), payment.blockHash.toLowerCase());
      const wrongHour = loop.firstHour + 24 * HOUR;
      loop.clock.now = Math.max(loop.clock.now, wrongHour + HOUR + 40);
      const wrongSealed = await sealHour(loop, wrongHour, [{
        line: coreLine({ ...payment, blockHash: otherBlock.hash.slice(2) }),
        bookId: loop.book.id,
        bookPk: callerPk,
      }]);
      assert.equal(wrongSealed.ok, true, wrongSealed.reason);
      assert.equal((await listenAnchored(loop)).released, true);
      const wrongId = loop.sealer.state.commits.at(-1).receipts[0].id;
      const wrongBody = fetchReceipt(loop.store, { receiptId: wrongId, bookId: loop.book.id, token: loop.book.token });
      const wrongVerdict = await verifyBody(loop, wrongBody.body);
      rows.push({ id: 'T4', expected: 1, exit: wrongVerdict.exit, reason: wrongVerdict.reason });
      assert.equal(wrongVerdict.exit, 1);
      assert.equal(wrongVerdict.reason, 'wrong_block_hash');

      const wrong = `0x${'12'.repeat(32)}`;
      const payHash = `0x${payment.blockHash}`;
      const rewrite = (req, res) => {
        if (req.method === 'eth_getBlockByHash' && res.result && String(req.params?.[0]).toLowerCase() === payHash.toLowerCase()) {
          res.result.hash = wrong;
        }
        if (req.method === 'eth_getBlockByNumber' && res.result && Number(res.result.number) === payment.blockNumber) {
          res.result.hash = wrong;
        }
        return res;
      };
      setMutate(loop, rewrite);
      await check('T5', 1, base(), /reorged/);
      clearMutate(loop);

      await check('T6', 1, { ...base(), index: 999999 }, /not_first_anchor/);
      await check('T7', 1, { ...base(), leaf: `0x${'ab'.repeat(32)}` }, /caller_supplied_leaf/);
      await check('T8', 1, { ...base(), treeSize: 128 }, /caller_supplied_tree_size/);
      const over = treeSizeFromHead(1n << 53n);
      const under = treeSizeFromHead((1n << 53n) - 1n);
      rows.push({
        id: 'T9',
        expected: 1,
        exit: over.ok ? 0 : 1,
        reason: over.reason || 'tree_size_above_cap',
        capHandled: under.ok === true,
      });
      assert.equal(over.ok, false);
      assert.equal(under.ok, true);

      const bumpNumber = (req, res) => {
        if (req.method === 'eth_getBlockByHash' && res.result && String(req.params?.[0]).toLowerCase() === payHash.toLowerCase()) {
          const n = BigInt(res.result.number) + 1n;
          res.result.number = `0x${n.toString(16)}`;
          res.result._keptHash = res.result.hash;
        }
        if (req.method === 'eth_getBlockByNumber' && res.result) {
          const asked = Number(req.params?.[0]);
          if (asked === payment.blockNumber + 1) res.result.hash = payHash;
        }
        return res;
      };
      setMutate(loop, bumpNumber);
      await check('T10', 1, base(), /payment_mismatch/);
      clearMutate(loop);

      const bumpTime = (req, res) => {
        if (req.method === 'eth_getBlockByHash' && res.result && res.result.timestamp) {
          const n = BigInt(res.result.timestamp) + 1n;
          res.result.timestamp = `0x${n.toString(16)}`;
        }
        return res;
      };
      setMutate(loop, bumpTime);
      await check('T11', 1, base(), /payment_mismatch/);
      clearMutate(loop);

      const dropTime = (req, res) => {
        if (req.method === 'eth_getBlockByHash' && res.result) delete res.result.timestamp;
        return res;
      };
      setMutate(loop, dropTime);
      await check('T12', 2, base(), /payment_unchecked/);
      clearMutate(loop);

      loop.chain.proxy.state.mutate = bumpTime;
      await check('T13', 2, base(), /rpc_disagreement/);
      clearMutate(loop);

      const later = await pay(loop);
      const high = coreLine({ ...later, blockNumber: 50000 });
      const hour = loop.firstHour + 25 * HOUR;
      loop.clock.now = Math.max(loop.clock.now, hour + HOUR + 40);
      const sealed = await sealHour(loop, hour, [{ line: high, bookId: loop.book.id, bookPk: callerPk }]);
      assert.equal(sealed.ok, true, sealed.reason);
      assert.equal((await listenAnchored(loop)).released, true);
      const lateId = loop.sealer.state.commits.at(-1).receipts[0].id;
      const late = fetchReceipt(loop.store, { receiptId: lateId, bookId: loop.book.id, token: loop.book.token });
      await check('T14', 1, {
        ...base(),
        line: late.body.line.startsWith('0x') ? late.body.line : `0x${late.body.line}`,
        index: late.body.index,
        epoch: late.body.epoch,
        proof: late.body.proof,
        slotKey: late.body.slotKey,
        slotValue: late.body.slotValue,
        slotProof: late.body.slotProof,
        paymentProof: late.body.paymentProof,
        saltedBook: late.body.saltedBook,
      }, /payment_after_anchor/);

      assert.notEqual(late.body.paymentProof, body.paymentProof);
      await check('T15', 1, { ...base(), paymentProof: late.body.paymentProof }, /payment_mismatch/);
      const missing = base();
      delete missing.paymentProof;
      await check('T16', 2, missing, /payment_unchecked/, PAYMENT_SLOT_MISSING);
      const both = base();
      delete both.paymentProof;
      delete both.saltedBook;
      await check('T16b', 2, both, /payment_unchecked/, PAYMENT_SLOT_MISSING);
      const saltOnly = base();
      delete saltOnly.saltedBook;
      await check('T16c', 2, saltOnly, /payment_unchecked/, PAYMENT_SLOT_MISSING);

      const rotateData = loop.anchor.contract.interface.encodeFunctionData('rotateCheckpointKey', [ACCOUNT2, 2]);
      const rotateHash = await rpc('eth_sendTransaction', [{
        from: loop.address,
        to: loop.anchor.address,
        data: rotateData,
        gas: '0x100000',
      }]);
      const rotateRec = await rpc('eth_getTransactionReceipt', [rotateHash]);
      assert.equal(rotateRec.status, '0x1');
      const rotatedHour = loop.firstHour + 26 * HOUR;
      loop.clock.now = Math.max(loop.clock.now, rotatedHour + HOUR + 40);
      loop.sealer.signer.address = ACCOUNT2;
      const rotated = await sealHour(loop, rotatedHour, [], (wire) => sendFrom(ACCOUNT2, loop.anchor.address, wire));
      assert.equal(rotated.ok, true, rotated.reason);
      const followed = await listenAnchored(loop);
      assert.equal(followed.released, true, 'the rotated checkpoint was not followed');
      assert.equal(followed.checkpoint, ACCOUNT2.toLowerCase());

      writeFileSync(TABLE, `${JSON.stringify({ label: 'local', samples, rows }, null, 2)}\n`);
    } finally {
      writeFileSync(TABLE, `${JSON.stringify({ label: 'local', samples, rows }, null, 2)}\n`);
      if (loop) await loop.stop();
    }
  });
});
