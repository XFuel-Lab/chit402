/**
 * 0.4.6 public receipt attestation. Throwaway P-256 issuer key, a local log
 * server, and a local JSON-RPC. No production host, no POST outside loopback.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const { PINNED_BASE_ANCHOR_WALLET, verifyTreeHeadTrust } = await import('../dist/anchor-trust.js');
const { jwkThumbprint, verifyIssuerJws } = await import('../dist/jws.js');
const { jcsCanonicalize } = await import('../dist/jcs.js');
const { issuerHistoryEntryHash } = await import('../dist/issuer-history.js');
const { humanVerdictLines, VERDICT_DOC_ANCHORS } = await import('../dist/verdict.js');
const { verifyPublicShell, checkReceiptInput, receiptIdFromTarget } = await import('../dist/check-input.js');
const lib = await import('../dist/index.js');

const TAG = 'chit402.public_receipt.v1';
const TYP = 'chit402-public-receipt+jwt';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TASK = 'xfuel-0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = 'xfuel-ffffffff-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ROW = 'row-hash-public-046';
const PAYEE = '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334';
const PAYER = '0x1111111111111111111111111111111111111111';
const PAY_TX = `0x${'cd'.repeat(32)}`;
const ANCHOR_TX = `0x${'ab'.repeat(32)}`;

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const sha = (buf) => createHash('sha256').update(buf).digest();
const leafOf = (body) => sha(Buffer.concat([Buffer.from([0]), Buffer.from(body)]));
const node = (l, r) => sha(Buffer.concat([Buffer.from([1]), l, r]));
const topic = (addr) => `0x${'0'.repeat(24)}${addr.slice(2).toLowerCase()}`;
const amountHex = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`;

function issuerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(j);
  return { privateKey, kid, publicJwk: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, kid, alg: 'ES256', use: 'sig' } };
}

function signRaw(key, header, payloadText) {
  const input = `${b64(header)}.${b64(payloadText)}`;
  const s = sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${s.toString('base64url')}`;
}

function attest(key, claims, { header = null, payload = null } = {}) {
  const h = header || { alg: 'ES256', typ: TYP, kid: key.kid };
  return signRaw(key, h, payload ?? `${TAG}\n${jcsCanonicalize(claims)}`);
}

function sealHead(head, key) {
  const claims = JSON.parse(JSON.stringify(head));
  const header = { alg: 'ES256', typ: 'chit402-tree-head+jwt', kid: key.kid };
  return {
    ...claims,
    issuer_signature: { alg: 'ES256', typ: 'chit402-tree-head+jwt', jws: signRaw(key, header, JSON.stringify(claims)), kid: key.kid, issuer_jwk: key.publicJwk },
  };
}

function historyDoc(key, { revokedAt = null, notBefore = '2020-01-01T00:00:00.000Z' } = {}) {
  const body = {
    kid: key.kid, jwk: key.publicJwk, alg: 'ES256', not_before: notBefore, not_after: null,
    status: revokedAt ? 'revoked' : 'active', revoked_at: revokedAt, reason: revokedAt ? 'test' : null,
    custody: 'test custody', prev_hash: null,
  };
  const entry = { ...body, entry_hash: issuerHistoryEntryHash(body) };
  const claims = {
    schema: 'chit402.issuer_history.v1', payload_version: 1, entry_count: 1,
    head_hash: entry.entry_hash, version: 1, seq: 1,
  };
  const header = { alg: 'ES256', typ: 'chit402-issuer-history+jwt', kid: key.kid };
  return {
    schema: 'chit402.issuer_history.v1', payload_version: 1, version: 1, seq: 1, entries: [entry], head_hash: entry.entry_hash,
    issuer_signature: {
      alg: 'ES256', typ: 'chit402-issuer-history+jwt', payload_version: 1,
      jws: signRaw(key, header, JSON.stringify(claims)), kid: key.kid, issuer_jwk: key.publicJwk,
    },
  };
}

const key = issuerKey();
const stranger = issuerKey();
const leaf = leafOf(`${TASK}|${ROW}`);
const sibling = leafOf('genesis');
const root = node(sibling, leaf).toString('hex');
const head = sealHead({
  schema: 'chit402.tree_head.v1',
  payload_version: 1,
  root,
  tree_size: 2,
  anchors: {
    base: { status: 'anchored', tx: ANCHOR_TX, calldata: `0x${root}`, chain_id: 8453, from: PINNED_BASE_ANCHOR_WALLET },
    solana: { status: 'pending' },
  },
}, key);
const goodInclusion = {
  task_id: TASK, epoch: 1, leaf_index: 1, tree_size: 2, root,
  leaf: leaf.toString('hex'),
  proof: [{ hash: sibling.toString('hex'), position: 'left' }],
};

function baseClaims(over = {}) {
  return {
    attested_at: '2026-10-17T18:30:00.000Z',
    iss: 'chit402',
    issued_at: '2026-10-17T18:29:00.000Z',
    log: { epoch: 1, leaf_hash: leaf.toString('hex'), leaf_index: 1 },
    payment: {
      asset: USDC, gross_amount: '2000', payee: PAYEE, rail: 'usdc',
      ref: `base:${PAY_TX}`, settled_amount: '2000',
    },
    task_id: TASK,
    ...over,
  };
}

function shellFor(jws, over = {}) {
  return {
    schema: 'chit402.receipt_shell.v1',
    unsigned: true,
    receipt_id: TASK,
    task_id: TASK,
    payload_version: 11,
    asset: USDC,
    chain: 'base',
    pay_to: PAYEE,
    amount_gross: '2000',
    amount_settled: '2000',
    payment_tx: PAY_TX,
    issued_at: '2026-10-17T18:29:00.000Z',
    inclusion: { leaf_hash: leaf.toString('hex'), proof: goodInclusion.proof, signed_head: { root, tree_size: 2, signature: null } },
    public_attestation: { jws },
    ...over,
  };
}

// Mutable world for the local log and RPC.
const world = {};
function resetWorld() {
  world.inclusion = structuredClone(goodInclusion);
  world.inclusionStatus = 200;
  world.head = head;
  world.anchorRoot = root;
  world.payReceipt = {
    transactionHash: PAY_TX, status: '0x1', blockNumber: '0x64',
    logs: [{ address: USDC, topics: [TRANSFER, topic(PAYER), topic(PAYEE)], data: amountHex(2000) }],
  };
  world.chainId = '0x2105';
  world.tip = '0x80';
  world.rpcDown = false;
  world.posts = 0;
  world.gets = [];
}
resetWorld();

let server;
let origin;
before(async () => {
  server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST') {
      world.posts += 1;
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (world.rpcDown) return send(500, { error: 'down' });
        const msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        let result = null;
        const hash = msg.params?.[0];
        if (msg.method === 'eth_chainId') result = world.chainId;
        else if (msg.method === 'eth_blockNumber') result = world.tip;
        else if (msg.method === 'eth_getTransactionByHash' && hash === ANCHOR_TX) {
          result = { hash: ANCHOR_TX, input: `0x${world.anchorRoot}`, from: PINNED_BASE_ANCHOR_WALLET.toLowerCase(), blockNumber: '0x64', chainId: '0x2105' };
        } else if (msg.method === 'eth_getTransactionReceipt' && hash === ANCHOR_TX) {
          result = { transactionHash: ANCHOR_TX, status: '0x1', blockNumber: '0x64', from: PINNED_BASE_ANCHOR_WALLET.toLowerCase() };
        } else if (msg.method === 'eth_getTransactionReceipt' && hash === PAY_TX) {
          result = world.payReceipt;
        }
        send(200, { jsonrpc: '2.0', id: msg.id, result });
      });
      return;
    }
    world.gets.push(req.url);
    if (req.url.startsWith(`/v1/receipts/${TASK}/inclusion`)) return send(world.inclusionStatus, world.inclusion);
    if (req.url.startsWith('/v1/receipts/tree/head')) return send(200, world.head);
    return send(404, { error: 'not_found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  process.env.BASE_RPC_URL = `${origin}/rpc`;
  process.env.SOLANA_RPC_URL = `${origin}/rpc`;
});
after(() => server?.close());

function opts(over = {}) {
  return {
    history: historyDoc(key),
    historySource: 'file',
    requestedId: TASK,
    origin,
    publicInput: false,
    rpcUrl: `${origin}/rpc`,
    trustedKids: [key.kid],
    ...over,
  };
}

async function run(shell, over = {}) {
  return await verifyPublicShell(shell, opts(over));
}

function expectExit(verdict, code, reason) {
  assert.ok(verdict, 'no verdict');
  assert.equal(verdict.exit_code, code, `${verdict.result} ${verdict.reason}`);
  if (reason !== undefined) assert.equal(verdict.reason, reason);
  if (code !== 0) assert.notEqual(verdict.result, 'verified_public');
  assert.notEqual(verdict.result, 'verified');
}

test('M1/M8 an honest attestation is VERIFIED_PUBLIC, exit 0, with public scope only', async () => {
  resetWorld();
  const v = await run(shellFor(attest(key, baseClaims())));
  expectExit(v, 0, null);
  assert.equal(v.result, 'verified_public');
  assert.equal(v.scope, 'public');
  assert.equal(v.checks.payer, 'not_claimed');
  assert.deepEqual(Object.keys(v.public).sort(), ['chain_from', 'claims', 'payer', 'task_id_to_leaf']);
  assert.equal(v.public.chain_from, '0x1111…1111');
  assert.equal(v.public.task_id_to_leaf, 'issuer_signature');
  for (const name of ['signature', 'key_window', 'payment_binding', 'log_inclusion', 'anchor', 'shape']) {
    assert.equal(v.checks[name], 'pass', name);
  }
  assert.equal(v.receipt_id, TASK);
  const lines = humanVerdictLines(v);
  assert.equal(lines[0], 'VERIFIED_PUBLIC');
  assert.ok(lines.some((l) => /Payer: not claimed/.test(l)));
  assert.equal(JSON.stringify(v).includes(PAYER), false, 'full sender address must not be printed');
  assert.ok(VERDICT_DOC_ANCHORS.includes('verified_public'));
});

test('identical repeat reads give the identical verdict', async () => {
  resetWorld();
  const shell = shellFor(attest(key, baseClaims()));
  const a = await run(shell);
  const b = await run(structuredClone(shell));
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('M6 an id swap is exit 1: requested id, outer task_id, outer receipt_id', async () => {
  resetWorld();
  const jws = attest(key, baseClaims());
  expectExit(await run(shellFor(jws), { requestedId: OTHER }), 1, 'claim_mismatch');
  expectExit(await run(shellFor(jws, { task_id: OTHER })), 1, 'claim_mismatch');
  expectExit(await run(shellFor(jws, { receipt_id: OTHER })), 1, 'claim_mismatch');
  // chit- and xfuel- name the same receipt.
  expectExit(await run(shellFor(jws), { requestedId: TASK.replace('xfuel-', 'chit-') }), 0, null);
  assert.equal(receiptIdFromTarget(`https://api.chit402.com/receipt/${OTHER}?format=json`), OTHER);
  assert.equal(receiptIdFromTarget(TASK), TASK);
  assert.equal(receiptIdFromTarget('./shell.json'), null);
});

test('M6 an outer field that differs from the signed value is exit 1 claim_mismatch', async () => {
  resetWorld();
  const jws = attest(key, baseClaims());
  for (const [field, value] of [
    ['amount_settled', '1999'], ['amount_gross', '9999'], ['pay_to', PAYER],
    ['payment_tx', `0x${'ee'.repeat(32)}`], ['issued_at', '2026-10-17T18:28:00.000Z'], ['chain', 'solana'],
  ]) {
    expectExit(await run(shellFor(jws, { [field]: value })), 1, 'claim_mismatch');
  }
});

test('M4/M5 the log must prove the signed leaf at the signed index', async () => {
  resetWorld();
  const jws = attest(key, baseClaims());
  // Shell leaf differs from the signed leaf.
  expectExit(await run(shellFor(jws, { inclusion: { leaf_hash: sibling.toString('hex'), proof: [], signed_head: null } })), 1, 'leaf_not_bound');

  // Log serves another leaf with a valid proof for that leaf.
  resetWorld();
  world.inclusion = { ...goodInclusion, leaf_index: 0, leaf: sibling.toString('hex'), proof: [{ hash: leaf.toString('hex'), position: 'right' }] };
  expectExit(await run(shellFor(jws)), 1, 'leaf_not_bound');

  // Signed leaf at another index.
  resetWorld();
  world.inclusion = { ...goodInclusion, leaf_index: 0 };
  expectExit(await run(shellFor(jws)), 1, 'leaf_index_mismatch');

  // Swapped position label: the proof no longer reaches the root.
  resetWorld();
  world.inclusion = { ...goodInclusion, proof: [{ hash: sibling.toString('hex'), position: 'right' }] };
  expectExit(await run(shellFor(jws)), 1, 'inclusion_failed');

  // Signed head for another root.
  resetWorld();
  world.head = sealHead({ ...JSON.parse(JSON.stringify({ ...head, issuer_signature: undefined })), root: 'f'.repeat(64) }, key);
  expectExit(await run(shellFor(jws)), 1);

  // Epoch rollover race: exit 2, not a pass and not invalid.
  resetWorld();
  world.inclusion = { ...goodInclusion, epoch: 2 };
  expectExit(await run(shellFor(jws)), 2, 'log_epoch_mismatch');

  // Leaf past the anchored head: pending, exit 2.
  const one = sibling.toString('hex');
  const pendingWorld = () => {
    resetWorld();
    world.anchorRoot = one;
    world.head = sealHead({
      schema: 'chit402.tree_head.v1', payload_version: 1, root: one, tree_size: 1,
      anchors: { base: { status: 'anchored', tx: ANCHOR_TX, calldata: `0x${one}`, chain_id: 8453, from: PINNED_BASE_ANCHOR_WALLET }, solana: { status: 'pending' } },
    }, key);
    world.inclusion = {
      ...goodInclusion, status: 'pending_anchor', anchor_status: 'pending', proof: null,
      tree_size: 1, anchored_tree_size: 1, live_tree_size: 2, root: one,
    };
  };
  pendingWorld();
  const pending = await run(shellFor(jws));
  expectExit(pending, 2);

  // Pending inclusion naming another leaf is exit 1.
  pendingWorld();
  world.inclusion.leaf = 'e'.repeat(64);
  expectExit(await run(shellFor(jws)), 1, 'leaf_not_bound');

  // Log down: exit 2.
  resetWorld();
  world.inclusionStatus = 503;
  expectExit(await run(shellFor(jws)), 2);
});

test('M3/T-tag the payload must be the tagged canonical allowlist', async () => {
  resetWorld();
  const claims = baseClaims();
  const cases = {
    untagged_json: attest(key, claims, { payload: jcsCanonicalize(claims) }),
    receipt_typ: attest(key, claims, { header: { alg: 'ES256', typ: 'chit402-receipt+jwt', kid: key.kid } }),
    extra_header: attest(key, claims, { header: { alg: 'ES256', typ: TYP, kid: key.kid, jku: 'https://example.invalid/jwks.json' } }),
    payload_version: attest(key, { ...claims, payload_version: 1 }),
    v: attest(key, { ...claims, v: 1 }),
    full_hash: attest(key, { ...claims, payload_hash: 'a'.repeat(64) }),
    payer_claim: attest(key, { ...claims, payment: { ...claims.payment, payer: PAYER } }),
    not_canonical: attest(key, claims, { payload: `${TAG}\n${JSON.stringify(claims, null, 1)}` }),
    wrong_tag: attest(key, claims, { payload: `chit402.public_receipt.v2\n${jcsCanonicalize(claims)}` }),
    second_minute: attest(key, { ...claims, attested_at: '2026-10-17T18:30:07.000Z' }),
    issued_after_attested: attest(key, { ...claims, issued_at: '2026-10-17T18:31:00.000Z' }),
    upper_ref: attest(key, { ...claims, payment: { ...claims.payment, ref: `base:${PAY_TX.toUpperCase().replace('0X', '0x')}` } }),
    zero_settled: attest(key, { ...claims, payment: { ...claims.payment, settled_amount: '0' } }),
    other_asset: attest(key, { ...claims, payment: { ...claims.payment, asset: PAYER } }),
    garbage: 'not-a-jws',
  };
  for (const [name, jws] of Object.entries(cases)) {
    const v = await run(shellFor(jws));
    expectExit(v, 1, 'invalid_jws');
    assert.equal(v.checks.shape, 'fail', name);
  }
  for (const att of [null, 'x', [], { jws: 7 }, { status: 'pending', jws: 'x' }, { status: 'signed' }]) {
    expectExit(await run({ ...shellFor('x'), public_attestation: att }), 1, 'invalid_jws');
  }
});

test('M9 a pending attestation is exit 2; a shell without one keeps the 0.4.5 result', async () => {
  resetWorld();
  const pending = await run({ ...shellFor('x'), public_attestation: { status: 'pending' } });
  expectExit(pending, 2, 'public_attestation_pending');
  const none = shellFor('x');
  delete none.public_attestation;
  assert.equal(await run(none), null);
});

test('M7 signature and key trust: stranger key, tamper, revoked key, window', async () => {
  resetWorld();
  const claims = baseClaims();
  expectExit(await run(shellFor(attest(stranger, claims))), 1, 'key untrusted');
  const good = attest(key, claims);
  const [h, p, s] = good.split('.');
  const flipped = Buffer.from(s, 'base64url');
  flipped[5] ^= 1;
  expectExit(await run(shellFor(`${h}.${p}.${flipped.toString('base64url')}`)), 1, 'signature_invalid');
  // Payload swapped under a valid signature.
  const otherPayload = b64(`${TAG}\n${jcsCanonicalize({ ...claims, payment: { ...claims.payment, settled_amount: '1' } })}`);
  expectExit(await run(shellFor(`${h}.${otherPayload}.${s}`)), 1, 'signature_invalid');
  // A kid header that names a history key but a jwk with another thumbprint.
  const forged = historyDoc(key);
  forged.entries[0].jwk = { ...stranger.publicJwk, kid: key.kid };
  expectExit(await run(shellFor(good), { history: forged }), 1, 'key untrusted');
  // Revoked key.
  expectExit(await run(shellFor(good), { history: historyDoc(key, { revokedAt: '2026-12-01T00:00:00.000Z' }) }), 1, 'key_window');
  // Attested before the key's not_before (inside the minute counts).
  expectExit(await run(shellFor(good), { history: historyDoc(key, { notBefore: '2026-10-17T18:30:30.000Z' }) }), 1, 'key_window');
  // No history: exit 2, not a pass.
  expectExit(await run(shellFor(good), { history: null }), 2, 'issuer_history_unavailable');
  // A history that failed to verify: exit 1.
  expectExit(await run(shellFor(good), { historyInvalidReason: 'issuer_history_not_extension' }), 1, 'issuer_history_not_extension');
});

test('M8 the chain must hold exactly one matching USDC transfer of the signed settled amount', async () => {
  const jws = attest(key, baseClaims());
  const transfer = (over = {}) => ({ address: USDC, topics: [TRANSFER, topic(PAYER), topic(PAYEE)], data: amountHex(2000), ...over });
  const fails = {
    amount: [transfer({ data: amountHex(1999) })],
    payee: [transfer({ topics: [TRANSFER, topic(PAYER), topic(PAYER)] })],
    asset: [transfer({ address: PAYER })],
    zero: [],
    two: [transfer(), transfer()],
  };
  for (const [name, logs] of Object.entries(fails)) {
    resetWorld();
    world.payReceipt = { ...world.payReceipt, logs };
    expectExit(await run(shellFor(jws)), 1, 'transfer_mismatch');
    assert.equal((await run(shellFor(jws))).checks.payment_binding, 'fail', name);
  }
  resetWorld();
  world.payReceipt = { ...world.payReceipt, status: '0x0' };
  expectExit(await run(shellFor(jws)), 1, 'transfer_mismatch');

  // Could not check: null receipt, shallow, RPC down, no status.
  resetWorld();
  world.payReceipt = null;
  expectExit(await run(shellFor(jws)), 2, 'payer_unchecked');
  resetWorld();
  world.tip = '0x66';
  expectExit(await run(shellFor(jws)), 2);
  resetWorld();
  world.payReceipt = { ...world.payReceipt, status: undefined };
  expectExit(await run(shellFor(jws)), 2, 'payer_unchecked');
  resetWorld();
  world.rpcDown = true;
  expectExit(await run(shellFor(jws)), 2);
});

test('verifyIssuerJws and the head trust path refuse the attestation typ', async () => {
  const jws = attest(key, baseClaims());
  const direct = verifyIssuerJws(jws, key.publicJwk);
  assert.equal(direct.valid, false);
  assert.equal(direct.reason, 'typ_mismatch');
  const asHead = { root, tree_size: 2, issuer_signature: { jws, kid: key.kid, issuer_jwk: key.publicJwk } };
  assert.equal(verifyTreeHeadTrust(asHead, { trustedKids: [key.kid], jwks: { keys: [key.publicJwk] } }).ok, false);
  const asReceipt = { task_id: TASK, issuer_signature: { alg: 'ES256', jws, kid: key.kid, issuer_jwk: key.publicJwk } };
  const result = await lib.verifyReceipt(asReceipt, { trustedKids: [key.kid], jwks: { keys: [key.publicJwk] }, skipIssuerHistory: true, requirePreimages: false });
  assert.notEqual(result.overall, 'verified');
  assert.notEqual(result.issuer_signature.valid, true);
});

test('M9 a holder document never takes the public path, valid or not', async () => {
  resetWorld();
  const holderClaims = { task_id: TASK, iss: 'chit402', iat: 1792268940, payment: { rail: 'usdc', ref: `base:${PAY_TX}` }, payload_version: 6 };
  const holderJws = signRaw(key, { alg: 'ES256', typ: 'chit402-receipt+jwt', kid: key.kid }, JSON.stringify(holderClaims));
  const attestation = attest(key, baseClaims());
  const dir = mkdtempSync(path.join(tmpdir(), 'chit-pub-holder-'));
  for (const jws of [holderJws, `${holderJws.slice(0, -4)}AAAA`]) {
    const doc = { ...holderClaims, issuer_signature: { alg: 'ES256', jws, kid: key.kid }, public_attestation: { jws: attestation } };
    const file = path.join(dir, 'holder.json');
    writeFileSync(file, JSON.stringify(doc));
    const out = await checkReceiptInput(file, { trustedKids: [key.kid] });
    assert.equal(out.verdict.scope, undefined);
    assert.notEqual(out.verdict.result, 'verified_public');
    assert.notEqual(out.verdict.result, 'verified');
  }
});

test('CLI exit codes: malformed is 1, pending is 2, no attestation is the 0.4.5 exit 2', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'chit-pub-cli-'));
  const write = (name, body) => { const f = path.join(dir, name); writeFileSync(f, JSON.stringify(body)); return f; };
  const env = { ...process.env, BASE_RPC_URL: 'http://127.0.0.1:9/', SOLANA_RPC_URL: 'http://127.0.0.1:9/' };
  const cliRun = (file) => spawnSync(process.execPath, [cli, file, '--json'], { encoding: 'utf8', timeout: 30000, env });

  const bad = cliRun(write('bad.json', { ...shellFor('x'), public_attestation: { jws: 'a.b.c' } }));
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.equal(JSON.parse(bad.stdout).reason, 'invalid_jws');

  const untagged = cliRun(write('untagged.json', shellFor(attest(key, baseClaims(), { payload: jcsCanonicalize(baseClaims()) }))));
  assert.equal(untagged.status, 1, untagged.stdout + untagged.stderr);

  // A well-formed attestation under a key the bundled history does not hold.
  const strangerRun = cliRun(write('stranger.json', shellFor(attest(stranger, baseClaims()))));
  assert.equal(strangerRun.status, 1, strangerRun.stdout + strangerRun.stderr);
  assert.equal(JSON.parse(strangerRun.stdout).reason, 'key untrusted');

  const pending = cliRun(write('pending.json', { ...shellFor('x'), public_attestation: { status: 'pending' } }));
  assert.equal(pending.status, 2, pending.stdout + pending.stderr);
  assert.equal(JSON.parse(pending.stdout).reason, 'public_attestation_pending');

  const plain = shellFor('x');
  delete plain.public_attestation;
  const none = cliRun(write('none.json', plain));
  assert.equal(none.status, 2, none.stdout + none.stderr);
  assert.equal(JSON.parse(none.stdout).reason, 'signed_receipt_unavailable');
});

test('exact allowlists are exported and pinned', () => {
  assert.deepEqual([...lib.PUBLIC_RECEIPT_CLAIM_KEYS], ['attested_at', 'iss', 'issued_at', 'log', 'payment', 'task_id']);
  assert.deepEqual([...lib.PUBLIC_RECEIPT_PAYMENT_KEYS], ['asset', 'gross_amount', 'payee', 'rail', 'ref', 'settled_amount']);
  assert.deepEqual([...lib.PUBLIC_RECEIPT_LOG_KEYS], ['epoch', 'leaf_hash', 'leaf_index']);
  assert.equal(lib.PUBLIC_RECEIPT_TAG, TAG);
  assert.equal(lib.PUBLIC_RECEIPT_TYP, TYP);
  const payload = lib.publicReceiptPayload(baseClaims());
  assert.ok(payload.startsWith(`${TAG}\n{`));
  assert.throws(() => JSON.parse(payload));
  assert.throws(() => lib.publicReceiptPayload({ ...baseClaims(), payload_version: 1 }));
});

test('no POST leaves loopback and every GET is a log read', async () => {
  resetWorld();
  await run(shellFor(attest(key, baseClaims())));
  assert.ok(world.posts > 0);
  for (const url of world.gets) assert.match(url, /^\/v1\/receipts\//);
  assert.match(process.env.BASE_RPC_URL, /^http:\/\/127\.0\.0\.1:/);
});

test('Base only: a signed Solana attestation is exit 2, a forged one exit 1', async () => {
  resetWorld();
  const sol = baseClaims({
    payment: {
      asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', gross_amount: '2000',
      payee: 'BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD', rail: 'usdc',
      ref: `solana:${'5'.repeat(87)}`, settled_amount: '2000',
    },
  });
  const v = await run({ ...shellFor(attest(key, sol)), chain: 'solana', pay_to: null, payment_tx: null, asset: null });
  expectExit(v, 2, 'public_rail_unsupported');
  expectExit(await run({ ...shellFor(attest(stranger, sol)) }), 1, 'key untrusted');
});
