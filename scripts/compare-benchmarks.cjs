#!/usr/bin/env node
/**
 * compare-benchmarks.cjs — Compare two prover benchmark summaries and emit a
 * markdown speedup table. Use to quantify a PowerZebra (or any prover) A/B run
 * against a baseline. Summaries are produced by backend/theta-bridge/scripts/benchmark-prover.js
 * (the `--summary` / `*.summary.json` file).
 *
 * Usage:
 *   node scripts/compare-benchmarks.cjs <baseline.summary.json> <candidate.summary.json> [--out report.md]
 */

const fs = require('fs');

function loadSummary(path) {
  const raw = fs.readFileSync(path, 'utf-8');
  const s = JSON.parse(raw);
  if (!s.gpu_time_ms) throw new Error(`${path}: missing gpu_time_ms (not a benchmark summary?)`);
  return s;
}

/** ratio>1 means candidate is faster/cheaper (good). */
function speedup(baseVal, candVal) {
  if (!baseVal || !candVal) return null;
  return Number((baseVal / candVal).toFixed(2));
}

function row(metric, base, cand, unit, betterIsLower = true) {
  if (base == null || cand == null) return `| ${metric} | n/a | n/a | n/a |`;
  const ratio = betterIsLower ? speedup(base, cand) : speedup(cand, base);
  const arrow = ratio == null ? '' : ratio > 1 ? ` (${ratio}x better)` : ratio < 1 ? ` (${(1 / ratio).toFixed(2)}x worse)` : ' (≈)';
  return `| ${metric} | ${base}${unit} | ${cand}${unit} |${arrow} |`;
}

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  if (positional.length < 2) {
    console.error('Usage: node scripts/compare-benchmarks.cjs <baseline.summary.json> <candidate.summary.json> [--out report.md]');
    process.exit(2);
  }
  const [basePath, candPath] = positional;
  const outIdx = args.indexOf('--out');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;

  const base = loadSummary(basePath);
  const cand = loadSummary(candPath);

  const lines = [];
  lines.push(`# Prover Benchmark Comparison`);
  lines.push('');
  lines.push(`- **Baseline:** \`${base.label}\` (${base.runtime}, batch=${base.batch_size}, ${base.timestamp})`);
  lines.push(`- **Candidate:** \`${cand.label}\` (${cand.runtime}, batch=${cand.batch_size}, ${cand.timestamp})`);
  lines.push('');
  lines.push(`| Metric | Baseline | Candidate | Δ |`);
  lines.push(`|--------|----------|-----------|---|`);
  lines.push(row('GPU time (avg)', base.gpu_time_ms.avg, cand.gpu_time_ms.avg, 'ms'));
  lines.push(row('GPU time (p95)', base.gpu_time_ms.p95, cand.gpu_time_ms.p95, 'ms'));
  lines.push(row('Effective ms/deposit (avg)', base.effective_ms_per_deposit?.avg, cand.effective_ms_per_deposit?.avg, 'ms'));
  lines.push(row('Round-trip (avg)', base.roundtrip_ms?.avg, cand.roundtrip_ms?.avg, 'ms'));
  if (base.cost_per_proof_usd != null || cand.cost_per_proof_usd != null) {
    lines.push(row('Cost per proof', base.cost_per_proof_usd, cand.cost_per_proof_usd, ' USD'));
  }
  lines.push('');

  const overall = speedup(base.gpu_time_ms.avg, cand.gpu_time_ms.avg);
  lines.push(`**Headline:** candidate GPU proving is **${overall ?? 'n/a'}x** the baseline on average GPU time.`);
  lines.push('');
  lines.push(`> Note: on-chain verification gas is unchanged (ZKVerifierSP1 is proof-system-agnostic).`);

  const report = lines.join('\n') + '\n';
  if (outPath) {
    fs.writeFileSync(outPath, report);
    console.log(`Report written to ${outPath}`);
  } else {
    console.log(report);
  }
}

main();
