#!/usr/bin/env node
/**
 * Corpus baseline gate. Compares the golden corpus baseline, changes.json
 * and the frozen version registry with their merge-base versions.
 *
 *   node corpus-gate.mjs --base <commit> [--root <repo>]
 *        [--base-tree <merge-base packages/verify, built> --head-inputs <json>]
 *   node corpus-gate.mjs export <packages/verify, built>   # prints inputs JSON
 *
 * `export` writes the synthetic case inputs of a tree (case document, test
 * issuer history and JWKS per case) as data. CI runs it on the head tree in
 * a separate job and passes the JSON here. The gate itself runs no head
 * code: it reads the head baseline and changes.json as data, digests the
 * head inputs itself, and runs only merge-base code (this file from the
 * merge base, and the merge-base tree's synthetic cases and runners).
 * Without --base-tree and --head-inputs any added corpus_fix entry fails.
 *
 * Fails (exit 1) when:
 *   - a baseline.json entry differs from the merge base and no changes.json
 *     entry added in this change names that case and path, or the head
 *     value is not the entry's `to`;
 *   - an added `tighten` entry (the default kind) is not at least as strict
 *     as the merge-base outcome (exit, result, overall and every check);
 *   - an added `corpus_fix` entry is for a real receipt (id-* or file-*), has
 *     no note, moves a case to exit 0 / verified, does not carry the case's
 *     head input digest (`input_digest`) where that digest differs from the
 *     merge-base digest, or its `to` is not exactly the outcome the
 *     MERGE-BASE verifier gives on the HEAD input. A corpus_fix is only for
 *     a case whose input changed, and the change must be explained by the
 *     input alone, never by a verifier change in the same PR.
 *   - an added corpus_fix entry, or a removed baseline row, is in a change
 *     that also touches the verifier (packages/verify/src/**, a JSON file at
 *     the package root such as package.json, BUILD_DIGEST.txt, or any
 *     dist/ output), from `git diff --name-only <base> HEAD`;
 *   - a real receipt case is removed from the baseline;
 *   - changes.json is not append-only (an existing entry is edited or
 *     dropped);
 *   - the frozen registry file is not append-only, or an appended entry has
 *     no added `registry` changes.json entry;
 *   - declarations.frozen.json is not append-only or not well formed, or the
 *     head synthetic.mjs `expect` values (from the head export) differ from
 *     the head pin, or a head case path is not classified by the head pin
 *     (declared, deferred or reason_allowed); a head case input digest
 *     differs from the input_digest pinned for its declared or deferred
 *     paths; an appended declaration or deferred entry is not what the
 *     merge-base verifier gives on the head input, or an existing case's
 *     input changed from the merge base (appendBindingProblems);
 *     reason_allowed is frozen; an appended declaration must also not be
 *     the deferred value or a cause that decides nothing (isNonDecision);
 *     an added deferred entry may not name a declared or reason_allowed
 *     path; a
 *     corpus correction also needs the merge-base pin, and the merge-base
 *     synthetic.mjs `expect` values equal to it (see declaredProblems for
 *     what the pin allows);
 *   - a declared path's baseline row does not record its declared decision
 *     (cli `reason`, library and signature `cause`), or a changed row moves
 *     its `reason` or `cause`; a deferred path's row moves its reason or
 *     cause without a strictly tighter exit (declarationRowProblems);
 *   - a pinned baseline row changes in a change that touches
 *     test/golden-corpus.test.mjs (goldenEditProblems);
 *   - declarations.frozen.json at the merge base is not valid JSON, or is
 *     missing while the merge-base corpus-gate.mjs reads it
 *     (basePinStateProblems; only the change that adds the pin runs
 *     without one);
 *   - the chain tier breaks its rules (gateChain below).
 *
 * The input digest (caseDigest) includes the signature state of the case
 * document and the issuer history (signatureForm): valid under the history
 * or JWKS key filed under the signature kid, valid only under another
 * carried key (named by role), or invalid with the raw signature bytes;
 * and how each embedded issuer_jwk relates to that trusted key.
 *
 * Self-contained on purpose: CI runs the copy of this file from the merge
 * base, so a change cannot loosen the gate that checks it.
 * Exit 0: no problems. Exit 1: problems listed on stderr. Exit 3: usage.
 */
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE = 'packages/verify/test/corpus/baseline.json';
export const CHANGES = 'packages/verify/test/corpus/changes.json';
export const REGISTRY_PIN = 'packages/verify/test/fixtures/version-registry.frozen.json';
export const DECLARATIONS_PIN = 'packages/verify/test/corpus/declarations.frozen.json';
export const CHAIN_BASELINE = 'packages/verify/test/corpus/baseline-chain.json';
export const CHAIN_TAPE = 'packages/verify/test/corpus/tapes/public-chain.json';

const exitRank = (e) => (e === 0 ? 2 : e === 2 ? 1 : 0);
const resultRank = (r) => (r === 'verified' || r === 'signature_valid' ? 2 : r === 'could_not_check' || r === 'partial' ? 1 : 0);
const checkRank = (v) => (v === 'pass' ? 2 : v === 'fail' ? 0 : 1);
const RESULT_EXIT = { verified: 0, signature_valid: 0, could_not_check: 2, partial: 2, invalid: 1, signature_invalid: 1 };
const isReal = (key) => /^(id|file)-/.test(key);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function wellFormed(o) {
  const p = [];
  if (!o || typeof o !== 'object') return ['not an outcome'];
  if (![0, 1, 2].includes(o.exit)) p.push(`exit ${o.exit} is outside 0/1/2`);
  if (RESULT_EXIT[o.result] === undefined) p.push(`unknown result ${JSON.stringify(o.result)}`);
  else if (RESULT_EXIT[o.result] !== o.exit) p.push(`result ${o.result} with exit ${o.exit}`);
  return p;
}

function looser(from, to) {
  const p = [];
  if (exitRank(to.exit) > exitRank(from.exit)) p.push(`exit ${from.exit} -> ${to.exit}`);
  if (resultRank(to.result) > resultRank(from.result)) p.push(`result ${from.result} -> ${to.result}`);
  if (from.overall === 'failed' && to.overall && to.overall !== 'failed') p.push(`overall failed -> ${to.overall}`);
  if (from.overall === 'partial' && /^verified/.test(String(to.overall || ''))) p.push(`overall partial -> ${to.overall}`);
  for (const [name, value] of Object.entries(from.checks || {})) {
    const now = to.checks ? to.checks[name] : undefined;
    if (now === undefined) p.push(`drops check ${name}`);
    else if (checkRank(now) > checkRank(value)) p.push(`checks.${name} ${value} -> ${now}`);
  }
  return p;
}

// ---------- case inputs and their digests ----------

export const INPUTS_FORMAT = 'chit402.corpus-inputs.v1';
const MARKER = '<covering test history>';

/** Sorted-key JSON. For JSON data this is the JCS form (RFC 8785). */
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const parse = (text) => { try { return JSON.parse(text); } catch { return text; } };
const b64json = (b) => { try { return JSON.parse(Buffer.from(b || '', 'base64url').toString('utf8')); } catch { return b ?? null; } };
const decodeJws = (jws) => { const [h, c] = jws.split('.'); return { header: b64json(h), claims: b64json(c) }; };

// Public key bytes come from the throwaway test key of each run; kid, kty,
// crv, alg and use stay.
function keyForm(jwk) {
  if (!jwk || typeof jwk !== 'object') return jwk;
  const { x, y, d, ...rest } = jwk;
  return rest;
}

/**
 * The run-independent form of an issuer history: every entry with kid, alg,
 * validity window, status, revocation and custody; version, seq and the
 * signed claims. Left out: public key bytes, the signature, and the hashes
 * that are computed from them (entry_hash, prev_hash, head_hash).
 */
export function historyForm(text) {
  const h = parse(text);
  if (!h || typeof h !== 'object' || Array.isArray(h)) return h;
  const c = structuredClone(h);
  delete c.head_hash;
  if (Array.isArray(c.entries)) {
    c.entries = c.entries.map((e) => {
      if (!e || typeof e !== 'object') return e;
      const { entry_hash, prev_hash, ...rest } = e;
      return { ...rest, jwk: keyForm(rest.jwk) };
    });
  }
  if (c.issuer_signature && typeof c.issuer_signature === 'object') {
    const sig = { ...c.issuer_signature };
    if (typeof sig.jws === 'string') {
      const { header, claims } = decodeJws(sig.jws);
      if (claims && typeof claims === 'object') delete claims.head_hash;
      sig.jws = { header, claims };
    }
    delete sig.value;
    sig.issuer_jwk = keyForm(sig.issuer_jwk);
    c.issuer_signature = sig;
  }
  return c;
}

export function jwksForm(text) {
  const j = parse(text);
  if (!j || typeof j !== 'object' || !Array.isArray(j.keys)) return j;
  return { ...j, keys: j.keys.map(keyForm) };
}

/**
 * The run-independent form of a case document: a JWS keeps its header and
 * claims, a detached signature keeps everything but `value`, key bytes go,
 * and the hash of the covering test history (in the signed pin and its
 * outer copy) becomes a marker. The history itself is digested in full
 * form next to it, so the marker hides nothing.
 */
export function docForm(text, historyText) {
  const doc = parse(text);
  const historyHash = historyText == null ? null : sha256(stable(parse(historyText)));
  const mask = (v) => {
    if (Array.isArray(v)) return v.map(mask);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x)]));
    return typeof v === 'string' && v === historyHash ? MARKER : v;
  };
  if (!doc || typeof doc !== 'object') return doc;
  const c = structuredClone(doc);
  const sig = c.issuer_signature;
  if (sig && typeof sig === 'object') {
    if (typeof sig.jws === 'string') sig.jws = decodeJws(sig.jws);
    delete sig.value;
    if (sig.issuer_jwk !== undefined) sig.issuer_jwk = keyForm(sig.issuer_jwk);
  }
  return mask(c);
}

// ---------- signature state (bound into the digest) ----------

// Detached field lists, as canonicalFieldsV7 / canonicalFieldsV8 in src.
function detachedFieldsV7(r) {
  const p = r.payment || {};
  return [r.task_id ?? null, p.rail ?? null, p.ref ?? null, p.gross_amount ?? null, p.net_amount ?? null, p.fee_amount ?? null,
    p.protocol_fee_bps ?? p.fee_bps ?? null, p.platform_fee ?? null, p.platform_fee_bps ?? null, r.provider_cogs?.actual ?? null,
    r.route?.model ?? null, r.route?.model_commitment?.commitment ?? null, r.route?.provider ?? null, r.output?.hash ?? null,
    r.binding?.expected_commitment ?? null];
}
function detachedFieldsV8(r) {
  const p = r.payment || {};
  const b = p.accounting?.internal_breakdown;
  const c = r.caller_binding;
  return [r.task_id ?? null, p.rail ?? null, p.ref ?? null, p.gross_amount ?? null, p.settled_amount ?? null,
    b?.route_margin_bps ?? null, b?.route_margin_amount ?? null, b?.receipt_floor_amount ?? null, b?.provider_cogs_amount ?? null,
    b?.tier2_proof_amount ?? null, r.provider_cogs?.actual ?? null, r.route?.model ?? null, r.route?.model_commitment?.commitment ?? null,
    r.route?.provider ?? null, r.output?.hash ?? null, r.binding?.expected_commitment ?? null,
    c?.payer_wallet ?? null, c?.agent_pubkey ?? null, c?.api_key_hash ?? null];
}

const isEcKey = (j) => !!j && typeof j === 'object' && j.kty === 'EC' && j.crv === 'P-256' && typeof j.x === 'string' && typeof j.y === 'string';
/** RFC 7638 JWK thumbprint of an EC P-256 key. */
const thumbprint = (j) => createHash('sha256').update(`{"crv":"P-256","kty":"EC","x":"${j.x}","y":"${j.y}"}`).digest('base64url');
const toKey = (j) => { try { return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y }, format: 'jwk' }); } catch { return null; } };

/**
 * The keys a case carries, each with its role: `history[i]` (an issuer
 * history entry), `jwks[i]`, `doc.issuer_jwk` and `history.issuer_jwk`,
 * with the kid it is filed under. Only a history entry or a JWKS key filed
 * under the signature's kid is trusted for that signature; the document's
 * and the history's own issuer_jwk never are.
 */
function caseKeys(doc, history, jwks) {
  const out = [];
  const add = (role, j, filed) => { if (isEcKey(j)) { const key = toKey(j); if (key) out.push({ role, kid: filed ?? null, jwk: j, key }); } };
  (Array.isArray(history?.entries) ? history.entries : []).forEach((e, i) => add(`history[${i}]`, e?.jwk, e?.kid ?? e?.jwk?.kid));
  (Array.isArray(jwks?.keys) ? jwks.keys : []).forEach((k, i) => add(`jwks[${i}]`, k, k?.kid));
  add('doc.issuer_jwk', doc?.issuer_signature?.issuer_jwk, doc?.issuer_signature?.issuer_jwk?.kid);
  add('history.issuer_jwk', history?.issuer_signature?.issuer_jwk, history?.issuer_signature?.issuer_jwk?.kid);
  return out;
}
const trustedFor = (k, kid) => typeof kid === 'string' && k.kid === kid && /^(history|jwks)\[\d+\]$/.test(k.role);

/**
 * One signature, with its key relation:
 *   - `valid:<kid>:<role>`: verifies under the history entry or JWKS key
 *     filed under its kid (the first such role, history before JWKS);
 *   - `valid_untrusted:<kid>:<role>:<kid filed>:<thumbprint is kid>`:
 *     verifies only under some other key the case carries (the document's
 *     or history's issuer_jwk, or a key filed under another kid). Whether
 *     the key's RFC 7638 thumbprint equals the signature kid is kept;
 *     throwaway key bytes are not, so the form is the same on every run;
 *   - `invalid:<sha256 of the raw signature>`; `absent`.
 * Any byte change to the signed bytes or the signature, or a re-sign
 * under a key that is not the trusted one for the kid, moves the state.
 */
function sigState(messages, sigText, kid, keys) {
  if (typeof sigText !== 'string' || !sigText) return 'absent';
  const sig = Buffer.from(sigText, 'base64url');
  const verifies = (k) => messages.some((m) => {
    try { return cryptoVerify('sha256', Buffer.from(m, 'utf8'), { key: k.key, dsaEncoding: 'ieee-p1363' }, sig); } catch { return false; }
  });
  const k = String(kid ?? '');
  const trusted = keys.find((x) => trustedFor(x, kid) && verifies(x));
  if (trusted) return `valid:${k}:${trusted.role}`;
  const other = keys.find((x) => verifies(x));
  if (other) return `valid_untrusted:${k}:${other.role}:${other.kid ?? ''}:${thumbprint(other.jwk) === k}`;
  return `invalid:${sha256(sigText)}`;
}

function jwsState(jws, keys) {
  if (typeof jws !== 'string') return 'absent';
  const parts = jws.split('.');
  if (parts.length !== 3) return `malformed:${sha256(jws)}`;
  const header = b64json(parts[0]);
  if (!header || header.alg !== 'ES256') return `alg:${sha256(jws)}`;
  return sigState([`${parts[0]}.${parts[1]}`], parts[2], header.kid, keys);
}

/**
 * How an embedded issuer_jwk relates to the trusted key for a kid:
 * `absent`, `no_key` (not an EC P-256 key with x and y, for example x/y
 * dropped), `trusted:<role>` (same key bytes as the history entry or JWKS
 * key filed under the kid), or `other:<its kid>:<thumbprint is kid>`.
 */
function keyRelation(jwk, kid, keys) {
  if (jwk === undefined || jwk === null) return 'absent';
  if (!isEcKey(jwk)) return 'no_key';
  const same = keys.find((x) => trustedFor(x, kid) && x.jwk.x === jwk.x && x.jwk.y === jwk.y);
  if (same) return `trusted:${same.role}`;
  return `other:${jwk.kid ?? ''}:${thumbprint(jwk) === String(kid ?? '')}`;
}

/**
 * Signature state of a case: the document (JWS or detached) and the issuer
 * history, each with its key relation (sigState, keyRelation).
 */
export function signatureForm(c) {
  const doc = parse(c.doc);
  const history = parse(c.history);
  const jwks = parse(c.jwks);
  const keys = caseKeys(doc, history, jwks);
  const ds = doc && typeof doc === 'object' ? doc.issuer_signature : null;
  let docState = 'absent';
  let docKid = null;
  if (ds && typeof ds === 'object') {
    if (typeof ds.jws === 'string') {
      docKid = b64json(ds.jws.split('.')[0])?.kid ?? null;
      docState = jwsState(ds.jws, keys);
    } else if (typeof ds.value === 'string') {
      docKid = ds.kid ?? null;
      const { issuer_signature: _omit, ...rest } = doc;
      docState = sigState([JSON.stringify(detachedFieldsV7(rest)), JSON.stringify(detachedFieldsV8(rest))], ds.value, docKid, keys);
    }
  }
  const hs = history && typeof history === 'object' ? history.issuer_signature : null;
  const histKid = hs && typeof hs.jws === 'string' ? b64json(hs.jws.split('.')[0])?.kid ?? null : null;
  return {
    doc: docState,
    doc_key: ds && typeof ds === 'object' ? keyRelation(ds.issuer_jwk, docKid, keys) : 'absent',
    history: hs && typeof hs === 'object' ? jwsState(hs.jws, keys) : 'absent',
    history_key: hs && typeof hs === 'object' ? keyRelation(hs.issuer_jwk, histKid, keys) : 'absent',
  };
}

/**
 * Digest of one exported case: document, issuer history, JWKS, and the
 * signature state of the document and the history (signatureForm).
 */
export function caseDigest(c, { signatures = true } = {}) {
  const form = { doc: docForm(c.doc, c.history), history: historyForm(c.history), jwks: jwksForm(c.jwks) };
  // `signatures: false` is the form before #629, which the corpus_fix
  // entries already in changes.json were recorded with.
  if (signatures) form.signatures = signatureForm(c);
  return sha256(stable(form));
}

export function inputsProblems(inputs) {
  if (!inputs || typeof inputs !== 'object') return ['inputs: not an object'];
  if (inputs.format !== INPUTS_FORMAT) return [`inputs: format is not ${INPUTS_FORMAT}`];
  if (!Array.isArray(inputs.cases)) return ['inputs: cases is not an array'];
  const p = [];
  const seen = new Set();
  for (const c of inputs.cases) {
    if (!c || typeof c.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(c.id)) { p.push('inputs: case with a bad id'); continue; }
    if (seen.has(c.id)) p.push(`inputs: duplicate case ${c.id}`);
    seen.add(c.id);
    if (!Array.isArray(c.paths) || !c.paths.every((x) => typeof x === 'string')) p.push(`inputs: ${c.id}: bad paths`);
    for (const f of ['doc', 'history', 'jwks']) if (typeof c[f] !== 'string') p.push(`inputs: ${c.id}: ${f} is not a string`);
  }
  return p;
}

export function inputDigests(inputs) {
  return Object.fromEntries(inputs.cases.map((c) => [c.id, caseDigest(c)]));
}

/** Synthetic case inputs of a built packages/verify tree, as data. */
export async function exportInputs(pkgDir) {
  const synth = join(resolve(pkgDir), 'test', 'corpus', 'synthetic.mjs');
  const { buildSynthetic } = await import(pathToFileURL(synth).href);
  const cases = await buildSynthetic(mkdtempSync(join(tmpdir(), 'corpus-inputs-')));
  const text = (f) => (f ? readFileSync(f, 'utf8') : '');
  return {
    format: INPUTS_FORMAT,
    cases: cases.map((c) => ({
      id: c.id, paths: c.paths, doc: text(c.file), history: text(c.historyFile), jwks: text(c.jwksFile),
      class: c.class ?? null, target: c.target ?? null, expect: c.expect ?? null,
    })),
  };
}

const sameOutcome = (a, b) => {
  const pick = (o) => (o && typeof o === 'object'
    ? { exit: o.exit, result: o.result, reason: o.reason, checks: o.checks ?? null, ...(o.overall !== undefined ? { overall: o.overall } : {}) }
    : o);
  return stable(pick(a)) === stable(pick(b));
};

/**
 * Run the merge-base tree's corpus runner on head case inputs (data) for
 * each `case|path` key, in replay against the merge-base public tape.
 * A key whose case or path the merge-base runner does not have is left out.
 */
export async function baseOutcomes(baseTree, headInputs, keys) {
  const out = {};
  const corpus = join(resolve(baseTree), 'test', 'corpus');
  const libFile = join(corpus, 'lib.mjs');
  if (!existsSync(libFile) || keys.length === 0) return out;
  delete process.env.CHIT_CORPUS_MODE;
  const lib = await import(pathToFileURL(libFile).href);
  const runners = { cli: true, library: existsSync(join(corpus, 'run-library.mjs')), signature: existsSync(join(corpus, 'run-signature.mjs')) };
  const tape = join(corpus, 'tapes', 'public.json');
  const dir = mkdtempSync(join(tmpdir(), 'corpus-base-on-head-'));
  for (const key of keys) {
    const [id, path] = key.split('|');
    const c = headInputs.cases.find((x) => x.id === id);
    if (!c || !runners[path] || !c.paths.includes(path)) continue;
    const d = join(dir, String(Object.keys(out).length));
    mkdirSync(d);
    const file = join(d, 'case.json');
    const historyFile = join(d, 'issuer-history.json');
    const jwksFile = join(d, 'jwks.json');
    writeFileSync(file, c.doc);
    writeFileSync(historyFile, c.history);
    writeFileSync(jwksFile, c.jwks);
    const o = await lib.runPathAsync({ id, file, historyFile, jwksFile }, path, tape);
    out[key] = { exit: o.exit, result: o.result, reason: o.reason, checks: o.checks, ...(o.overall !== undefined ? { overall: o.overall } : {}), cause: o.cause ?? null };
  }
  return out;
}

export const FIX_KINDS = Object.freeze(['corpus_fix', 'corpus_fix_reason']);
const isFixKind = (kind) => FIX_KINDS.includes(kind);
// Classes whose cases each test one rule; a fix there must keep the rule.
const RULE_CLASSES = new Set(['label', 'version', 'gate', 'timing']);

// ---------- pinned case declarations (declarations.frozen.json) ----------

export const DECLARATIONS_FORMAT = 'chit402.corpus-declarations.v1';
const PIN_LISTS = ['declarations', 'deferred', 'reason_allowed'];
const pinKey = (e) => `${e?.case}|${e?.path}`;

/**
 * Causes and reasons that make no decision by a case rule: the verifier
 * stopped because something was not reachable, not available, not checked
 * or not trusted, or gave only the generic result (from the 0.5.0-pre.0
 * verifier cause set: log_unreachable, anchor_unreachable,
 * issuer_history_unavailable, receipt_unavailable,
 * signed_receipt_unavailable, log_time_unavailable, base_rpc_error,
 * rpc_timeout, pending_anchor, payer_unchecked, signature_unchecked,
 * key untrusted, head_key_untrusted, could_not_check, invalid, unreadable).
 * Matched by pattern as well, so a new cause of the same kind is covered.
 * An appended declaration may not take one of these: a path leaves
 * `deferred` only with a real decision. This is a second check: an append
 * must already equal the merge-base verifier's output on an unchanged
 * input (appendBindingProblems). It stays because that binding alone would
 * accept a deferred path declared at its own non-decision value (the
 * merge-base verifier does give log_unreachable there), and it keeps a new
 * case path with a non-decision outcome in `deferred`.
 */
const NON_DECISION = new Set(['', 'invalid', 'could_not_check', 'unreadable', 'unchecked', 'pending', 'key untrusted', 'key_untrusted', 'head_key_untrusted']);
export function isNonDecision(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (NON_DECISION.has(v)) return true;
  return /(unreachable|unavailable|rpc_error|rpc_timeout|timeout|unchecked|pending|untrusted)/.test(v);
}

/**
 * The pin as maps. `declared`: exact expected cause or reason per
 * case|path. `deferred`: declared in synthetic.mjs today but not by the
 * case rule (an appended declaration with a real decision supersedes it).
 * `effective`: what synthetic.mjs `expect` must equal. `reasonAllowed`:
 * the never-declared paths where corpus_fix_reason is accepted.
 * `pinned`: every case|path the pin names. `cases`: every case id it names.
 */
export function pinMaps(pin) {
  const declared = new Map();
  const deferred = new Map();
  const reasonAllowed = new Set();
  for (const e of pin?.declarations ?? []) if (!declared.has(pinKey(e))) declared.set(pinKey(e), e.expect);
  for (const e of pin?.deferred ?? []) if (!deferred.has(pinKey(e))) deferred.set(pinKey(e), e.expect);
  for (const e of pin?.reason_allowed ?? []) reasonAllowed.add(pinKey(e));
  const effective = new Map([...deferred, ...declared]);
  const pinned = new Set([...declared.keys(), ...deferred.keys(), ...reasonAllowed]);
  const cases = new Set([...pinned].map((k) => k.split('|')[0]));
  return { declared, deferred, reasonAllowed, effective, pinned, cases };
}

/** declarations.frozen.json: well formed, and append-only against the merge base. */
export function pinProblems(basePin, headPin) {
  const p = [];
  const name = 'declarations.frozen.json';
  if (basePin && !headPin) return [`${name}: removed`];
  if (!headPin) return p;
  if (headPin.format !== DECLARATIONS_FORMAT) p.push(`${name}: format is not ${DECLARATIONS_FORMAT}`);
  for (const list of PIN_LISTS) {
    const h = headPin[list];
    if (!Array.isArray(h)) { p.push(`${name}: ${list} is not an array`); continue; }
    const seen = new Set();
    for (const e of h) {
      const ok = e && typeof e === 'object' && typeof e.case === 'string' && e.case && typeof e.path === 'string' && e.path
        && (list === 'reason_allowed' || (typeof e.expect === 'string' && e.expect && typeof e.input_digest === 'string' && /^[0-9a-f]{64}$/.test(e.input_digest)));
      if (!ok) { p.push(`${name}: ${list}: malformed entry ${JSON.stringify(e).slice(0, 120)}`); continue; }
      if (seen.has(pinKey(e))) p.push(`${name}: ${list}: ${pinKey(e)} appears twice`);
      seen.add(pinKey(e));
    }
    const b = Array.isArray(basePin?.[list]) ? basePin[list] : [];
    for (let i = 0; i < b.length; i += 1) {
      if (!same(b[i], h[i])) p.push(`${name} is append-only: ${list} entry ${i} (${pinKey(b[i])}) was edited or removed`);
    }
  }
  const head = pinMaps(headPin);
  // An added deferred entry is for a path that is not declared and not on
  // the corpus_fix_reason list. (A merge-base deferred entry stays when a
  // later declaration supersedes it; the pin is append-only.)
  const baseDeferredCount = Array.isArray(basePin?.deferred) ? basePin.deferred.length : 0;
  for (const e of Array.isArray(headPin.deferred) ? headPin.deferred.slice(baseDeferredCount) : []) {
    const k = pinKey(e);
    if (head.declared.has(k)) p.push(`${name}: deferred entry ${k} names a declared path`);
    if (head.reasonAllowed.has(k)) p.push(`${name}: deferred entry ${k} names a reason_allowed path`);
  }
  if (!basePin) {
    // First pin: a reason_allowed path must never have been declared.
    for (const e of Array.isArray(headPin.reason_allowed) ? headPin.reason_allowed : []) {
      const k = pinKey(e);
      if (head.declared.has(k) || head.deferred.has(k)) p.push(`${name}: reason_allowed entry ${k} names a declared path`);
    }
    return p;
  }
  const base = pinMaps(basePin);
  // reason_allowed is frozen: exactly the merge-base list, nothing appended.
  const baseReason = Array.isArray(basePin.reason_allowed) ? basePin.reason_allowed : [];
  const headReason = Array.isArray(headPin.reason_allowed) ? headPin.reason_allowed : [];
  for (const e of headReason.slice(baseReason.length)) p.push(`${name}: reason_allowed is frozen; ${pinKey(e)} may not be added`);
  // An appended declaration is a real decision: never declared before, not
  // the deferred value it replaces, and not a cause that decides nothing.
  for (const e of Array.isArray(headPin.declarations) ? headPin.declarations.slice((basePin.declarations ?? []).length) : []) {
    const k = pinKey(e);
    if (base.declared.has(k)) p.push(`${name}: ${k} is already declared`);
    if (base.deferred.has(k) && e?.expect === base.deferred.get(k)) p.push(`${name}: ${k} is deferred as ${JSON.stringify(base.deferred.get(k))}; a declaration for it must name a real decision, not the deferred value`);
    if (typeof e?.expect === 'string' && isNonDecision(e.expect)) p.push(`${name}: ${k} may not be declared ${JSON.stringify(e.expect)}, which makes no decision by the case rule`);
  }
  return p;
}

/** synthetic.mjs `expect` values of an export (or of caseDeclarations), as case|path -> value. */
export function exportDeclarations(casesOrInputs) {
  const list = Array.isArray(casesOrInputs?.cases)
    ? casesOrInputs.cases.map((c) => [c.id, c.expect])
    : Object.entries(casesOrInputs ?? {}).map(([id, d]) => [id, d?.expect]);
  const out = new Map();
  for (const [id, expect] of list) {
    if (expect == null) continue;
    if (typeof expect !== 'object' || Array.isArray(expect)) { out.set(`${id}|*`, expect); continue; }
    for (const [path, v] of Object.entries(expect)) out.set(`${id}|${path}`, v);
  }
  return out;
}

/**
 * Case paths of an export (`cases`: id and paths) that the pin does not
 * classify: every case path is declared, deferred or on reason_allowed.
 */
export function unclassifiedPaths(cases, pin) {
  const { pinned } = pinMaps(pin);
  const out = [];
  for (const c of Array.isArray(cases) ? cases : []) {
    for (const path of Array.isArray(c?.paths) ? c.paths : []) {
      const k = `${c.id}|${path}`;
      if (!pinned.has(k)) out.push(k);
    }
  }
  return out;
}

/** Differences between synthetic.mjs declarations and a pin, by case|path. */
export function declarationDrift(decls, pin) {
  const want = pinMaps(pin).effective;
  const p = [];
  for (const [k, v] of decls) {
    if (!want.has(k)) p.push(`${k} is declared in synthetic.mjs (${JSON.stringify(v)}) but not pinned`);
    else if (want.get(k) !== v) p.push(`${k} is ${JSON.stringify(v)} in synthetic.mjs, pinned ${JSON.stringify(want.get(k))}`);
  }
  for (const [k, v] of want) if (!decls.has(k)) p.push(`${k} is pinned ${JSON.stringify(v)} but not declared in synthetic.mjs`);
  return p;
}

/**
 * A corpus correction must keep the case decided by the rule pinned for it
 * at the MERGE BASE (declarations.frozen.json read from the merge-base
 * commit): the merge-base verifier's cause (else reason) on the head input
 * must equal the pinned value exactly. A deferred path takes no correction.
 * A rule-class path that is not declared takes only kind corpus_fix_reason,
 * and only if the merge-base pin lists it in reason_allowed (paths that
 * were never declared). So a case cannot be neutered in one PR and its
 * rule loosened in a later one, and editing synthetic.mjs changes nothing
 * the gate accepts.
 */
function declaredProblems(key, ch, baseCases, baseOnHead, basePinMaps, headPinMaps) {
  const [id] = key.split('|');
  if (!baseCases) return ['corpus_fix needs the merge-base case declarations (--base-tree)'];
  if (!basePinMaps) return [`corpus_fix needs ${DECLARATIONS_PIN} at the merge base`];
  if (basePinMaps.declared.has(key)) {
    const want = basePinMaps.declared.get(key);
    const o = baseOnHead?.[key];
    const got = String(o?.cause ?? o?.reason ?? '');
    const p = [];
    if (got !== want) p.push(`corpus_fix: the merge-base verifier on the head input is decided by ${JSON.stringify(got)}, not the merge-base declared ${JSON.stringify(want)}`);
    if (ch.kind === 'corpus_fix_reason') p.push('corpus_fix_reason is only for a case path with no declared expectation; use corpus_fix');
    return p;
  }
  if (basePinMaps.deferred.has(key)) {
    return [`corpus_fix: ${key} is deferred in declarations.frozen.json (declared ${JSON.stringify(basePinMaps.deferred.get(key))}, not by the case rule); append a declaration for it before any correction`];
  }
  if (ch.kind === 'corpus_fix_reason') {
    if (!basePinMaps.reasonAllowed.has(key)) return ['corpus_fix_reason is only for the paths listed in reason_allowed of the merge-base declarations.frozen.json'];
    if (headPinMaps && (headPinMaps.declared.has(key) || headPinMaps.deferred.has(key))) return ['corpus_fix_reason: the path is declared in the head declarations.frozen.json; use corpus_fix'];
    return [];
  }
  const decl = baseCases[id];
  if (RULE_CLASSES.has(String(decl?.class)) || basePinMaps.cases.has(id)) {
    return basePinMaps.reasonAllowed.has(key)
      ? [`corpus_fix: rule case path with no declared expectation at the merge base; use kind corpus_fix_reason with a note`]
      : [`corpus_fix: rule case path that is neither declared nor in reason_allowed at the merge base; append a declaration first`];
  }
  return [];
}

/** Merge-base case declarations by id: class, target, expect. */
export function caseDeclarations(inputs) {
  return Object.fromEntries((inputs?.cases ?? []).map((c) => [c.id, { class: c.class ?? null, target: c.target ?? null, expect: c.expect ?? null }]));
}

/** A corpus_fix must name a case whose input digest changed in this PR. */
function digestProblems(ch, baseDigests, headDigests) {
  if (!baseDigests || !headDigests) return ['corpus_fix needs the merge-base and head input digests (--base-tree, --head-inputs)'];
  const d = ch.input_digest;
  if (typeof d !== 'string' || !/^[0-9a-f]{64}$/.test(d)) return ['corpus_fix needs input_digest (sha256 of the case input)'];
  const head = headDigests[ch.case];
  const base = baseDigests[ch.case];
  const p = [];
  if (head === undefined) p.push('corpus_fix: case has no head input digest');
  else if (head !== d) p.push('corpus_fix: input_digest is not the head digest of the case');
  if (base === undefined) p.push('corpus_fix: case has no merge-base input digest');
  else if (base === d) p.push('corpus_fix: case input is unchanged from the merge base');
  return p;
}

// Corpus infrastructure under packages/verify/test/: what the corpus
// observes and how it runs, and the pinned case declarations. synthetic.mjs, baseline*.json, changes.json and
// manifest.json stay allowed next to a corpus_fix.
const CORPUS_INFRA = [
  /^test\/corpus\/lib\.mjs$/,
  /^test\/corpus\/run-[^/]*\.mjs$/,
  /^test\/corpus\/tape-[^/]*\.mjs$/,
  /^test\/corpus\/record[^/]*\.mjs$/,
  /^test\/corpus\/tapes\//,
  /^test\/history-file\.mjs$/,
  /^test\/corpus\/declarations\.frozen\.json$/,
  /^test\/golden-corpus\.test\.mjs$/,
];

/**
 * Paths whose change can move a verifier outcome, or what the corpus
 * observes of it. Default deny under packages/verify/: everything counts
 * except test/** (minus the corpus infrastructure above), *.md and
 * LICENSE. Also the @xfuel/verify alias (packages/aliases/chit402-verify/,
 * minus *.md) and any dist/ output anywhere.
 *
 * Matching is on the NFKC form in lower case, and a path with any
 * character outside printable ASCII counts as a verifier path outright, so
 * `SRC/`, `package.JSON` or a look-alike `ѕrc/` cannot pass as something
 * else.
 */
export function isVerifierPath(path) {
  const raw = String(path ?? '');
  if (!/^[\x20-\x7e]+$/.test(raw)) return true;
  const p = raw.normalize('NFKC').toLowerCase();
  if (/(^|\/)dist\//.test(p)) return true;
  const VERIFY = 'packages/verify/';
  if (p.startsWith(VERIFY)) {
    const rest = p.slice(VERIFY.length);
    if (rest.startsWith('src/')) return true;
    if (CORPUS_INFRA.some((re) => re.test(rest))) return true;
    if (rest.startsWith('test/')) return false;
    if (/^license(\.(md|txt))?$/.test(rest)) return false;
    if (rest.endsWith('.md')) return false;
    return true;
  }
  const ALIAS = 'packages/aliases/chit402-verify/';
  if (p.startsWith(ALIAS)) return !p.endsWith('.md');
  return false;
}

/** Files a change touches against the merge base, from git (data only). */
export function changedFilesOf(root, base, rev = 'HEAD') {
  try {
    const out = execFileSync('git', ['-C', root, 'diff', '--name-only', '--no-renames', '-z', base, rev], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
    return out.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/** A corpus_fix `to` must be what the merge-base verifier gives on the head input. */
function baseOnHeadProblems(key, ch, baseOnHead) {
  if (!baseOnHead) return ['corpus_fix needs the merge-base verifier outcomes on the head input (--base-tree, --head-inputs)'];
  if (!Object.prototype.hasOwnProperty.call(baseOnHead, key)) return ['corpus_fix: the merge-base verifier has no outcome for this case and path'];
  if (!sameOutcome(baseOnHead[key], ch.to)) {
    const b = baseOnHead[key] || {};
    return [`corpus_fix: \`to\` is not what the merge-base verifier gives on the head input (it gives exit ${b.exit} ${b.result} ${b.reason})`];
  }
  return [];
}

/** Pin entries appended against the merge-base pin (declarations and deferred). */
export function appendedPinEntries(basePin, headPin) {
  if (!basePin || !headPin) return [];
  const out = [];
  for (const list of ['declarations', 'deferred']) {
    const b = Array.isArray(basePin[list]) ? basePin[list] : [];
    const h = Array.isArray(headPin[list]) ? headPin[list] : [];
    for (const e of h.slice(b.length)) if (e && typeof e === 'object') out.push({ list, ...e });
  }
  return out;
}

/**
 * Every declared and deferred pin entry carries the input digest of its
 * case. The head input of the case must have exactly that digest: an input
 * is never changed under a pinned path (a changed input is a new case).
 */
export function pinDigestProblems(headPin, headDigests) {
  if (!headPin || !headDigests) return [];
  const p = [];
  for (const list of ['declarations', 'deferred']) {
    for (const e of Array.isArray(headPin[list]) ? headPin[list] : []) {
      const d = headDigests[e?.case];
      if (d !== undefined && d !== e?.input_digest) p.push(`${pinKey(e)}: the head input digest differs from the input_digest pinned in declarations.frozen.json; a changed input needs a new case`);
    }
  }
  return p;
}

/**
 * An appended declaration or deferred entry is bound to the verifier: its
 * expect must equal what the MERGE-BASE verifier gives (cause, else reason)
 * on the head input of that path, and an existing case's head input must
 * be unchanged from the merge base. So a value cannot be chosen, only read
 * off main's verifier on main's input.
 */
export function appendBindingProblems(basePin, headPin, baseOnHead, baseDigests, headDigests) {
  const p = [];
  for (const e of appendedPinEntries(basePin, headPin)) {
    const k = pinKey(e);
    if (!baseOnHead || !headDigests || !baseDigests) { p.push(`${k}: a pin append needs the merge-base verifier outcomes and input digests (--base-tree, --head-inputs)`); continue; }
    if (!Object.prototype.hasOwnProperty.call(baseOnHead, k)) { p.push(`${k}: a pin append needs a merge-base verifier outcome for this case and path`); continue; }
    const o = baseOnHead[k];
    const got = String(o?.cause ?? o?.reason ?? '');
    if (got !== e.expect) p.push(`${k}: pinned ${JSON.stringify(e.expect)}, but the merge-base verifier on the head input gives ${JSON.stringify(got)}`);
    const base = baseDigests[e.case];
    if (base !== undefined && base !== headDigests[e.case]) p.push(`${k}: a pin append for an existing case needs its input unchanged from the merge base`);
  }
  return p;
}

/**
 * Baseline rows of pinned paths.
 *   - A declared path's row records its decision: for cli the `reason`
 *     equals the declared value, for library and signature the row
 *     carries `cause` equal to it. A changed row keeps the merge-base
 *     `reason` and `cause`, so a tighten or a src change cannot re-decide
 *     a declared case at the same exit (or at any exit).
 *   - A deferred path may change `reason` or `cause` only with a strictly
 *     tighter exit (2 -> 1).
 * The movement rules apply once the merge base has a pin; the first pin
 * (this file's bootstrap) records the causes.
 */
export function declarationRowProblems(base, head, basePinMaps, headPinMaps) {
  const p = [];
  const declared = new Map([...(headPinMaps?.declared ?? []), ...(basePinMaps?.declared ?? [])]);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  for (const [key, want] of declared) {
    if (!has(head, key)) continue;
    const now = head[key];
    const path = key.split('|')[1];
    if (path === 'cli') {
      if (now?.reason !== want) p.push(`${key}: baseline reason ${JSON.stringify(now?.reason)} is not the declared ${JSON.stringify(want)}`);
    } else if ((now?.cause ?? null) !== want) {
      p.push(`${key}: baseline cause ${JSON.stringify(now?.cause ?? null)} is not the declared ${JSON.stringify(want)} (a declared ${path} row records its cause)`);
    }
    if (basePinMaps && has(base, key) && !same(base[key], now)) {
      const was = base[key];
      if (now?.reason !== was?.reason) p.push(`${key}: the reason of a declared path may not change (${JSON.stringify(was?.reason)} -> ${JSON.stringify(now?.reason)})`);
      if (was?.cause !== undefined && (now?.cause ?? null) !== (was.cause ?? null)) p.push(`${key}: the cause of a declared path may not change (${JSON.stringify(was.cause)} -> ${JSON.stringify(now?.cause ?? null)})`);
    }
  }
  // The movement rules hold once the merge base has a pin (not on the first pin).
  if (!basePinMaps) return p;
  const deferred = new Map([...(headPinMaps?.deferred ?? []), ...(basePinMaps?.deferred ?? [])]);
  for (const key of deferred.keys()) {
    if (declared.has(key) || !has(base, key) || !has(head, key)) continue;
    const was = base[key];
    const now = head[key];
    const moved = now?.reason !== was?.reason || (now?.cause ?? null) !== (was?.cause ?? null);
    if (moved && !(exitRank(now?.exit) < exitRank(was?.exit))) p.push(`${key}: a deferred path may change reason or cause only with a strictly tighter exit (exit ${was?.exit} -> ${now?.exit})`);
  }
  return p;
}

const GOLDEN = 'packages/verify/test/golden-corpus.test.mjs';

/** A change that touches golden-corpus.test.mjs may not change any pinned baseline row (once the merge base has a pin). */
export function goldenEditProblems(base, head, changedFiles, basePinMaps, headPinMaps) {
  if (!basePinMaps) return [];
  if (!Array.isArray(changedFiles) || !changedFiles.some((f) => String(f).normalize('NFKC').toLowerCase() === GOLDEN)) return [];
  const pinned = new Set([...(basePinMaps?.pinned ?? []), ...(headPinMaps?.pinned ?? [])]);
  const p = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (!pinned.has(key)) continue;
    if (!same(base[key], head[key])) p.push(`${key}: a pinned baseline row may not change in the same change as test/golden-corpus.test.mjs`);
  }
  return p;
}

/**
 * State of the merge-base pin (`ok`, `missing`, `unparseable`, or null
 * when not read). `required`: the merge-base corpus-gate.mjs reads
 * declarations.frozen.json, so main has had a pin and must still have it.
 */
export function basePinStateProblems(state, required) {
  if (state === 'unparseable') return [`${DECLARATIONS_PIN} at the merge base is not valid JSON; the gate fails closed`];
  if (state === 'missing' && required) return [`${DECLARATIONS_PIN} is missing at the merge base, whose gate reads it; the gate fails closed`];
  return [];
}

/**
 * Pure gate. Each argument is parsed JSON (or null when the file does not
 * exist on that side). Returns a list of problems.
 */
export function gate({ baseBaseline, headBaseline, baseChanges, headChanges, baseRegistry, headRegistry, baseDigests = null, headDigests = null, baseOnHead = null, changedFiles = null, baseCases = null, basePin = null, headPin = null, headDecls = null, headCases = null, basePinState = null, basePinRequired = false }) {
  const problems = [];
  // The merge-base pin, read as data: an unparseable one always fails, and
  // a missing one fails once the merge-base gate knows the pin (only the
  // change that adds the pin runs without one).
  problems.push(...basePinStateProblems(basePinState, basePinRequired));
  // Pinned declarations: append-only, and the head synthetic.mjs must agree
  // with the head pin whenever the head export is given.
  problems.push(...pinProblems(basePin, headPin));
  if (headDecls && headPin) for (const d of declarationDrift(headDecls, headPin)) problems.push(`synthetic.mjs (head) and declarations.frozen.json (head) differ: ${d}`);
  // Pinned input digests, and appends bound to the merge-base verifier.
  problems.push(...pinDigestProblems(headPin, headDigests));
  problems.push(...appendBindingProblems(basePin, headPin, baseOnHead, baseDigests, headDigests));
  // Every head case path is classified by the head pin.
  if (headCases && headPin) for (const k of unclassifiedPaths(headCases, headPin)) problems.push(`${k}: case path in synthetic.mjs (head) is not in declarations.frozen.json (head); declare it, or defer it with its current expect`);
  const basePinMaps = basePin ? pinMaps(basePin) : null;
  const headPinMaps = headPin ? pinMaps(headPin) : null;
  const bEntries = baseChanges?.changes ?? [];
  const hEntries = headChanges?.changes ?? [];
  if (!Array.isArray(hEntries)) return ['changes.json: `changes` is not an array'];
  for (let i = 0; i < bEntries.length; i += 1) {
    if (!same(bEntries[i], hEntries[i])) problems.push(`changes.json is append-only: entry ${i} was edited or removed`);
  }
  const added = hEntries.slice(bEntries.length);
  const addedFor = new Map();
  for (const ch of added) {
    const kind = ch?.kind ?? 'tighten';
    if (!['tighten', 'corpus_fix', 'corpus_fix_reason', 'registry'].includes(kind)) { problems.push(`changes.json: unknown kind ${JSON.stringify(kind)}`); continue; }
    if (!ch.pr || !ch.spec) problems.push(`changes.json: entry without pr and spec: ${JSON.stringify(ch).slice(0, 120)}`);
    if (kind === 'registry') continue;
    if (!ch.case || !ch.path) { problems.push(`changes.json: entry without case and path: ${JSON.stringify(ch).slice(0, 120)}`); continue; }
    const key = `${ch.case}|${ch.path}`;
    if (addedFor.has(key)) problems.push(`changes.json: two added entries for ${key}`);
    addedFor.set(key, { ...ch, kind });
  }

  const base = baseBaseline ?? {};
  const head = headBaseline ?? {};
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // A corpus correction (corpus_fix entry, or a baseline row removed) may
  // not share a change with a verifier change: the verifier would be
  // judged against inputs and rows edited in the same breath.
  const corrections = [
    ...[...addedFor].filter(([, ch]) => isFixKind(ch.kind)).map(([key]) => key),
    ...Object.keys(base).filter((key) => !has(head, key) && !isFixKind(addedFor.get(key)?.kind)),
  ];
  if (corrections.length) {
    if (!basePin) problems.push(`corpus corrections need ${DECLARATIONS_PIN} at the merge base`);
    else if (!baseCases) problems.push('corpus corrections need the merge-base case declarations (--base-tree)');
    else {
      const drift = declarationDrift(exportDeclarations(baseCases), basePin);
      if (drift.length) {
        problems.push(`corpus corrections are refused while synthetic.mjs and declarations.frozen.json differ at the merge base: ${drift.slice(0, 3).join('; ')}${drift.length > 3 ? `; and ${drift.length - 3} more` : ''}`);
      }
    }
    if (!headDecls) problems.push('corpus corrections need the head case declarations (--head-inputs)');
    if (!headPin) problems.push(`corpus corrections need ${DECLARATIONS_PIN} at the head`);
    // A pinned case path is never removed.
    for (const key of corrections) {
      if (has(base, key) && !has(head, key) && (basePinMaps?.pinned.has(key) || headPinMaps?.pinned.has(key))) {
        problems.push(`${key}: a case path pinned in declarations.frozen.json may not be removed`);
      }
    }
    if (!Array.isArray(changedFiles)) {
      problems.push('corpus corrections need the list of files this change touches (git diff against the merge base)');
    } else {
      const touched = changedFiles.filter(isVerifierPath);
      if (touched.length) {
        const shown = touched.slice(0, 3).join(', ') + (touched.length > 3 ? `, and ${touched.length - 3} more` : '');
        for (const key of corrections) {
          problems.push(`${key}: corpus_fix or baseline removal in the same change as a verifier change (${shown}); land them in separate changes`);
        }
      }
    }
  }

  // Pinned rows (declarationRowProblems, goldenEditProblems).
  if (basePinMaps || headPinMaps) {
    problems.push(...declarationRowProblems(base, head, basePinMaps, headPinMaps));
    problems.push(...goldenEditProblems(base, head, changedFiles, basePinMaps, headPinMaps));
  }

  const checked = new Set();
  const checkCorpusFix = (key, ch, now) => {
    checked.add(key);
    if (isReal(key)) problems.push(`${key}: corpus_fix is only for synthetic cases`);
    if (!ch.note) problems.push(`${key}: corpus_fix needs a note`);
    if (now && (now.exit === 0 || resultRank(now.result) === 2)) problems.push(`${key}: corpus_fix may not move a case to exit 0`);
    if (ch.to === null) {
      if ((basePinMaps?.pinned.has(key) || headPinMaps?.pinned.has(key)) && has(head, key)) problems.push(`${key}: to: null on a case path pinned in declarations.frozen.json`);
      return;
    }
    for (const p of digestProblems(ch, baseDigests, headDigests)) problems.push(`${key}: ${p}`);
    for (const p of baseOnHeadProblems(key, ch, baseOnHead)) problems.push(`${key}: ${p}`);
    for (const p of declaredProblems(key, ch, baseCases, baseOnHead, basePinMaps, headPinMaps)) problems.push(`${key}: ${p}`);
  };

  for (const key of Object.keys(base)) {
    const was = base[key];
    const now = Object.prototype.hasOwnProperty.call(head, key) ? head[key] : undefined;
    if (now !== undefined && same(was, now)) continue;
    const ch = addedFor.get(key);
    if (now === undefined) {
      if (isReal(key)) problems.push(`${key}: a real receipt case was removed from the baseline`);
      else if (!ch || ch.kind !== 'corpus_fix' || ch.to !== null || !ch.note) problems.push(`${key}: removed without a corpus_fix entry (to: null, with a note)`);
      if (isFixKind(ch?.kind)) checked.add(key);
      continue;
    }
    if (!ch) { problems.push(`${key}: baseline changed with no changes.json entry added in this change`); continue; }
    if (!same(ch.to, now)) problems.push(`${key}: baseline value is not the changes.json entry's \`to\``);
    for (const p of wellFormed(now)) problems.push(`${key}: ${p}`);
    if (ch.kind === 'tighten') {
      for (const p of looser(was, now)) problems.push(`${key}: more permissive than the merge base: ${p}`);
    } else if (isFixKind(ch.kind)) {
      checkCorpusFix(key, ch, now);
    }
  }
  // A corpus_fix whose row did not move (an input change with the same
  // outcome) or that names a new row gets the same checks, and its `to`
  // must be the head row.
  for (const [key, ch] of addedFor) {
    if (!isFixKind(ch.kind) || checked.has(key)) continue;
    const now = has(head, key) ? head[key] : undefined;
    if (now === undefined) continue;
    if (!same(ch.to, now)) problems.push(`${key}: baseline value is not the changes.json entry's \`to\``);
    checkCorpusFix(key, ch, now);
  }
  for (const key of addedFor.keys()) {
    if (!Object.prototype.hasOwnProperty.call(base, key) && !Object.prototype.hasOwnProperty.call(head, key)) {
      problems.push(`changes.json: entry for ${key}, which is in neither baseline`);
    }
  }
  for (const [key, now] of Object.entries(head)) {
    if (Object.prototype.hasOwnProperty.call(base, key)) continue;
    for (const p of wellFormed(now)) problems.push(`${key} (new case): ${p}`);
  }

  // Frozen registry: append-only, and each appended entry is recorded.
  if (baseRegistry) {
    const b = baseRegistry.entries ?? [];
    const h = headRegistry?.entries ?? [];
    for (let i = 0; i < b.length; i += 1) {
      if (!same(b[i], h[i])) problems.push(`version-registry.frozen.json is append-only: entry ${i} (${b[i]?.id}) was edited or removed`);
    }
    const recorded = new Set(added.filter((ch) => ch?.kind === 'registry').map((ch) => ch.entry));
    for (const e of h.slice(b.length)) {
      if (!recorded.has(e?.id)) problems.push(`version-registry.frozen.json: entry ${e?.id} appended with no changes.json registry entry`);
    }
  }
  return problems;
}

/**
 * Chain tier (baseline-chain.json and tapes/public-chain.json), once the
 * merge base has them:
 *   - the chain tape is append-only: every merge-base entry is still there,
 *     byte for byte as JSON, and `recorded_at` is unchanged (chain answers are
 *     unsigned, so an edited answer could move a verdict);
 *   - a chain baseline row is never removed (a synthetic one only with a
 *     corpus_fix entry, to: null), and a changed row needs a changes.json
 *     entry added in the same change and must not be more permissive than
 *     the merge-base row (exit, result, overall, every check), and keeps
 *     its `result_detail`;
 *   - every row is well formed.
 */
export function gateChain({ baseChainBaseline, headChainBaseline, baseChainTape, headChainTape, baseChanges, headChanges }) {
  const problems = [];
  const added = (headChanges?.changes ?? []).slice((baseChanges?.changes ?? []).length);
  const addedFor = new Map(added.filter((c) => c && c.case && c.path).map((c) => [`${c.case}|${c.path}`, { ...c, kind: c.kind ?? 'tighten' }]));
  if (baseChainTape) {
    if (!headChainTape) problems.push('public-chain.json: removed');
    else {
      if (headChainTape.recorded_at !== baseChainTape.recorded_at) problems.push('public-chain.json: recorded_at changed');
      const b = baseChainTape.entries ?? {};
      const h = headChainTape.entries ?? {};
      for (const k of Object.keys(b)) {
        if (!Object.prototype.hasOwnProperty.call(h, k)) problems.push(`public-chain.json is append-only: entry ${k.slice(0, 80)} removed`);
        else if (!same(b[k], h[k])) problems.push(`public-chain.json is append-only: entry ${k.slice(0, 80)} edited`);
      }
    }
  }
  if (baseChainBaseline) {
    const head = headChainBaseline ?? {};
    for (const [key, was] of Object.entries(baseChainBaseline)) {
      const now = Object.prototype.hasOwnProperty.call(head, key) ? head[key] : undefined;
      if (now !== undefined && same(was, now)) continue;
      const ch = addedFor.get(key);
      if (now === undefined) {
        if (isReal(key)) problems.push(`chain ${key}: a real receipt case was removed from the chain baseline`);
        else if (!ch || ch.kind !== 'corpus_fix' || ch.to !== null || !ch.note) problems.push(`chain ${key}: removed without a corpus_fix entry (to: null, with a note)`);
        continue;
      }
      if (!ch) { problems.push(`chain ${key}: chain baseline changed with no changes.json entry added in this change`); continue; }
      for (const p of wellFormed(now)) problems.push(`chain ${key}: ${p}`);
      for (const p of looser(was, now)) problems.push(`chain ${key}: more permissive than the merge base: ${p}`);
      if ((was.result_detail ?? null) !== (now.result_detail ?? null)) problems.push(`chain ${key}: result_detail changed`);
    }
  }
  for (const [key, now] of Object.entries(headChainBaseline ?? {})) {
    if (baseChainBaseline && Object.prototype.hasOwnProperty.call(baseChainBaseline, key)) continue;
    for (const p of wellFormed(now)) problems.push(`chain ${key} (new case): ${p}`);
  }
  return problems;
}

function gitShow(root, rev, path) {
  try {
    return JSON.parse(execFileSync('git', ['-C', root, 'show', `${rev}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }));
  } catch {
    return null;
  }
}

/** A merge-base file as `{ state: 'ok' | 'missing' | 'unparseable', value, text }`. */
function gitShowState(root, rev, path) {
  let text;
  try {
    text = execFileSync('git', ['-C', root, 'show', `${rev}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  } catch {
    return { state: 'missing', value: null, text: null };
  }
  try { return { state: 'ok', value: JSON.parse(text), text }; } catch { return { state: 'unparseable', value: null, text }; }
}

function gitShowText(root, rev, path) {
  try { return execFileSync('git', ['-C', root, 'show', `${rev}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); } catch { return null; }
}

function readHead(root, path) {
  const p = join(root, path);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/** Added corpus_fix keys of a changes.json pair. */
export function addedCorpusFixKeys(baseChanges, headChanges) {
  const b = baseChanges?.changes ?? [];
  const h = Array.isArray(headChanges?.changes) ? headChanges.changes : [];
  return h.slice(b.length).filter((c) => isFixKind(c?.kind) && c.case && c.path).map((c) => `${c.case}|${c.path}`);
}

/**
 * Gate a checkout against a merge-base commit. Head files are read as data.
 * `baseTree` is the built merge-base packages/verify; `headInputs` is the
 * parsed export of the head tree. Both are needed for a corpus_fix.
 */
export async function gateRepo(root, base, { baseTree = null, headInputs = null } = {}) {
  const pinAtBase = gitShowState(root, base, DECLARATIONS_PIN);
  const baseGate = gitShowText(root, base, 'packages/verify/scripts/corpus-gate.mjs');
  const files = {
    baseBaseline: gitShow(root, base, BASELINE),
    headBaseline: readHead(root, BASELINE),
    baseChanges: gitShow(root, base, CHANGES),
    headChanges: readHead(root, CHANGES),
    baseRegistry: gitShow(root, base, REGISTRY_PIN),
    headRegistry: readHead(root, REGISTRY_PIN),
    basePin: pinAtBase.value,
    basePinState: pinAtBase.state,
    basePinRequired: typeof baseGate === 'string' && baseGate.includes('declarations.frozen.json'),
    headPin: readHead(root, DECLARATIONS_PIN),
  };
  const fixKeys = addedCorpusFixKeys(files.baseChanges, files.headChanges);
  const appendKeys = appendedPinEntries(files.basePin, files.headPin).map(pinKey);
  const extra = { baseDigests: null, headDigests: null, baseOnHead: null, baseCases: null, headDecls: null, headCases: null, changedFiles: changedFilesOf(root, base) };
  const problems = [];
  const corrections = fixKeys.length > 0 || Object.keys(files.baseBaseline ?? {}).some((k) => !Object.prototype.hasOwnProperty.call(files.headBaseline ?? {}, k));
  const inputsOk = !!headInputs && inputsProblems(headInputs).length === 0;
  if (headInputs && !inputsOk) problems.push(...inputsProblems(headInputs));
  if (inputsOk) {
    extra.headDecls = exportDeclarations(headInputs);
    extra.headCases = headInputs.cases.map((c) => ({ id: c.id, paths: c.paths }));
    extra.headDigests = inputDigests(headInputs);
  }
  const needBase = fixKeys.length > 0 || appendKeys.length > 0;
  if (baseTree && (corrections || needBase)) {
    try {
      const baseInputs = await exportInputs(baseTree);
      extra.baseCases = caseDeclarations(baseInputs);
      if (needBase) extra.baseDigests = inputDigests(baseInputs);
    } catch (e) { problems.push(`merge-base inputs could not be built: ${e.message}`); }
  }
  if (needBase && baseTree && inputsOk) {
    extra.baseOnHead = await baseOutcomes(baseTree, headInputs, [...new Set([...fixKeys, ...appendKeys])]);
  }
  const chain = gateChain({
    baseChainBaseline: gitShow(root, base, CHAIN_BASELINE),
    headChainBaseline: readHead(root, CHAIN_BASELINE),
    baseChainTape: gitShow(root, base, CHAIN_TAPE),
    headChainTape: readHead(root, CHAIN_TAPE),
    baseChanges: files.baseChanges,
    headChanges: files.headChanges,
  });
  return [...problems, ...gate({ ...files, ...extra }), ...chain];
}

const isMain = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === 'export') {
    if (!args[1]) { console.error('usage: corpus-gate.mjs export <packages/verify dir>'); process.exit(3); }
    process.stdout.write(`${JSON.stringify(await exportInputs(args[1]))}\n`);
    process.exit(0);
  }
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const base = opt('--base');
  const root = opt('--root') || process.cwd();
  if (!base) { console.error('usage: corpus-gate.mjs --base <commit> [--root <repo>] [--base-tree <dir> --head-inputs <json>]'); process.exit(3); }
  try { execFileSync('git', ['-C', root, 'rev-parse', '--verify', `${base}^{commit}`], { stdio: 'ignore' }); } catch { console.error(`corpus-gate: unknown base ${base}`); process.exit(3); }
  const inputsFile = opt('--head-inputs');
  const problems = await gateRepo(root, base, {
    baseTree: opt('--base-tree'),
    headInputs: inputsFile ? JSON.parse(readFileSync(inputsFile, 'utf8')) : null,
  });
  if (problems.length) {
    for (const p of problems) console.error(`corpus-gate: ${p}`);
    process.exit(1);
  }
  console.log(`corpus-gate: ok against ${base}`);
}
