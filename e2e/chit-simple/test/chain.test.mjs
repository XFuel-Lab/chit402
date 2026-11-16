/**
 * Local chain proof. Testnet dummy data. The signer is a public Hardhat key.
 * One node, two proxies. Ports differ, so the verifier treats them as two RPCs.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { checkReceiptInput } from '../../../packages/verify/dist/check-input.js';
import { treeSizeFromHead } from '../../../packages/verify/dist/v13/core/decide.js';
import { buildAnchorCalldata } from '../../../services/chit-sealer/calldata.js';
import { fetchReceipt, noteAnchored } from '../../../services/chit-store/store.js';
import { CHAIN_ID, rpc } from '../chain.mjs';
import {
  coreLine,
  openLoop,
  pay,
  release,
  sealHour,
  verifyBody,
} from '../loop.mjs';

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

describe('p0-9 local chain', () => {
  test('twenty-four hours, one green receipt, and the tamper matrix', async () => {
    const loop = await openLoop();
    const rows = [];
    const samples = [];
    try {
      const callerPk = new Uint8Array(32).fill(9);
      let body = null;
      let payment = null;
      for (let step = 0; step < 24; step += 1) {
        const hour = loop.firstHour + step * HOUR;
        loop.clock.now = hour + HOUR + 40;
        const lines = [];
        if (step === 0) {
          payment = await pay(loop);
          lines.push({ line: coreLine(payment), bookId: loop.book.id, bookPk: callerPk });
        }
        const closed = await sealHour(loop, hour, lines);
        assert.equal(closed.ok, true, closed.reason);
        const noted = release(loop, closed.record);
        assert.equal(noted.released, true, `hour ${step} did not release`);
        samples.push(closed.elapsedMs);
        if (step === 0) {
          const id = loop.sealer.state.commits[0].receipts[0].id;
          const fetched = fetchReceipt(loop.store, { receiptId: id, bookId: loop.book.id, token: loop.book.token });
          assert.equal(fetched.ok, true);
          body = fetched.body;
        }
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
      const check = async (id, expected, receipt, reasonIncludes) => {
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
        return verdict;
      };

      const lineHex = base().line;
      await check('T1', 1, { ...base(), line: flip(lineHex, 1023) });
      await check('T2', 1, { ...base(), line: flip(lineHex, 738) });
      await check('T3', 2, { ...base(), contract: `0x${'44'.repeat(20)}` }, /contract_not_pinned/);
      await check('T4', 1, { ...base(), line: flip(lineHex, 10) });

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

      await check('T6', 2, { ...base(), index: 999999 }, /pre_anchor/);
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
      const hour = loop.firstHour + 24 * HOUR;
      loop.clock.now = Math.max(loop.clock.now, hour + HOUR + 40);
      const sealed = await sealHour(loop, hour, [{ line: high, bookId: loop.book.id, bookPk: callerPk }]);
      assert.equal(sealed.ok, true, sealed.reason);
      assert.equal(release(loop, sealed.record).released, true);
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

      await check('T15', 1, { ...base(), paymentProof: 'ab'.repeat(32) }, /payment_mismatch/);
      const missing = base();
      delete missing.paymentProof;
      await check('T16', 2, missing, /payment_unchecked/);

      const heldPay = await pay(loop);
      const heldHour = loop.firstHour + 25 * HOUR;
      loop.clock.now = Math.max(loop.clock.now, heldHour + HOUR + 40);
      const held = await sealHour(loop, heldHour, [{
        line: coreLine(heldPay),
        bookId: loop.book.id,
        bookPk: callerPk,
      }]);
      assert.equal(held.ok, true, held.reason);
      const ignored = noteAnchored(loop.store, {
        finalized: true,
        epoch: held.record.epoch,
        hourStart: held.record.hourStart,
        size: held.record.size,
        root: held.record.root,
        stateRoot: held.record.stateRoot,
        chainId: CHAIN_ID,
        contract: `0x${'55'.repeat(20)}`,
        from: loop.address,
      });
      assert.equal(ignored.released, false);
      const pendingId = loop.sealer.state.commits.at(-1).receipts[0].id;
      const still = fetchReceipt(loop.store, { receiptId: pendingId, bookId: loop.book.id, token: loop.book.token });
      rows.push({ id: 'T17', expected: 202, exit: still.status, reason: still.body?.state || 'not_released' });
      assert.equal(still.status, 202);

      writeFileSync(TABLE, `${JSON.stringify({ label: 'local', samples, rows }, null, 2)}\n`);
    } finally {
      writeFileSync(TABLE, `${JSON.stringify({ label: 'local', samples, rows }, null, 2)}\n`);
      await loop.stop();
    }
  });
});
