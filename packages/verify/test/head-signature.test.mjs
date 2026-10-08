/**
 * Anchor mode fails closed unless the tree head is signed by a trusted
 * issuer key and the chain sender matches that signature.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const { verifyAnchoredRoot, SOLANA_GENESIS } = await import('../dist/anchor-witness.js');
const { verifyReceipt } = await import('../dist/index.js');
const {
  PINNED_BASE_ANCHOR_WALLET,
  PINNED_SOLANA_ANCHOR_FEE_PAYER,
  verifyTreeHeadTrust,
} = await import('../dist/anchor-trust.js');
const { issuerHistoryEntryHash } = await import('../dist/issuer-history.js');
const { jwkThumbprint: thumb } = await import('../dist/jws.js');

function b64url(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(json).toString('base64url');
}

function issuerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const kid = thumb(exported);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  return { privateKey, kid, publicJwk };
}

function signClaims(claims, key, typ) {
  const header = { alg: 'ES256', typ, kid: key.kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${signature.toString('base64url')}`;
}

function sealHead(head, key) {
  const { issuer_signature: _ignored, ...rest } = head;
  const claims = JSON.parse(JSON.stringify(rest));
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-tree-head+jwt',
      jws: signClaims(claims, key, 'chit402-tree-head+jwt'),
      kid: key.kid,
      issuer_jwk: key.publicJwk,
    },
  };
}

function fixture() {
  const taskId = 'task-1';
  const rowHash = 'row-hash-1';
  const leaf = createHash('sha256').update(Buffer.concat([Buffer.from([0x00]), Buffer.from(`${taskId}|${rowHash}`)])).digest();
  const sibling = createHash('sha256').update(Buffer.concat([Buffer.from([0x00]), Buffer.from('genesis')])).digest();
  const root = createHash('sha256').update(Buffer.concat([Buffer.from([0x01]), sibling, leaf])).digest('hex');
  const prev = '0'.repeat(64);
  const memo = `chit402:root:v1:global:2026-09-30:${root}:${prev}`;
  const key = issuerKey();
  const head = sealHead({
    schema: 'chit402.tree_head.v1',
    payload_version: 1,
    root,
    tree_size: 2,
    anchors: {
      base: {
        status: 'anchored',
        tx: `0x${'ab'.repeat(32)}`,
        calldata: `0x${root}`,
        chain_id: 8453,
        from: PINNED_BASE_ANCHOR_WALLET,
      },
      solana: {
        status: 'anchored',
        signature: 'sig1',
        slot: 99,
        cluster: 'devnet',
        memo,
        fee_payer: PINNED_SOLANA_ANCHOR_FEE_PAYER,
      },
    },
  }, key);
  const receipt = { task_id: taskId, row_hash: rowHash };
  const inclusion = {
    task_id: taskId,
    leaf_index: 1,
    tree_size: 2,
    root,
    leaf: leaf.toString('hex'),
    proof: [{ hash: sibling.toString('hex'), position: 'left' }],
  };
  const solanaTx = {
    slot: 99,
    meta: { err: null },
    transaction: {
      message: {
        accountKeys: [{ pubkey: PINNED_SOLANA_ANCHOR_FEE_PAYER, signer: true }],
        instructions: [{ program: 'spl-memo', parsed: memo }],
      },
    },
  };
  const baseTx = {
    hash: head.anchors.base.tx,
    input: `0x${root}`,
    chainId: 8453,
    from: PINNED_BASE_ANCHOR_WALLET,
  };
  return { key, head, receipt, inclusion, solanaTx, baseTx, root };
}

function run(fx, { head = fx.head, trustedKids = [fx.key.kid], baseTx = fx.baseTx, solanaTx = fx.solanaTx, jwks, issuerHistory } = {}) {
  return verifyAnchoredRoot({
    receipt: fx.receipt,
    inclusion: fx.inclusion,
    head,
    trustedKids,
    jwks,
    issuerHistory,
    fetchSolanaTx: async () => solanaTx,
    fetchGenesis: async () => SOLANA_GENESIS.devnet,
    fetchBaseTx: async () => baseTx,
  });
}

test('a head with the issuer signature removed does not verify', async () => {
  const fx = fixture();
  const stripped = { ...fx.head };
  delete stripped.issuer_signature;
  const result = await run(fx, { head: stripped });
  assert.equal(result.overall, 'failed');
  assert.equal(result.head_signature.valid, false);
  assert.equal(result.head_signature.reason, 'head_signature_missing');
  assert.match(result.head_signature.message, /issuer_signature/);
  assert.equal(result.errors.includes('head_signature_missing'), true);
  assert.notEqual(result.overall, 'verified');
});

test('a forged tree-head signature does not verify', async () => {
  const fx = fixture();
  const parts = fx.head.issuer_signature.jws.split('.');
  // A 64-byte ES256 signature is 86 base64url characters. The last character
  // holds only two payload bits, so changing it can leave the signature valid.
  // Flip a character in the middle, where every bit is signed data.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const chars = parts[2].split('');
  const at = 10;
  const cur = alphabet.indexOf(chars[at]);
  chars[at] = alphabet[(cur + 8) % alphabet.length];
  const forged = {
    ...fx.head,
    issuer_signature: { ...fx.head.issuer_signature, jws: `${parts[0]}.${parts[1]}.${chars.join('')}` },
  };
  const result = await run(fx, { head: forged });
  assert.equal(result.overall, 'failed');
  assert.equal(result.head_signature.reason, 'head_signature_invalid');
  assert.match(result.head_signature.message, /not a valid ES256/);
});

test('a tree head signed by an untrusted kid does not verify', async () => {
  const fx = fixture();
  const other = issuerKey();
  const result = await run(fx, {
    trustedKids: [other.kid],
    jwks: { keys: [other.publicJwk] },
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.head_signature.reason, 'head_key_untrusted');
  assert.match(result.head_signature.message, /not trusted/);
});

test('a Base anchor sent by another wallet does not verify', async () => {
  const fx = fixture();
  const result = await run(fx, {
    baseTx: { ...fx.baseTx, from: '0x1111111111111111111111111111111111111111' },
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.base.reason, 'sender_mismatch');
  assert.equal(result.errors.includes('base:sender_mismatch'), true);
  assert.match(result.errors.join(' '), /sender_mismatch/);
});

test('a Solana memo paid by another fee payer does not verify', async () => {
  const fx = fixture();
  const other = '11111111111111111111111111111111';
  const result = await run(fx, {
    solanaTx: {
      ...fx.solanaTx,
      transaction: {
        message: {
          ...fx.solanaTx.transaction.message,
          accountKeys: [{ pubkey: other, signer: true }],
        },
      },
    },
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.solana.reason, 'fee_payer_mismatch');
  assert.equal(result.errors.includes('solana:fee_payer_mismatch'), true);
});

test('a signed head that names an unlisted wallet does not verify', async () => {
  const fx = fixture();
  const stranger = '0x2222222222222222222222222222222222222222';
  const head = sealHead({
    ...fx.head,
    anchors: {
      ...fx.head.anchors,
      base: { ...fx.head.anchors.base, from: stranger },
    },
  }, fx.key);
  const result = await run(fx, {
    head,
    baseTx: { ...fx.baseTx, from: stranger },
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.errors.includes('anchor_sender_unlisted'), true);
});

test('a kid that is only in verified issuer history can sign the head', async () => {
  const current = issuerKey();
  const retired = issuerKey();
  const retiredBody = {
    kid: retired.kid,
    jwk: retired.publicJwk,
    alg: 'ES256',
    not_before: '2026-09-04T08:52:05Z',
    not_after: null,
    status: 'retired',
    revoked_at: null,
    reason: null,
    custody: 'test',
    prev_hash: null,
  };
  const retiredHash = issuerHistoryEntryHash(retiredBody);
  const currentBody = {
    kid: current.kid,
    jwk: current.publicJwk,
    alg: 'ES256',
    not_before: '2026-09-04T08:52:05Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'test',
    prev_hash: retiredHash,
  };
  const currentHash = issuerHistoryEntryHash(currentBody);
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: 2,
    head_hash: currentHash,
  };
  const history = {
    schema: 'chit402.issuer_history.v1',
    entries: [
      { ...retiredBody, entry_hash: retiredHash },
      { ...currentBody, entry_hash: currentHash },
    ],
    head_hash: currentHash,
    issuer_signature: {
      jws: signClaims(claims, current, 'chit402-issuer-history+jwt'),
      kid: current.kid,
      issuer_jwk: current.publicJwk,
    },
  };
  const fx = fixture();
  const head = sealHead({
    ...fx.head,
    published_at: '2026-10-03T11:33:37.000Z',
  }, retired);
  delete head.issuer_signature.issuer_jwk;
  const trusted = verifyTreeHeadTrust(head, {
    trustedKids: [current.kid],
    issuerHistory: history,
  });
  assert.equal(trusted.ok, true, trusted.message || trusted.reason);
  assert.equal(trusted.trust, 'issuer_history');
  const result = await run(fx, {
    head,
    trustedKids: [current.kid],
    issuerHistory: history,
  });
  assert.equal(result.overall, 'verified', result.errors.join(','));
  assert.equal(result.head_signature.trust, 'issuer_history');
});

function historyFor(key, { status = 'active', not_after = null, revoked_at = null } = {}) {
  const body = {
    kid: key.kid,
    jwk: key.publicJwk,
    alg: 'ES256',
    not_before: '2026-09-04T08:52:05Z',
    not_after,
    status,
    revoked_at,
    reason: null,
    custody: 'test',
    prev_hash: null,
  };
  const entryHash = issuerHistoryEntryHash(body);
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: 1,
    head_hash: entryHash,
  };
  return {
    schema: 'chit402.issuer_history.v1',
    entries: [{ ...body, entry_hash: entryHash }],
    head_hash: entryHash,
    issuer_signature: {
      jws: signClaims(claims, key, 'chit402-issuer-history+jwt'),
      kid: key.kid,
      issuer_jwk: key.publicJwk,
    },
  };
}

test('a v1 head with no published_at still verifies for an active kid', () => {
  const key = issuerKey();
  const fx = fixture();
  const unsigned = { ...fx.head };
  delete unsigned.issuer_signature;
  delete unsigned.published_at;
  const head = sealHead(unsigned, key);
  delete head.published_at;
  const trusted = verifyTreeHeadTrust(head, {
    trustedKids: [key.kid],
    issuerHistory: historyFor(key),
  });
  assert.equal(trusted.ok, true, trusted.message || trusted.reason);
  assert.notEqual(trusted.reason, 'issued_at_missing');
});

test('a closed head that signs published_at null is not issued_at_missing', () => {
  const key = issuerKey();
  const fx = fixture();
  const unsigned = { ...fx.head };
  delete unsigned.issuer_signature;
  const head = sealHead({ ...unsigned, published_at: null }, key);
  const trusted = verifyTreeHeadTrust(head, {
    trustedKids: [key.kid],
    issuerHistory: historyFor(key),
  });
  assert.equal(trusted.ok, true, trusted.message || trusted.reason);
  assert.equal(head.published_at, null);
});

test('a revoked kid with no published_at fails closed', () => {
  const key = issuerKey();
  const fx = fixture();
  const unsigned = { ...fx.head };
  delete unsigned.issuer_signature;
  const head = sealHead({ ...unsigned, published_at: null }, key);
  const trusted = verifyTreeHeadTrust(head, {
    trustedKids: [key.kid],
    issuerHistory: historyFor(key, {
      status: 'revoked',
      revoked_at: '2026-10-01T00:00:00Z',
    }),
  });
  assert.equal(trusted.ok, false);
  assert.equal(trusted.reason, 'published_at_missing');
});

test('a published_at before not_before still fails the kid window', () => {
  const key = issuerKey();
  const fx = fixture();
  const unsigned = { ...fx.head };
  delete unsigned.issuer_signature;
  const head = sealHead({ ...unsigned, published_at: '2026-01-01T00:00:00Z' }, key);
  const trusted = verifyTreeHeadTrust(head, {
    trustedKids: [key.kid],
    issuerHistory: historyFor(key),
  });
  assert.equal(trusted.ok, false);
  assert.equal(trusted.reason, 'head_kid_window');
  assert.match(trusted.message, /issued_before_not_before/);
});

function historyFetch(body) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return { ok: true, text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}

test('offline verifyReceipt rejects a head whose issuer signature was removed', async () => {
  const fx = fixture();
  const stripped = { ...fx.head };
  delete stripped.issuer_signature;
  const result = await verifyReceipt(fx.receipt, {
    head: stripped,
    trustedKids: [fx.key.kid],
    requirePreimages: false,
    skipIssuerHistory: true,
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.errors.includes('head_signature_missing'), true, result.errors.join(','));
  assert.notEqual(result.overall, 'verified');
});

test('offline head trust uses issuer history fetched for the receipt', async () => {
  const current = issuerKey();
  const retired = issuerKey();
  const retiredBody = {
    kid: retired.kid,
    jwk: retired.publicJwk,
    alg: 'ES256',
    not_before: '2026-09-04T08:52:05Z',
    not_after: null,
    status: 'retired',
    revoked_at: null,
    reason: null,
    custody: 'test',
    prev_hash: null,
  };
  const retiredHash = issuerHistoryEntryHash(retiredBody);
  const currentBody = {
    kid: current.kid,
    jwk: current.publicJwk,
    alg: 'ES256',
    not_before: '2026-09-04T08:52:05Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'test',
    prev_hash: retiredHash,
  };
  const currentHash = issuerHistoryEntryHash(currentBody);
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: 2,
    head_hash: currentHash,
  };
  const history = {
    schema: 'chit402.issuer_history.v1',
    entries: [
      { ...retiredBody, entry_hash: retiredHash },
      { ...currentBody, entry_hash: currentHash },
    ],
    head_hash: currentHash,
    issuer_signature: {
      jws: signClaims(claims, current, 'chit402-issuer-history+jwt'),
      kid: current.kid,
      issuer_jwk: current.publicJwk,
    },
  };
  const fx = fixture();
  const head = sealHead({
    ...fx.head,
    published_at: '2026-10-03T11:33:37.000Z',
  }, retired);
  delete head.issuer_signature.issuer_jwk;
  const receipt = {
    ...fx.receipt,
    verify_url: 'https://api.chit402.com/receipt/offline-head',
  };
  const fetched = historyFetch(history);
  const result = await verifyReceipt(receipt, {
    head,
    trustedKids: [current.kid],
    requirePreimages: false,
    fetchIssuerHistory: true,
    fetchImpl: fetched.fetchImpl,
  });
  assert.equal(fetched.calls.length, 1);
  assert.match(fetched.calls[0], /\/\.well-known\/issuer-history\.json$/);
  assert.equal(result.overall, 'partial', result.errors.join(','));
  assert.equal(result.errors.includes('head_key_untrusted'), false);
  assert.equal(result.errors.includes('head_signature_missing'), false);
  assert.equal(result.errors.includes('issuer_history_invalid'), false);

  const ignored = await verifyReceipt(receipt, {
    head,
    trustedKids: [current.kid],
    requirePreimages: false,
    skipIssuerHistory: true,
  });
  assert.equal(ignored.overall, 'failed');
  assert.equal(ignored.errors.includes('head_key_untrusted'), true, ignored.errors.join(','));

  const stripped = { ...head };
  delete stripped.issuer_signature;
  const unsigned = await verifyReceipt(receipt, {
    head: stripped,
    trustedKids: [current.kid],
    requirePreimages: false,
    fetchIssuerHistory: true,
    fetchImpl: historyFetch(history).fetchImpl,
  });
  assert.equal(unsigned.overall, 'failed');
  assert.equal(unsigned.errors.includes('head_signature_missing'), true, unsigned.errors.join(','));
  assert.notEqual(unsigned.overall, 'verified');
});

test('a fetched issuer history that does not verify cannot pin-trust the head', async () => {
  const fx = fixture();
  const receipt = {
    ...fx.receipt,
    verify_url: 'https://api.chit402.com/receipt/offline-head',
  };
  const pinned = await verifyReceipt(receipt, {
    head: fx.head,
    trustedKids: [fx.key.kid],
    requirePreimages: false,
    skipIssuerHistory: true,
  });
  assert.notEqual(pinned.overall, 'failed', pinned.errors.join(','));
  assert.equal(pinned.errors.includes('head_signature_invalid'), false);

  const fetched = historyFetch({ schema: 'forged' });
  const forged = await verifyReceipt(receipt, {
    head: fx.head,
    trustedKids: [fx.key.kid],
    requirePreimages: false,
    fetchIssuerHistory: true,
    fetchImpl: fetched.fetchImpl,
  });
  assert.equal(fetched.calls.length, 1);
  assert.equal(forged.overall, 'failed');
  assert.equal(forged.errors.includes('issuer_history_invalid'), true, forged.errors.join(','));
  assert.notEqual(forged.overall, 'verified');
});
