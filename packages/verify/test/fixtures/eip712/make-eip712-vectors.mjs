/**
 * Writes eip712-vectors.json: fixed-head and payer-binding objects signed by
 * the gateway's own code (services/gateway/src) under the synthetic test
 * key. Test material only. No network, no chain, no production key.
 *
 *   node packages/verify/test/fixtures/eip712/make-eip712-vectors.mjs
 *
 * Needs services/gateway dependencies installed. The tests only read the
 * JSON; they never run this script.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticIssuerKey } from '../slot-typing/synthetic-key.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const gateway = path.resolve(here, '../../../../../services/gateway');
const E = await import(path.join(gateway, 'src/eip712-p256.js'));
const T = await import(path.join(gateway, 'src/tree-head-eip712.js'));
const B = await import(path.join(gateway, 'src/receipt-binding-eip712.js'));
const { leafHashOf } = await import(path.join(gateway, 'src/public-attestation.js'));
const shared = JSON.parse(fs.readFileSync(path.join(gateway, 'test/fixtures/escrow-eip712-vectors.json'), 'utf8'));
const b1 = JSON.parse(fs.readFileSync(path.join(gateway, 'test/fixtures/payer-binding-b1-main.json'), 'utf8'));
const B1_SHA256 = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(gateway, 'test/fixtures/payer-binding-b1-main.json'), 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex');

const KEY = syntheticIssuerKey();
const signer = {
  kind: 'env',
  kid: KEY.kid,
  publicJwk: KEY.publicJwk,
  async sign(input) {
    return crypto.sign('sha256', Buffer.from(input), { key: KEY.privateKey, dsaEncoding: 'ieee-p1363' });
  },
};
const logIdentity = { epoch1_root: shared.log_id.epoch1_root, genesis_digest: shared.log_id.genesis_digest };

// Fixed head over the shared live-shape head (epoch 2, size 39).
const sharedHead = shared.tree_head.vectors[0];
const headClaims = {
  epoch: sharedHead.message.epoch,
  tree_size: sharedHead.message.tree_size,
  root: sharedHead.message.root.slice(2),
  published_at: sharedHead.published_at_iso,
};
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eip712-vectors-'));
const signedHead = await T.signFixedHead(headClaims, {
  ready: { ok: true },
  logIdentity,
  currentEpoch: headClaims.epoch,
  leafCount: headClaims.tree_size,
  rootAt: () => headClaims.root,
  quarantined: [],
  store: T.openFixedHeadStore(storeDir),
  kid: KEY.kid,
  signer,
});
fs.rmSync(storeDir, { recursive: true, force: true });
if (!signedHead.fixed_head) throw new Error(`fixed head refused: ${signedHead.refused}`);
if (!T.verifyFixedHead(signedHead.fixed_head, KEY.publicJwk).ok) throw new Error('fixed head self-check');

// Payer binding over the B1 golden holder claims.
const claims = JSON.parse(Buffer.from(b1.holder_jws.split('.')[1], 'base64url').toString('utf8'));
const payerSalt = crypto.createHash('sha256').update('chit402 eip712 vector payer salt v1').digest();
const leaf = leafHashOf(claims.task_id, b1.row_hash);
const signedBinding = await B.signReceiptBinding({
  leafHash: leaf,
  claims,
  ctx: { ready: { ok: true }, logIdentity, kid: KEY.kid, signer, randomBytes: () => Buffer.from(payerSalt) },
});
if (!signedBinding.record) throw new Error(`binding refused: ${signedBinding.refused}`);
const { binding, payer_salt } = signedBinding.record;
if (!B.verifyBinding(binding, payer_salt, claims.caller_binding.payer_wallet, KEY.publicJwk).ok) {
  throw new Error('binding self-check');
}

// The same binding signed over a chainId 8453 domain (wrong chain), using the
// gateway encoder with the domain separator swapped.
function wrongChainSignature(kind, message, name) {
  const digest = E.typedDigest(kind, message, E.EXPECTED_LOG_SALT);
  const word = (n) => Buffer.from(BigInt(n).toString(16).padStart(64, '0'), 'hex');
  const hex = (h) => Buffer.from(h.replace(/^0x/, ''), 'hex');
  const sep = E.keccakHex(Buffer.concat([
    hex(E.EIP712_DOMAIN_TYPEHASH),
    hex(E.keccakHex(Buffer.from(name, 'utf8'))),
    hex(E.keccakHex(Buffer.from(E.EIP712_DOMAIN_VERSION, 'utf8'))),
    word(8453),
    hex(E.EXPECTED_LOG_SALT),
  ]));
  const preimage = Buffer.concat([Buffer.from([0x19, 0x01]), hex(sep), digest.preimage.subarray(34)]);
  const raw = crypto.sign('sha256', preimage, { key: KEY.privateKey, dsaEncoding: 'ieee-p1363' });
  return {
    domain_separator_8453: sep,
    r: `0x${raw.subarray(0, 32).toString('hex')}`,
    s: `0x${raw.subarray(32).toString('hex')}`,
  };
}

const out = {
  schema: 'chit402.verify_eip712_vectors.v1',
  note: 'Signed by services/gateway/src under the synthetic test key (test/fixtures/slot-typing/synthetic-key.mjs). Test material only.',
  generated_by: 'packages/verify/test/fixtures/eip712/make-eip712-vectors.mjs',
  key: { kid: KEY.kid, kid_bytes32: E.kidBytes32(KEY.kid), public_jwk: KEY.publicJwk },
  constants: {
    chain_id: E.EIP712_CHAIN_ID,
    log_salt: E.EXPECTED_LOG_SALT,
    domain_typehash: E.EIP712_DOMAIN_TYPEHASH,
    tree_head_typehash: E.TREE_HEAD_TYPEHASH,
    receipt_binding_typehash: E.RECEIPT_BINDING_TYPEHASH,
    tree_head_domain_separator: E.domainSeparator(E.TREE_HEAD_DOMAIN_NAME, E.EXPECTED_LOG_SALT),
    receipt_binding_domain_separator: E.domainSeparator(E.RECEIPT_BINDING_DOMAIN_NAME, E.EXPECTED_LOG_SALT),
    payer_commitment_tag: E.PAYER_COMMITMENT_TAG,
    base_usdc_asset_id: E.BASE_USDC_ASSET_ID,
  },
  fixed_head: {
    head_claims: headClaims,
    object: signedHead.fixed_head,
    preimage: `0x${E.typedDigest('TreeHead', signedHead.fixed_head.message, E.EXPECTED_LOG_SALT).preimage.toString('hex')}`,
    wrong_chain: wrongChainSignature('TreeHead', signedHead.fixed_head.message, E.TREE_HEAD_DOMAIN_NAME),
  },
  payer_binding: {
    source: 'services/gateway/test/fixtures/payer-binding-b1-main.json',
    source_sha256: B1_SHA256,
    holder_jws: b1.holder_jws,
    row_hash: b1.row_hash,
    leaf_hash: leaf,
    object: binding,
    payer_salt,
    preimage: `0x${E.typedDigest('ReceiptBinding', binding.message, E.EXPECTED_LOG_SALT).preimage.toString('hex')}`,
    wrong_chain: wrongChainSignature('ReceiptBinding', binding.message, E.RECEIPT_BINDING_DOMAIN_NAME),
  },
};
fs.writeFileSync(path.join(here, 'eip712-vectors.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log('wrote eip712-vectors.json');
