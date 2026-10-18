/**
 * Exhaustive outer-field tamper: for public receipts, change every outer
 * leaf one at a time and all at once (strings, numbers, nulls, flipped
 * booleans) and inject absent keys. Injected key names are harvested, not
 * hand-listed: every key in every verifier fixture and its decoded issuer
 * claims, and every property name the gateway renderers read. No rendered output may change:
 * holder/foreign page, share meta, og card, shell JSON and HTML, auditor export
 * and its HTML. Only the issuer JWS is trusted.
 *
 * The payload v10 owner-view receipt is synthetic, signed by a test key that
 * synthetic-issuer-key-env.mjs makes the gateway's active issuer key.
 *
 * Proof and anchor inputs (the served inclusion proof, its tree head, the
 * row hash and carry-forward) are checked by the page. A change to one of
 * them may only move a check to 'failed' or 'couldnt_check' (and the outcome
 * to 'invalid' or 'couldnt_check'); it may never produce a different positive
 * value, and nothing outside the checked parts may change. No anchor record
 * is stubbed: the page uses the gateway's own lookup, which at most yields
 * issuer_record (not checked on-chain).
 *
 * Swapped slots: another issuer document's JWS (book-seq, tree head) or one
 * with crit/b64 in the receipt slot makes the outcome invalid with null
 * totals; the wrong JWS in the tree-head slot makes the head failed.
 */
import './synthetic-issuer-key-env.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  renderReceiptHtml, buildAuditorExport, renderAuditorHtml, displayReceiptView,
  redactPublicReceipt, signedReceiptProjection,
} from '../src/receipt.js';
import { buildReceiptOgMeta } from '../src/receipt-og-meta.js';
import { buildReceiptOgSvg } from '../src/receipt-og.js';
import { toPublicShell, renderReceiptShellHtml } from '../src/receipt-shell.js';

const FIX = new URL('../../../packages/verify/test/fixtures/', import.meta.url);
// Full receipt id -> fixture file holding that public receipt.
const RECEIPTS = {
  'foreign-x402-muy1hh8y-66555d036df8': 'public/foreign-x402-muy1hh8y.json',
  'xfuel-4d6e8331-c30f-400d-a76e-fcce0cfde209': 'chit-4d6e8331.json',
  'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96': 'public/chit-1ebc5616.json',
  'xfuel-5d775d12-f43a-460f-8b4a-9299b4eedf20': 'chit-5d775d12.v7.json',
  'xfuel-c5a3860d-df26-490d-ab92-8f3069dac8c8': 'slot-typing/v5-xfuel-c5a3860d.json',
  'xfuel-5e7a1c00-0000-4000-8000-00000000f10a': 'slot-typing/v10-synthetic.json',
  'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af': 'public/chit-39af100b.json',
};

// Harvested key names (programmatic, no hand list).
const SRC = new URL('../src/', import.meta.url);
function walkKeys(o, acc, blocks, depth = 0) {
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    acc.add(k);
    if (depth === 0 && v && typeof v === 'object' && !Array.isArray(v)) blocks.add(k);
    walkKeys(v, acc, blocks, depth + 1);
  }
}
function jwsClaimsIn(o, out = []) {
  if (!o || typeof o !== 'object') return out;
  for (const v of Object.values(o)) {
    if (typeof v === 'string' && /^eyJ[\w-]*\.eyJ[\w-]*\.[\w-]+$/.test(v)) {
      try { out.push(JSON.parse(Buffer.from(v.split('.')[1], 'base64url').toString('utf8'))); } catch { /* skip */ }
    } else jwsClaimsIn(v, out);
  }
  return out;
}
function listJson(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const u = new URL(`${e.name}${e.isDirectory() ? '/' : ''}`, dir);
    if (e.isDirectory()) listJson(u, out);
    else if (e.name.endsWith('.json')) out.push(u);
  }
  return out;
}
const HARVEST = new Set();
const BLOCKS = new Set();
for (const u of listJson(FIX)) {
  let o;
  try { o = JSON.parse(fs.readFileSync(u, 'utf8')); } catch { continue; }
  const r = o.receipt && typeof o.receipt === 'object' ? o.receipt : o;
  walkKeys(r, HARVEST, BLOCKS);
  for (const c of jwsClaimsIn(o)) walkKeys(c, HARVEST, new Set());
}
for (const f of ['receipt.js', 'receipt-shell.js', 'receipt-og.js', 'receipt-og-meta.js', 'receipt-log-check.js', 'owner-view.js']) {
  const code = fs.readFileSync(new URL(f, SRC), 'utf8');
  for (const m of code.matchAll(/\??\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) HARVEST.add(m[1]);
  for (const m of code.matchAll(/\[\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\]/g)) HARVEST.add(m[1]);
}
for (const k of ['__proto__', 'constructor', 'prototype']) HARVEST.delete(k);
const INJECT_KEYS = [...HARVEST].sort();
const INJECT_BLOCKS = ['', ...[...BLOCKS].filter((b) => b !== 'issuer_signature').sort()];
const numericKey = (k) => /amount|bps|units|usd|actual|estimated|quoted|size|index|seq|epoch/i.test(k);

// Production signed head (epoch 2, size 3) that covers the foreign receipt's leaf.
const HEAD = JSON.parse(fs.readFileSync(new URL('pardal-head-honest.json', FIX), 'utf8'));

// Render cases: the gateway-supplied head, and the head the served proof
// carries. No anchor stub anywhere: the gateway's own anchor lookup is used.
const CASES = {
  'foreign-x402-muy1hh8y-66555d036df8': [
    { name: 'gateway-head', opts: { treeHead: HEAD } },
    { name: 'embedded-head', opts: {}, embedHead: true },
  ],
};
const NO_RECORDS = {};

const isProofPath = (p) => p[0] === 'inclusion' || p[0] === 'carry_forward' || p[0] === 'row_hash'
  || p.join('.') === 'book_chain.row_hash';

function load(id) {
  const o = JSON.parse(fs.readFileSync(new URL(RECEIPTS[id], FIX), 'utf8'));
  const r = o.receipt && o.receipt.issuer_signature ? o.receipt : o;
  assert.equal(r.task_id, id);
  return r;
}

function sentinel(v, i) {
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'number') return v + 7300003 + i;
  if (v === null) return `ZZT${i}Q`;
  const s = String(v);
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return `0x5e7a${String(i).padStart(6, '0')}${'a'.repeat(30)}`;
  if (/^[a-z-]+:/.test(s)) return `${s.split(':')[0]}:0xee5e7a${String(i).padStart(6, '0')}${'b'.repeat(52)}`;
  if (/^\d+$/.test(s)) return String(7300003 + i);
  if (/^\d+\.\d+$/.test(s)) return `7${i}3.7`;
  if (/^https?:/.test(s)) return `https://zzt${i}q.evil.example/x`;
  return `ZZT${i}Q`;
}

function leaves(o, path = [], acc = []) {
  for (const k of Object.keys(o)) {
    const p = [...path, k];
    if (p.join('.') === 'issuer_signature.jws') continue;
    const v = o[k];
    if (v && typeof v === 'object') leaves(v, p, acc);
    else acc.push(p);
  }
  return acc;
}

function setPath(o, p, value) {
  let cur = o;
  for (const k of p.slice(0, -1)) {
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[p.at(-1)] = value;
}
const getPath = (o, p) => p.reduce((c, k) => (c == null ? c : c[k]), o);

const norm = (s) => String(s).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T');
function render(r, opts = NO_RECORDS) {
  const c = () => structuredClone(r);
  const out = {};
  const t = (k, f) => { try { out[k] = norm(f()); } catch (e) { out[k] = `ERR ${e.message}`; } };
  t('page', () => renderReceiptHtml(c(), opts));
  t('share', () => {
    const p = signedReceiptProjection(redactPublicReceipt(c()));
    return JSON.stringify(buildReceiptOgMeta(p, displayReceiptView(p)));
  });
  t('og', () => buildReceiptOgSvg(c()));
  t('shell', () => JSON.stringify(toPublicShell(c())));
  t('shellHtml', () => renderReceiptShellHtml(toPublicShell(c()), { publicBaseUrl: 'https://chit402.com' }));
  t('export', () => { const e = buildAuditorExport(c(), opts); delete e.generated_at; return JSON.stringify(e); });
  t('exportHtml', () => renderAuditorHtml(buildAuditorExport(c(), opts)));
  return out;
}

const NEGATIVE = new Set(['failed', 'couldnt_check', 'invalid']);
const WITNESS = /<section class="card">\s*<h2>Outside witness[\s\S]*?<\/section>/;

/** Checked states and the masked remainder of every surface. */
function split(out) {
  const st = {};
  for (const m of out.page.matchAll(/data-log-part="(\w+)" data-log-state="(\w+)"/g)) st[`page.${m[1]}`] = m[2];
  const o = out.page.match(/data-outcome="(\w+)"/);
  st['page.outcome'] = o ? o[1] : null;
  const witness = (out.page.match(WITNESS) || [''])[0];
  const masked = { ...out };
  masked.page = out.page.replace(WITNESS, '<W>').replace(/<span class="badge \w+" data-outcome="\w+">[^<]*<\/span>/, '<O>');
  try {
    const e = JSON.parse(out.export);
    st['export.outcome'] = e.proof_outcome;
    for (const k of ['head', 'inclusion', 'anchor']) st[`export.${k}`] = e.log_check?.[k]?.state;
    st.exportLog = JSON.stringify(e.log_check);
    delete e.proof_outcome; delete e.log_check;
    masked.export = JSON.stringify(e);
  } catch { /* an ERR string stays as-is */ }
  masked.exportHtml = out.exportHtml.replace(/<div class="row"><span class="k">(Proof outcome|Inclusion|Tree head|Anchor)<\/span>.*?<\/div>/g, '<L>');
  return { st, witness, masked };
}

/** A proof/anchor change may only turn a check negative. */
function proofMoveProblems(base, out) {
  const a = split(base);
  const b = split(out);
  const bad = [];
  for (const k of Object.keys(a.masked)) if (a.masked[k] !== b.masked[k]) bad.push(`${k} outside checks`);
  for (const k of Object.keys(a.st)) {
    if (k === 'exportLog') continue;
    if (a.st[k] !== b.st[k] && !NEGATIVE.has(b.st[k])) bad.push(`${k} ${a.st[k]} -> ${b.st[k]}`);
  }
  const allSame = Object.keys(a.st).every((k) => a.st[k] === b.st[k]);
  if (allSame && (a.witness !== b.witness || a.st.exportLog !== b.st.exportLog)) bad.push('checked value changed');
  // A part that stayed checked keeps its checked values.
  const ea = JSON.parse(a.st.exportLog || '{}');
  const eb = JSON.parse(b.st.exportLog || '{}');
  for (const k of ['head', 'inclusion', 'anchor']) {
    if (ea[k]?.state === 'checked' && eb[k]?.state === 'checked' && JSON.stringify(ea[k]) !== JSON.stringify(eb[k])) {
      bad.push(`${k} checked value changed`);
    }
  }
  return bad;
}

const moves = { proofLeaves: 0, unchanged: 0, negative: 0 };
let walked = 0;
let injected = 0;
let allAtOnce = 0;
const runs = [];
for (const id of Object.keys(RECEIPTS)) {
  for (const c of CASES[id] || [{ name: 'no-records', opts: NO_RECORDS }]) runs.push({ id, ...c });
}
for (const { id, name, opts, embedHead } of runs) {
  test(`outer changes: ${id} (${name})`, () => {
    const orig = load(id);
    if (embedHead) orig.inclusion.head = { signature: { jws: HEAD.issuer_signature.jws } };
    const base = render(orig, opts);
    for (const [k, v] of Object.entries(base)) assert.ok(!v.startsWith('ERR'), `${id} ${k} ${v}`);
    if (CASES[id]) {
      const st = split(base).st;
      assert.equal(st['page.head'], 'checked', `${name} head`);
      assert.equal(st['page.inclusion'], 'checked', `${name} inclusion`);
      assert.ok(['couldnt_check', 'issuer_record'].includes(st['page.anchor']), `${name} anchor ${st['page.anchor']}`);
      assert.equal(st['export.outcome'], 'couldnt_check', `${name} outcome`);
    }
    const leaks = [];
    const check = (label, r, p) => {
      const out = render(r, opts);
      if (isProofPath(p)) {
        moves.proofLeaves += 1;
        const bad = proofMoveProblems(base, out);
        for (const b of bad) leaks.push(`${label} -> ${b}`);
        if (!bad.length) {
          if (Object.keys(out).every((k) => out[k] === base[k])) moves.unchanged += 1;
          else moves.negative += 1;
        }
        return;
      }
      for (const k of Object.keys(out)) if (out[k] !== base[k]) leaks.push(`${label} -> ${k}`);
    };
    leaves(orig).forEach((p, i) => {
      walked += 1;
      const r = structuredClone(orig);
      setPath(r, p, sentinel(getPath(orig, p), i));
      check(p.join('.'), r, p);
    });
    // Removing the proof altogether may only make the checks unavailable.
    if (orig.inclusion) {
      const r = structuredClone(orig);
      delete r.inclusion;
      check('inclusion(removed)', r, ['inclusion']);
    }
    // All leaves at once: non-proof leaves change nothing; with the proof
    // leaves too, only negative moves.
    {
      const all = leaves(orig);
      const r1 = structuredClone(orig);
      all.forEach((p, i) => { if (!isProofPath(p)) setPath(r1, p, sentinel(getPath(orig, p), 50000 + i)); });
      check('all-non-proof-leaves', r1, ['all']);
      const r2 = structuredClone(orig);
      all.forEach((p, i) => setPath(r2, p, sentinel(getPath(orig, p), 60000 + i)));
      check('all-leaves', r2, ['inclusion', 'all']);
      allAtOnce += 2;
    }
    // Harvested keys: each block gets every absent key at once; on a change,
    // bisect to name the keys.
    const injectInto = (blk, keys, label) => {
      const r = structuredClone(orig);
      if (blk && (r[blk] == null || typeof r[blk] !== 'object' || Array.isArray(r[blk]))) r[blk] = {};
      let n = 0;
      keys.forEach((k, j) => {
        const p = blk ? [blk, k] : [k];
        if (getPath(orig, p) !== undefined) return;
        setPath(r, p, sentinel(numericKey(k) ? '1' : 's', 9000 + j));
        n += 1;
      });
      if (!n) return [];
      injected += n;
      const before = leaks.length;
      check(label, r, blk ? [blk] : ['']);
      const hit = leaks.splice(before);
      if (!hit.length) return [];
      if (keys.length === 1) return hit.map((h) => h.replace(label, `${blk ? `${blk}.` : ''}${keys[0]}(inject)`));
      const mid = Math.ceil(keys.length / 2);
      return [...injectInto(blk, keys.slice(0, mid), label), ...injectInto(blk, keys.slice(mid), label)];
    };
    for (const blk of INJECT_BLOCKS) {
      leaks.push(...injectInto(blk, INJECT_KEYS, `${blk || '(top)'}.*(inject)`));
    }
    assert.deepEqual(leaks, [], `${id}: ${leaks.length} outer changes reached output`);
  });
}

test('tamper walk covered every receipt', () => {
  assert.ok(walked > 500, `walked ${walked} leaves`);
  assert.ok(injected > 1000, `injected ${injected} keys`);
  assert.ok(allAtOnce >= runs.length * 2, 'all-at-once passes ran');
  assert.ok(moves.negative > 0, 'some proof changes moved a check');
  console.log(`# outer tamper: ${walked} leaves walked, ${injected} keys injected (${INJECT_KEYS.length} harvested names x ${INJECT_BLOCKS.length} blocks), ${allAtOnce} all-at-once passes, ${runs.length} runs; proof/anchor inputs: ${moves.proofLeaves} (unchanged ${moves.unchanged}, moved negative ${moves.negative})`);
});

// Swapped slots.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function rehead(jws, extra) {
  const [h, p, sg] = jws.split('.');
  return `${b64u({ ...JSON.parse(Buffer.from(h, 'base64url').toString('utf8')), ...extra })}.${p}.${sg}`;
}
const FOREIGN_ID = 'foreign-x402-muy1hh8y-66555d036df8';
for (const id of Object.keys(RECEIPTS)) {
  test(`swapped receipt slot: ${id}`, () => {
    const orig = load(id);
    const bookSeq = orig.book_chain?.issuer_signature?.jws || load(FOREIGN_ID).book_chain.issuer_signature.jws;
    const variants = {
      book_seq: bookSeq,
      tree_head: HEAD.issuer_signature.jws,
      crit: rehead(orig.issuer_signature.jws, { crit: ['b64'] }),
      b64_false: rehead(orig.issuer_signature.jws, { b64: false }),
      typ_x402: rehead(orig.issuer_signature.jws, { typ: 'chit402-x402-receipt+jwt' }),
    };
    for (const [name, jws] of Object.entries(variants)) {
      const r = structuredClone(orig);
      r.issuer_signature = { ...r.issuer_signature, jws };
      const out = render(r, CASES[id]?.[0]?.opts || NO_RECORDS);
      for (const [k, v] of Object.entries(out)) assert.ok(!v.startsWith('ERR'), `${id} ${name} ${k} ${v}`);
      const { st } = split(out);
      assert.equal(st['page.outcome'], 'invalid', `${id} ${name} page outcome`);
      assert.equal(st['export.outcome'], 'invalid', `${id} ${name} export outcome`);
      const e = JSON.parse(out.export);
      for (const [k, v] of Object.entries(e.totals || {})) assert.equal(v ?? null, null, `${id} ${name} totals.${k}`);
      assert.equal(JSON.parse(out.shell).receipt_id ?? orig.task_id, orig.task_id);
    }
  });
}

test('swapped tree-head slot: the head check fails', () => {
  const orig = load(FOREIGN_ID);
  const variants = {
    receipt_jws: orig.issuer_signature.jws,
    book_seq: orig.book_chain.issuer_signature.jws,
    crit: rehead(HEAD.issuer_signature.jws, { crit: ['b64'] }),
    b64_false: rehead(HEAD.issuer_signature.jws, { b64: false }),
    wrong_kid: rehead(HEAD.issuer_signature.jws, { kid: 'another-kid' }),
  };
  for (const [name, jws] of Object.entries(variants)) {
    const r = structuredClone(orig);
    r.inclusion.head = { signature: { jws } };
    const { st } = split(render(r, {}));
    assert.equal(st['page.head'], 'failed', `${name} head`);
    assert.equal(st['page.outcome'], 'invalid', `${name} outcome`);
    assert.equal(st['export.head'], 'failed', `${name} export head`);
  }
});
