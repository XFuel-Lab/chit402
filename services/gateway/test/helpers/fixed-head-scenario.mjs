/**
 * Deterministic tree-head publish scenario for the fixed-head byte-identity
 * tests (G1/G2). The same file runs on main to produce the golden fixture
 * test/fixtures/fixed-head-g1-main.json, so it only uses APIs main has.
 *
 * Caller sets NODE_ENV=test and ISSUER_PRIVATE_KEY (synthetic key) before
 * importing src modules, and installs the stub signer below.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SCENARIO_TIMES = Object.freeze({
  clock: '2026-10-20T09:00:00.000Z',
  first: '2026-10-20T10:00:00.000Z',
  second: '2026-10-20T11:00:01.250Z',
});

/**
 * JWS inputs (start "eyJ") get a fixed 64-byte value derived from the input,
 * so two runs produce the same JWS bytes. Anything else (the EIP-712
 * preimage) is signed for real with `privateKey`, then turned high-S when
 * `highS` is set, to prove the caller normalizes.
 */
export function stubSigner({ kid, publicJwk, privateKey, highS = false, onSign = null }) {
  const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const calls = [];
  return {
    kind: 'env',
    kid,
    publicJwk: { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y },
    calls,
    async sign(input, opts) {
      const message = Buffer.from(input);
      calls.push({ first: message[0], length: message.length, typed: Boolean(opts && opts.typedPreimage) });
      if (onSign) await onSign(message, opts);
      if (message.subarray(0, 3).toString('latin1') === 'eyJ') {
        const r = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('r'), message])).digest();
        const s = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('s'), message])).digest();
        s[0] &= 0x7f;
        return Buffer.concat([r, s]);
      }
      let sig = crypto.sign('sha256', message, { key: privateKey, dsaEncoding: 'ieee-p1363' });
      if (highS) {
        const s = BigInt(`0x${sig.subarray(32).toString('hex')}`);
        if (s <= N / 2n) {
          sig = Buffer.concat([sig.subarray(0, 32), Buffer.from((N - s).toString(16).padStart(64, '0'), 'hex')]);
        }
      }
      return sig;
    },
  };
}

/**
 * Builds a durable-looking tree in a fresh dir, publishes two heads, and
 * returns the bytes the tests compare.
 * @param {{ ReceiptMerkleTree: Function, prepare?: (tree: object, dir: string) => void }} mod
 */
export async function runScenario({ ReceiptMerkleTree, prepare = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-head-scenario-'));
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.durable = true;
  tree.allowFreshGenesis = true;
  tree._now = () => new Date(SCENARIO_TIMES.clock);
  // Fixed genesis bytes, so the golden does not move when the verifier
  // build digest changes.
  tree.genesisLeaf = () => ({
    task_id: 'genesis',
    bytes: Buffer.from('{"schema":"chit402.tree_genesis.v1","payload_version":1,"verifier_binary_build_digest":null}'),
    kind: 'genesis',
  });
  await tree.appendReceipt('row-1', 'hash-1', { publish: false });
  await tree.appendReceipt('row-2', 'hash-2', { publish: false });
  tree.allowFreshGenesis = false;
  if (prepare) prepare(tree, dir);
  const opts = { force: true, sleep: async () => {}, send: async () => { throw new Error('no_send'); } };
  await tree.publishHead({ ...opts, now: SCENARIO_TIMES.first });
  await tree.appendReceipt('row-3', 'hash-3', { publish: false });
  await tree.publishHead({ ...opts, now: SCENARIO_TIMES.second });
  const journal = fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8');
  const out = {
    heads: JSON.parse(JSON.stringify(tree.heads)),
    latest: JSON.parse(JSON.stringify(tree.latestSignedHead())),
    journal,
    files: fs.readdirSync(dir).sort(),
  };
  return { out, tree, dir };
}
