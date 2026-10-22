#!/usr/bin/env node
/**
 * One-time chain read recording for the chain tier tape. Local only, never in CI.
 * Writes a separate tape only: never the GET-only tape, never a baseline, and
 * never anything inside the source private directory.
 *
 *   npm run build
 *   node test/corpus/record-chain.mjs                       # tapes/public.json -> tapes/public-chain.json
 *   node test/corpus/record-chain.mjs --private <dir> --out <new dir>
 *                                                            # <dir>/tape.json -> <new dir>/tape.json
 *
 * 1. Copies the GET-only tape and drops its "chain read not recorded" RPC entries.
 * 2. Re-runs every case in record mode with CHIT_CORPUS_RPC=1. GET entries
 *    already on the tape are reused; only chain reads go out, as read-only
 *    JSON-RPC to the public Base and Solana hosts (tape-preload.mjs).
 * 3. Public tier: the token sender of every recorded payment (topics[1] of
 *    an ERC-20 Transfer, and tx.from) is replaced by a fixed placeholder in
 *    every recorded chain reply, and logsBloom is zeroed, so the public tape
 *    names no payer. The verifier reads the sender only as a display fact,
 *    except for a holder receipt with a signed payer: a sender that already
 *    appears in a committed fixture (test/fixtures) is kept, since it is
 *    public in this repo already and its signed payer must still match.
 * 4. Replays every case and prints the outcome. Compare with baseline.json
 *    through changes.json; nothing is rewritten here.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { corpusDir, runPath, pinned } from './lib.mjs';
import { buildSynthetic } from './synthetic.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const privateDir = opt('--private');
const PLACEHOLDER = '00000000000000000000000000000000000000a1';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function loadCases() {
  if (privateDir) {
    const m = JSON.parse(readFileSync(join(privateDir, 'manifest.json'), 'utf8'));
    return m.cases.map((c) => ({ ...c, kind: 'file', file: join(privateDir, c.file), paths: ['cli'] }));
  }
  const manifest = JSON.parse(readFileSync(join(corpusDir, 'manifest.json'), 'utf8'));
  return [
    ...manifest.ids.map((c) => ({ ...c, kind: 'id', paths: ['cli'] })),
    ...manifest.files.map((c) => ({ ...c, kind: 'file', file: join(corpusDir, '..', 'fixtures', c.fixture), paths: ['cli'] })),
  ];
}

function committedFixtureText() {
  const root = join(corpusDir, '..', 'fixtures');
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json')) out.push(readFileSync(full, 'utf8').toLowerCase());
    }
  };
  walk(root);
  return out.join('\n');
}

function redactPayers(tape) {
  const published = committedFixtureText();
  const senders = new Set();
  for (const [key, entry] of Object.entries(tape.entries)) {
    if (!key.startsWith('RPC ') || !entry.body || !key.includes(' eth_getTransactionReceipt ')) continue;
    let body;
    try { body = JSON.parse(entry.body); } catch { continue; }
    const logs = body?.result?.logs || [];
    const transfers = logs.filter((l) => l.topics?.[0] === TRANSFER && l.topics.length >= 3);
    if (!transfers.length) continue;
    for (const l of transfers) senders.add(l.topics[1].slice(-40).toLowerCase());
    if (typeof body.result.from === 'string') senders.add(body.result.from.slice(2).toLowerCase());
  }
  for (const s of [...senders]) if (published.includes(s)) senders.delete(s);
  let changed = 0;
  for (const [key, entry] of Object.entries(tape.entries)) {
    if (!key.startsWith('RPC ') || !entry.body) continue;
    let text = entry.body;
    for (const s of senders) text = text.replace(new RegExp(s, 'gi'), PLACEHOLDER);
    text = text.replace(/"logsBloom":"0x[0-9a-f]+"/gi, `"logsBloom":"0x${'0'.repeat(512)}"`);
    if (text !== entry.body) { entry.body = text; changed += 1; }
  }
  return { senders: senders.size, changed };
}

const outDir = opt('--out');
if (privateDir && (!outDir || resolve(outDir) === resolve(privateDir))) throw new Error('--private needs --out <a new directory>; the source directory is never written');
if (privateDir) mkdirSync(outDir, { recursive: true, mode: 0o700 });
const sourceTape = privateDir ? join(privateDir, 'tape.json') : join(corpusDir, 'tapes', 'public.json');
const tapePath = privateDir ? join(outDir, 'tape.json') : join(corpusDir, 'tapes', 'public-chain.json');
const tape = JSON.parse(readFileSync(sourceTape, 'utf8'));
let dropped = 0;
for (const [key, entry] of Object.entries(tape.entries)) {
  if (key.startsWith('RPC ') && entry.error === 'chain read not recorded: recording is GET-only') {
    delete tape.entries[key];
    dropped += 1;
  }
}
writeFileSync(tapePath, `${JSON.stringify(tape, null, 1)}\n`);
console.log(`dropped ${dropped} unrecorded chain entries`);

const cases = [...loadCases(), ...(privateDir ? [] : await buildSynthetic(mkdtempSync(join(tmpdir(), 'corpus-syn-'))))];
process.env.CHIT_CORPUS_MODE = 'record';
process.env.CHIT_CORPUS_RPC = '1';
for (const c of cases) for (const path of c.paths || ['cli']) runPath(c, path, tapePath);
delete process.env.CHIT_CORPUS_RPC;

if (!privateDir) {
  const after = JSON.parse(readFileSync(tapePath, 'utf8'));
  const r = redactPayers(after);
  writeFileSync(tapePath, `${JSON.stringify(after, null, 1)}\n`);
  console.log(`redacted ${r.senders} payment senders in ${r.changed} chain replies`);
}

process.env.CHIT_CORPUS_MODE = 'replay';
for (const c of cases) {
  for (const path of c.paths || ['cli']) {
    const o = runPath(c, path, tapePath);
    process.stdout.write(`${c.id}|${path}\t${JSON.stringify(pinned(o))}${o.misses?.length ? `\tMISS ${o.misses.length}` : ''}\n`);
  }
}
