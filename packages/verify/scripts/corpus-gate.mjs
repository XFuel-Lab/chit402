#!/usr/bin/env node
/**
 * Corpus baseline gate. Compares the golden corpus baseline, changes.json
 * and the frozen version registry with their merge-base versions.
 *
 *   node packages/verify/scripts/corpus-gate.mjs --base <commit> [--root <repo>]
 *
 * Fails (exit 1) when:
 *   - a baseline.json entry differs from the merge base and no changes.json
 *     entry added in this change names that case and path, or the head
 *     value is not the entry's `to`;
 *   - an added `tighten` entry (the default kind) is not at least as strict
 *     as the merge-base outcome (exit, result, overall and every check);
 *   - an added `corpus_fix` entry is for a real receipt (id-* or file-*), has
 *     no note, or moves a case to exit 0 / verified;
 *   - a real receipt case is removed from the baseline;
 *   - changes.json is not append-only (an existing entry is edited or
 *     dropped);
 *   - the frozen registry file is not append-only, or an appended entry has
 *     no added `registry` changes.json entry.
 *
 * Self-contained on purpose: CI runs the copy of this file from the merge
 * base, so a change cannot loosen the gate that checks it.
 * Exit 0: no problems. Exit 1: problems listed on stderr. Exit 3: usage.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE = 'packages/verify/test/corpus/baseline.json';
export const CHANGES = 'packages/verify/test/corpus/changes.json';
export const REGISTRY_PIN = 'packages/verify/test/fixtures/version-registry.frozen.json';

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

/**
 * Pure gate. Each argument is parsed JSON (or null when the file does not
 * exist on that side). Returns a list of problems.
 */
export function gate({ baseBaseline, headBaseline, baseChanges, headChanges, baseRegistry, headRegistry }) {
  const problems = [];
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
    if (!['tighten', 'corpus_fix', 'registry'].includes(kind)) { problems.push(`changes.json: unknown kind ${JSON.stringify(kind)}`); continue; }
    if (!ch.pr || !ch.spec) problems.push(`changes.json: entry without pr and spec: ${JSON.stringify(ch).slice(0, 120)}`);
    if (kind === 'registry') continue;
    if (!ch.case || !ch.path) { problems.push(`changes.json: entry without case and path: ${JSON.stringify(ch).slice(0, 120)}`); continue; }
    const key = `${ch.case}|${ch.path}`;
    if (addedFor.has(key)) problems.push(`changes.json: two added entries for ${key}`);
    addedFor.set(key, { ...ch, kind });
  }

  const base = baseBaseline ?? {};
  const head = headBaseline ?? {};
  for (const key of Object.keys(base)) {
    const was = base[key];
    const now = Object.prototype.hasOwnProperty.call(head, key) ? head[key] : undefined;
    if (now !== undefined && same(was, now)) continue;
    const ch = addedFor.get(key);
    if (now === undefined) {
      if (isReal(key)) problems.push(`${key}: a real receipt case was removed from the baseline`);
      else if (!ch || ch.kind !== 'corpus_fix' || ch.to !== null || !ch.note) problems.push(`${key}: removed without a corpus_fix entry (to: null, with a note)`);
      continue;
    }
    if (!ch) { problems.push(`${key}: baseline changed with no changes.json entry added in this change`); continue; }
    if (!same(ch.to, now)) problems.push(`${key}: baseline value is not the changes.json entry's \`to\``);
    for (const p of wellFormed(now)) problems.push(`${key}: ${p}`);
    if (ch.kind === 'tighten') {
      for (const p of looser(was, now)) problems.push(`${key}: more permissive than the merge base: ${p}`);
    } else if (ch.kind === 'corpus_fix') {
      if (isReal(key)) problems.push(`${key}: corpus_fix is only for synthetic cases`);
      if (!ch.note) problems.push(`${key}: corpus_fix needs a note`);
      if ((now.exit === 0 || now.result === 'verified') && !key.endsWith('|signature')) problems.push(`${key}: corpus_fix may not move a case to exit 0`);
    }
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

export function gateRepo(root, base) {
  return gate({
    baseBaseline: gitShow(root, base, BASELINE),
    headBaseline: readHead(root, BASELINE),
    baseChanges: gitShow(root, base, CHANGES),
    headChanges: readHead(root, CHANGES),
    baseRegistry: gitShow(root, base, REGISTRY_PIN),
    headRegistry: readHead(root, REGISTRY_PIN),
  });
}

const isMain = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const base = opt('--base');
  const root = opt('--root') || process.cwd();
  if (!base) { console.error('usage: corpus-gate.mjs --base <commit> [--root <repo>]'); process.exit(3); }
  try { execFileSync('git', ['-C', root, 'rev-parse', '--verify', `${base}^{commit}`], { stdio: 'ignore' }); } catch { console.error(`corpus-gate: unknown base ${base}`); process.exit(3); }
  const problems = gateRepo(root, base);
  if (problems.length) {
    for (const p of problems) console.error(`corpus-gate: ${p}`);
    process.exit(1);
  }
  console.log(`corpus-gate: ok against ${base}`);
}
