#!/usr/bin/env node
/**
 * find-positioning.cjs — positioning + terminology drift linter for docs.
 *
 * Flags language and paths that pre-date Base-home repositioning (ADR 0002):
 *   XFuel = verifiable settlement & payments for AI compute
 *   Money + proof home = Base (USDC/x402); Theta EdgeCloud = optional GPU provider only.
 *
 * Two categories:
 *   [positioning] stale framing (Theta settlement home, DePIN hub, 30/30/25/15 as live, etc.)
 *   [path]        stale repo paths left over from the monorepo restructure
 *
 * Usage:
 *   node scripts/dev/find-positioning.cjs           # scan *.md
 *   node scripts/dev/find-positioning.cjs --all     # scan all tracked text files
 *
 * Output: files ranked by hit count, with matched lines. CHANGELOG / ADR context /
 * docs/providers/ may be historical (reported but flagged). Signal to review, not auto-fix.
 */
const { execFileSync } = require('child_process');

const scanAll = process.argv.includes('--all');
const pathspec = scanAll ? '.' : '*.md';

/** [label, regex, note] — regex is passed to `git grep -nEi`. */
const PATTERNS = [
  ['positioning', 'theta-?hybrid', 'Theta-Hybrid framing'],
  ['positioning', 'theta-?centric', 'Theta-centric framing'],
  ['positioning', 'Settlement home:\\s*Theta', 'Theta claimed as settlement home'],
  ['positioning', 'Primary deployment:\\s*Theta', 'Theta claimed as primary deployment'],
  ['positioning', 'Theta Metachain \\(primary\\)|primary deployment chain', 'Theta as primary chain'],
  ['positioning', '(ai )?depin hub', '"DePIN hub" identity'],
  ['positioning', 'pumping station|pumps? (intelligence|value|compute)', '"AI pumping station" metaphor'],
  ['positioning', 'primary gpu backbone|edgecloud.{0,12}(primary|backbone)', 'EdgeCloud-as-primary framing'],
  ['positioning', 'cross-chain yield', '"cross-chain yield" as headline'],
  ['positioning', '30/30/25/15', 'Legacy fee split as live model'],
  ['positioning', 'CoreRevenueSplitter', 'Deprecated fee path cited as live'],
  ['positioning', 'real yield.*(staker|veXF)|25%.*(staker|veXF)', 'Staker fee-share promise'],
  ['positioning', 'Believer and Angel funding rounds are live|rounds are live on Theta', 'Retired rounds advertised live'],
  ['path', 'backend/theta-bridge', '→ services/gateway'],
  ['path', '\\bsdk/js\\b', '→ packages/sdk'],
  ['path', '\\bxfuel-app\\b', '→ apps/web'],
  ['path', 'core-layer/wasm', '→ contracts/cosmwasm'],
  ['path', '(^|[^/])\\bcosmwasm/zk-verifier', '→ contracts/cosmwasm/zk-verifier'],
  ['path', '(^|[^/])\\bzkgpt-prover/', '→ services/zkgpt-prover/'],
  ['path', '(^|[^/])\\bsp1-prover/', '→ services/sp1-prover/'],
  ['path', '(^|[^s])\\bskills/', '→ packages/agent-skills/'],
  ['path', '(^|[^-])\\bcircuits/[a-z]', '→ packages/circuit-runtime/ (JS) or contracts/circuits/ (Solidity)'],
];

const byFile = new Map();
for (const [label, rx, note] of PATTERNS) {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-nEi', rx, '--', pathspec],
      { maxBuffer: 1024 * 1024 * 64, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch (_) { continue; } // no matches → git grep exits 1
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const m = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!m) continue;
    const [, file, ln, text] = m;
    // ignore false positives: contracts/circuits (correct), packages/circuit-runtime (correct)
    if (/contracts\/circuits|packages\/circuit-runtime|services\/(sp1|zkgpt)-prover|packages\/agent-skills|services\/gateway/.test(text)
        && label === 'path') continue;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ label, note, ln: Number(ln), text: text.trim().slice(0, 100) });
  }
}

const ranked = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
let total = 0;
for (const [, hits] of ranked) total += hits.length;
console.log(`Positioning/terminology drift: ${total} hits across ${ranked.length} files (scan: ${pathspec})\n`);
for (const [file, hits] of ranked) {
  const historical = /CHANGELOG|docs\/adr\/0001|docs\/tokenomics-reconciliation|docs\/providers\//i.test(file)
    ? '  [historical / ADR context — review]'
    : '';
  console.log(`── ${file}  (${hits.length})${historical}`);
  for (const h of hits) console.log(`   ${h.ln}: [${h.label}] ${h.note}  ·  ${h.text}`);
}
