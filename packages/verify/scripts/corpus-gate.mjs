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
 *     the head pin; a corpus correction also needs the merge-base pin, and
 *     the merge-base synthetic.mjs `expect` values equal to it (see
 *     declaredProblems for what the pin allows);
 *   - the chain tier breaks its rules (gateChain below).
 *
 * Self-contained on purpose: CI runs the copy of this file from the merge
 * base, so a change cannot loosen the gate that checks it.
 * Exit 0: no problems. Exit 1: problems listed on stderr. Exit 3: usage.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

/** Digest of one exported case: document, issuer history and JWKS. */
export function caseDigest(c) {
  return sha256(stable({ doc: docForm(c.doc, c.history), history: historyForm(c.history), jwks: jwksForm(c.jwks) }));
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
const RULE_CLASSES = new Set(['version', 'gate', 'timing']);

// ---------- pinned case declarations (declarations.frozen.json) ----------

export const DECLARATIONS_FORMAT = 'chit402.corpus-declarations.v1';
const PIN_LISTS = ['declarations', 'deferred', 'reason_allowed'];
const pinKey = (e) => `${e?.case}|${e?.path}`;

/**
 * The pin as maps. `declared`: exact expected cause or reason per
 * case|path. `deferred`: declared in synthetic.mjs today but not by the
 * case rule (an appended declaration for the same path supersedes it).
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
        && (list === 'reason_allowed' || (typeof e.expect === 'string' && e.expect));
      if (!ok) { p.push(`${name}: ${list}: malformed entry ${JSON.stringify(e).slice(0, 120)}`); continue; }
      if (seen.has(pinKey(e))) p.push(`${name}: ${list}: ${pinKey(e)} appears twice`);
      seen.add(pinKey(e));
    }
    const b = Array.isArray(basePin?.[list]) ? basePin[list] : [];
    for (let i = 0; i < b.length; i += 1) {
      if (!same(b[i], h[i])) p.push(`${name} is append-only: ${list} entry ${i} (${pinKey(b[i])}) was edited or removed`);
    }
  }
  // A path on the corpus_fix_reason list must never have been declared, so
  // an appended reason_allowed entry may not name a declared or deferred path.
  const head = pinMaps(headPin);
  const baseReason = new Set((Array.isArray(basePin?.reason_allowed) ? basePin.reason_allowed : []).map(pinKey));
  for (const e of Array.isArray(headPin.reason_allowed) ? headPin.reason_allowed : []) {
    const k = pinKey(e);
    if (baseReason.has(k)) continue;
    if (head.declared.has(k) || head.deferred.has(k)) p.push(`${name}: reason_allowed entry ${k} names a declared path`);
  }
  if (basePin) {
    const base = pinMaps(basePin);
    // A declaration may supersede a deferred entry; it may not be declared twice.
    for (const e of Array.isArray(headPin.declarations) ? headPin.declarations.slice((basePin.declarations ?? []).length) : []) {
      if (base.declared.has(pinKey(e))) p.push(`${name}: ${pinKey(e)} is already declared`);
    }
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

/**
 * Pure gate. Each argument is parsed JSON (or null when the file does not
 * exist on that side). Returns a list of problems.
 */
export function gate({ baseBaseline, headBaseline, baseChanges, headChanges, baseRegistry, headRegistry, baseDigests = null, headDigests = null, baseOnHead = null, changedFiles = null, baseCases = null, basePin = null, headPin = null, headDecls = null }) {
  const problems = [];
  // Pinned declarations: append-only, and the head synthetic.mjs must agree
  // with the head pin whenever the head export is given.
  problems.push(...pinProblems(basePin, headPin));
  if (headDecls && headPin) for (const d of declarationDrift(headDecls, headPin)) problems.push(`synthetic.mjs (head) and declarations.frozen.json (head) differ: ${d}`);
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
  const files = {
    baseBaseline: gitShow(root, base, BASELINE),
    headBaseline: readHead(root, BASELINE),
    baseChanges: gitShow(root, base, CHANGES),
    headChanges: readHead(root, CHANGES),
    baseRegistry: gitShow(root, base, REGISTRY_PIN),
    headRegistry: readHead(root, REGISTRY_PIN),
    basePin: gitShow(root, base, DECLARATIONS_PIN),
    headPin: readHead(root, DECLARATIONS_PIN),
  };
  const fixKeys = addedCorpusFixKeys(files.baseChanges, files.headChanges);
  const extra = { baseDigests: null, headDigests: null, baseOnHead: null, baseCases: null, headDecls: null, changedFiles: changedFilesOf(root, base) };
  const problems = [];
  const corrections = fixKeys.length > 0 || Object.keys(files.baseBaseline ?? {}).some((k) => !Object.prototype.hasOwnProperty.call(files.headBaseline ?? {}, k));
  if (headInputs && inputsProblems(headInputs).length === 0) extra.headDecls = exportDeclarations(headInputs);
  if (corrections && baseTree && !fixKeys.length) {
    try { extra.baseCases = caseDeclarations(await exportInputs(baseTree)); } catch (e) { problems.push(`merge-base inputs could not be built: ${e.message}`); }
  }
  if (fixKeys.length && baseTree && headInputs) {
    const bad = inputsProblems(headInputs);
    if (bad.length) problems.push(...bad);
    else {
      extra.headDigests = inputDigests(headInputs);
      try {
        const baseInputs = await exportInputs(baseTree);
        extra.baseDigests = inputDigests(baseInputs);
        extra.baseCases = caseDeclarations(baseInputs);
      } catch (e) { problems.push(`merge-base inputs could not be built: ${e.message}`); }
      extra.baseOnHead = await baseOutcomes(baseTree, headInputs, fixKeys);
    }
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
