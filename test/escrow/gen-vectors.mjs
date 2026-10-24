#!/usr/bin/env node
// Builds the shared test vectors for contracts/escrow (and for the gateway
// fixed-head and binding signers). Offline only: throwaway P-256 keys made
// here, gateway Merkle code imported from services/gateway/src, no network.
//
//   node test/escrow/gen-vectors.mjs           write vectors/*.json
//   node test/escrow/gen-vectors.mjs --check   recompute deterministic fields and verify signatures
//
// Needs services/gateway/node_modules (npm ci in services/gateway).
// The Wycheproof subset is read from a local copy of
// testvectors_v1/ecdsa_secp256r1_sha256_p1363_test.json (C2SP/wycheproof),
// passed with --wycheproof <path>; without it the existing subset file is kept.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const gwRequire = createRequire(path.join(repo, 'services/gateway/package.json'));
const { ethers } = gwRequire('ethers');
const merkle = await import(path.join(repo, 'services/gateway/src/receipt-merkle.js'));

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const wyIdx = args.indexOf('--wycheproof');
const WY_PATH = wyIdx >= 0 ? args[wyIdx + 1] : null;
const outDir = path.join(here, 'vectors');

const coder = ethers.AbiCoder.defaultAbiCoder();
const k256 = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const sha256 = (b) => '0x' + crypto.createHash('sha256').update(Buffer.from(ethers.getBytes(b))).digest('hex');
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

// ---- constants (brief section (a) and (h)) ----
const CHAIN_ID = 84532;
const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,bytes32 salt)';
const TREEHEAD_TYPE = 'TreeHead(uint32 epoch,uint64 tree_size,bytes32 root,uint64 published_at,bytes32 kid)';
const BINDING_TYPE = 'ReceiptBinding(bytes32 leaf_hash,bytes32 payer_commitment,uint64 amount_atomic,bytes32 asset_id,bytes32 kid)';
const pin = JSON.parse(fs.readFileSync(path.join(repo, 'services/gateway/receipt-log-pin.json'), 'utf8'));
const e1 = pin.epochs.find((e) => e.epoch === 1);
const LOG_SALT = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes('chit402.receipt-log.v1'), '0x' + e1.root, '0x' + e1.genesis_digest]));

function domainSeparator(name, version, chainId, salt) {
  return ethers.keccak256(coder.encode(['bytes32', 'bytes32', 'bytes32', 'uint256', 'bytes32'],
    [k256(DOMAIN_TYPE), k256(name), k256(version), chainId, salt]));
}
const TH_DOM = domainSeparator('Chit402TreeHead', '1', CHAIN_ID, LOG_SALT);
const B_DOM = domainSeparator('Chit402ReceiptBinding', '1', CHAIN_ID, LOG_SALT);

function headStructHash(h) {
  return ethers.keccak256(coder.encode(['bytes32', 'uint32', 'uint64', 'bytes32', 'uint64', 'bytes32'],
    [k256(TREEHEAD_TYPE), h.epoch, h.tree_size, h.root, h.published_at, h.kid]));
}
function bindingStructHash(b) {
  return ethers.keccak256(coder.encode(['bytes32', 'bytes32', 'bytes32', 'uint64', 'bytes32', 'bytes32'],
    [k256(BINDING_TYPE), b.leaf_hash, b.payer_commitment, b.amount_atomic, b.asset_id, b.kid]));
}
const preimage = (dom, sh) => ethers.concat(['0x1901', dom, sh]);

function b64urlToHex(s) { return '0x' + Buffer.from(s, 'base64url').toString('hex'); }
function thumbprint(jwk) {
  const json = `{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`;
  return '0x' + crypto.createHash('sha256').update(json).digest('hex');
}

// ---- eip712.json ----
function buildEip712(prev) {
  const PROD = {
    kid_b64url: 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q',
    x: '0xfc7ec9f67897176b5ecff327176e699eb0cdee227f542f600736185bd83348f9',
    y: '0x8e2a2b7d173dc2d35a4666851ec41a5cdcdc5ad794034467a6f0f8496755977e',
  };
  PROD.kid = b64urlToHex(PROD.kid_b64url);
  const prodTp = thumbprint({ x: Buffer.from(PROD.x.slice(2), 'hex').toString('base64url'), y: Buffer.from(PROD.y.slice(2), 'hex').toString('base64url') });
  if (prodTp !== PROD.kid) throw new Error('production thumbprint mismatch');

  const worked = { epoch: 2, tree_size: 39, root: '0x3471f0bafad7a6304773db19dfaf8edf1902c7aff3a826f7fee6ce1a88c2fb05', published_at: 1792800046, kid: PROD.kid };
  const workedStruct = headStructHash(worked);
  const workedE = sha256(preimage(TH_DOM, workedStruct));

  // Throwaway key: reuse the stored public key and signatures when present so
  // the file is stable; --check verifies them instead of re-signing.
  let tk = prev?.throwaway;
  if (!tk) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const kid = thumbprint(jwk);
    const head = { epoch: 7, tree_size: 5, root: sha256('0x' + Buffer.from('chit402 escrow vector root').toString('hex')), published_at: 1792800046, kid };
    const payer = '0x1111111111111111111111111111111111111111';
    const payerSalt = sha256('0x' + Buffer.from('chit402 escrow vector payer salt').toString('hex'));
    const payerCommitment = ethers.keccak256(coder.encode(['bytes32', 'address', 'bytes32'], [k256('chit402.payer-commitment.v1'), payer, payerSalt]));
    const binding = { leaf_hash: sha256('0x00' + Buffer.from('task|row').toString('hex')), payer_commitment: payerCommitment, amount_atomic: 2000, asset_id: k256('eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'), kid };
    const sign = (m) => {
      const sig = crypto.sign('sha256', Buffer.from(ethers.getBytes(m)), { key: privateKey, dsaEncoding: 'ieee-p1363' });
      let r = BigInt('0x' + sig.subarray(0, 32).toString('hex'));
      let s = BigInt('0x' + sig.subarray(32).toString('hex'));
      if (s > N / 2n) s = N - s; // low-S, as the gateway signer will emit
      return { r: ethers.toBeHex(r, 32), s: ethers.toBeHex(s, 32) };
    };
    tk = {
      note: 'Throwaway P-256 key generated by gen-vectors.mjs. Private key discarded. Not the issuer key.',
      x: b64urlToHex(jwk.x), y: b64urlToHex(jwk.y), kid,
      head, head_sig: sign(preimage(TH_DOM, headStructHash(head))),
      binding, binding_payer: payer, binding_payer_salt: payerSalt, binding_sig: sign(preimage(B_DOM, bindingStructHash(binding))),
    };
  }
  // Verify throwaway signatures with node crypto.
  const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(tk.x.slice(2), 'hex').toString('base64url'), y: Buffer.from(tk.y.slice(2), 'hex').toString('base64url') }, format: 'jwk' });
  const ver = (m, sg) => crypto.verify('sha256', Buffer.from(ethers.getBytes(m)), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(ethers.getBytes(ethers.concat([sg.r, sg.s]))));
  if (!ver(preimage(TH_DOM, headStructHash(tk.head)), tk.head_sig)) throw new Error('throwaway head sig');
  if (!ver(preimage(B_DOM, bindingStructHash(tk.binding)), tk.binding_sig)) throw new Error('throwaway binding sig');
  if (thumbprint({ x: Buffer.from(tk.x.slice(2), 'hex').toString('base64url'), y: Buffer.from(tk.y.slice(2), 'hex').toString('base64url') }) !== tk.kid) throw new Error('throwaway kid');

  return {
    schema: 'chit402.escrow_vectors.eip712.v1',
    chain_id: CHAIN_ID,
    domain_type: DOMAIN_TYPE,
    treehead_type: TREEHEAD_TYPE,
    binding_type: BINDING_TYPE,
    domain_typehash: k256(DOMAIN_TYPE),
    treehead_typehash: k256(TREEHEAD_TYPE),
    binding_typehash: k256(BINDING_TYPE),
    commit_tag: k256('chit402.escrow.v0.commit'),
    payer_tag: k256('chit402.payer-commitment.v1'),
    usdc_base_id: k256('eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'),
    log_salt: LOG_SALT,
    log_salt_inputs: { epoch1_root: '0x' + e1.root, genesis_digest: '0x' + e1.genesis_digest },
    treehead_domain_separator: TH_DOM,
    binding_domain_separator: B_DOM,
    production_key: { note: 'Public values only (JWKS).', x: PROD.x, y: PROD.y, kid: PROD.kid, kid_b64url: PROD.kid_b64url },
    worked_head: { ...worked, struct_hash: workedStruct, e: workedE },
    throwaway: tk,
  };
}

// ---- merkle.json ----
function prng(seed) {
  let s = BigInt(seed);
  return () => { s = (s * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n); return Number(s >> 33n); };
}
function buildMerkle() {
  const rnd = prng(0x2c7b0ae5);
  const sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 16, 17, 31, 32, 33, 39, 64, 100, 129, 257];
  const cases = [];
  for (const size of sizes) {
    const leaves = [];
    for (let i = 0; i < size; i++) leaves.push(merkle.leafHash(Buffer.from(`task-${size}-${i}|row-${rnd()}`)));
    const root = merkle.rootOf(leaves);
    const idxs = new Set([0, size - 1, Math.floor(size / 2), rnd() % size]);
    for (const index of idxs) {
      const proof = merkle.inclusionProof(leaves, index);
      const ok = merkle.verifyInclusion(leaves[index], index, size, root.toString('hex'), proof);
      if (!ok) throw new Error(`gateway verifyInclusion false for size ${size} index ${index}`);
      cases.push({ leaf: '0x' + leaves[index].toString('hex'), index, size, root: '0x' + root.toString('hex'), proof: proof.map((p) => '0x' + p.hash), ok: true });
      // Negative twins, each checked false by the gateway too.
      const neg = [];
      if (proof.length) neg.push({ ...cases[cases.length - 1], proof: proof.slice(0, -1).map((p) => '0x' + p.hash), why: 'short' });
      neg.push({ ...cases[cases.length - 1], proof: [...proof.map((p) => '0x' + p.hash), '0x' + leaves[0].toString('hex')], why: 'long' });
      if (size > 1) neg.push({ ...cases[cases.length - 1], index: (index + 1) % size, why: 'wrong_index' });
      neg.push({ ...cases[cases.length - 1], index: size, why: 'index_eq_size' });
      if (proof.length >= 2) {
        const sw = proof.map((p) => '0x' + p.hash); [sw[0], sw[1]] = [sw[1], sw[0]];
        neg.push({ ...cases[cases.length - 1], proof: sw, why: 'swapped' });
      }
      if (size > 2) neg.push({ ...cases[cases.length - 1], size: size + 1, why: 'wrong_size' });
      for (const n of neg) {
        const jsOk = merkle.verifyInclusion(Buffer.from(n.leaf.slice(2), 'hex'), n.index, n.size, n.root.slice(2), n.proof.map((h) => ({ hash: h.slice(2) })));
        cases.push({ ...n, ok: jsOk });
      }
    }
  }
  // Oct 9 shape: a size-11 label on the size-10 root. Under that head, index
  // 10 "holds" leaf 9 (proof [leaf 8, MTH(0..8)]), while the honest size-11
  // head holds leaf 10 there. Type B evidence.
  const L = []; for (let i = 0; i < 11; i++) L.push(merkle.leafHash(Buffer.from(`oct9-${i}`)));
  const root10 = merkle.rootOf(L.slice(0, 10));
  const root11 = merkle.rootOf(L);
  const m08 = merkle.rootOf(L.slice(0, 8));
  const badProof = [L[8], m08];
  if (!merkle.verifyInclusion(L[9], 10, 11, root10.toString('hex'), badProof.map((b) => ({ hash: b.toString('hex') })))) throw new Error('oct9 bad proof');
  const goodProof = merkle.inclusionProof(L, 10);
  if (!merkle.verifyInclusion(L[10], 10, 11, root11.toString('hex'), goodProof)) throw new Error('oct9 good proof');
  const hx = (b) => '0x' + Buffer.from(b).toString('hex');
  const oct9 = {
    note: 'Size-11 label on the size-10 root (Oct 9 publish/append race shape), synthetic leaves.',
    index: 10, size: 11,
    bad_root: hx(root10), bad_leaf: hx(L[9]), bad_proof: badProof.map(hx),
    good_root: hx(root11), good_leaf: hx(L[10]), good_proof: goodProof.map((p) => '0x' + p.hash),
  };
  return { schema: 'chit402.escrow_vectors.merkle.v1', source: 'services/gateway/src/receipt-merkle.js rootOf/inclusionProof/verifyInclusion', count: cases.length, cases, oct9 };
}

// ---- wycheproof.json ----
function buildWycheproof(prev) {
  if (!WY_PATH) return prev;
  const j = JSON.parse(fs.readFileSync(WY_PATH, 'utf8'));
  const out = [];
  for (const g of j.testGroups) {
    const strip = (h) => h.replace(/^(00)+(?=.{64}$)/, '');
    const x = strip(g.publicKey.wx); const y = strip(g.publicKey.wy);
    if (x.length > 64 || y.length > 64) continue;
    for (const t of g.tests) {
      if (t.sig.length !== 128) continue;
      if (t.result === 'acceptable') continue;
      out.push({ tcId: t.tcId, comment: t.comment, h: sha256('0x' + t.msg), r: '0x' + t.sig.slice(0, 64), s: '0x' + t.sig.slice(64), x: '0x' + x.padStart(64, '0'), y: '0x' + y.padStart(64, '0'), valid: t.result === 'valid' });
    }
  }
  return {
    schema: 'chit402.escrow_vectors.wycheproof.v1',
    source: 'https://github.com/C2SP/wycheproof testvectors_v1/ecdsa_secp256r1_sha256_p1363_test.json (64-byte signatures only, "acceptable" cases dropped; h = sha256(msg))',
    count: out.length,
    cases: out,
  };
}

const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')); } catch { return null; } };
const eipPrev = read('eip712.json');
const eip = buildEip712(eipPrev);
const mk = buildMerkle();
const wy = buildWycheproof(read('wycheproof.json'));

if (CHECK) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let bad = 0;
  if (!same(eip, eipPrev)) { console.error('eip712.json differs from a fresh build'); bad++; }
  if (!same(mk, read('merkle.json'))) { console.error('merkle.json differs from a fresh build'); bad++; }
  if (bad) process.exit(1);
  console.log('vectors ok');
} else {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'eip712.json'), JSON.stringify(eip, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'merkle.json'), JSON.stringify(mk, null, 2) + '\n');
  if (wy) fs.writeFileSync(path.join(outDir, 'wycheproof.json'), JSON.stringify(wy, null, 2) + '\n');
  console.log(`wrote eip712.json, merkle.json (${mk.count} cases)${wy ? `, wycheproof.json (${wy.count} cases)` : ''}`);
}
