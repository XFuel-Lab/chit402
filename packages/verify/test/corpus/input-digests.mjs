#!/usr/bin/env node
/**
 * Per-case input digests for the synthetic corpus cases.
 *
 *   node test/corpus/input-digests.mjs <packages/verify dir>   # prints JSON
 *
 * Builds the synthetic cases of the given tree (it needs that tree's dist)
 * and prints { "<case id>": "<sha256>" }. The digest covers the case
 * document with key material and signature bytes left out, since those
 * come from a throwaway key on every run: a JWS keeps its header and
 * claims, a detached signature keeps everything but `value`, and
 * `issuer_jwk` is dropped. The hash of the run's covering test history (in
 * the signed pin and its outer copy) is replaced by a marker. Same inputs
 * give the same digest on every run.
 *
 * scripts/corpus-gate.mjs uses the merge-base and head digests: a
 * corpus_fix entry must name a case whose digest changed in the same PR.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Hashes of the covering test histories written in this run.
const TEST_HISTORY_HASHES = new Set();

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  // The covering test history hash changes every run (throwaway key).
  if (typeof value === 'string' && TEST_HISTORY_HASHES.has(value)) return JSON.stringify('<covering test history>');
  return JSON.stringify(value);
}

/** The run-independent part of a case document. */
export function digestInput(doc) {
  const copy = JSON.parse(JSON.stringify(doc));
  const strip = (sig) => {
    if (!sig || typeof sig !== 'object') return;
    if (typeof sig.jws === 'string') {
      const [h, c] = sig.jws.split('.');
      const part = (b) => { try { return JSON.parse(Buffer.from(b || '', 'base64url').toString('utf8')); } catch { return b ?? null; } };
      const claims = part(c);
      sig.jws = { header: part(h), claims };
    }
    delete sig.value;
    delete sig.issuer_jwk;
  };
  strip(copy.issuer_signature);
  return createHash('sha256').update(stable(copy)).digest('hex');
}

export async function inputDigests(pkgDir) {
  const synth = join(resolve(pkgDir), 'test', 'corpus', 'synthetic.mjs');
  let mod;
  try {
    mod = await import(pathToFileURL(synth).href);
  } catch {
    return {};
  }
  const cases = await mod.buildSynthetic(mkdtempSync(join(tmpdir(), 'corpus-digest-')));
  try {
    const { issuerHistoryDocumentHash } = await import(pathToFileURL(join(resolve(pkgDir), 'dist', 'issuer-history.js')).href);
    for (const c of cases) if (c.historyFile) TEST_HISTORY_HASHES.add(issuerHistoryDocumentHash(JSON.parse(readFileSync(c.historyFile, 'utf8'))));
  } catch { /* tree without a test history */ }
  const out = {};
  for (const c of cases) out[c.id] = digestInput(JSON.parse(readFileSync(c.file, 'utf8')));
  return out;
}

const isMain = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: input-digests.mjs <packages/verify dir>'); process.exit(3); }
  process.stdout.write(`${JSON.stringify(await inputDigests(dir), null, 1)}\n`);
}
