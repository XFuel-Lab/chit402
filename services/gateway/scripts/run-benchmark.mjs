#!/usr/bin/env node
/**
 * run-benchmark.mjs — Beginner-friendly wrapper around benchmark-prover.js.
 *
 * Instead of typing long commands with environment variables, fill in
 * `backend/theta-bridge/.env.benchmark` once, then run:
 *
 *   npm run benchmark:cuda     — measure the current CUDA (EdgeCloud) prover
 *   npm run benchmark:zan      — measure the ZAN PowerZebra prover
 *   npm run benchmark:compare  — generate the before/after comparison report
 *
 * Both benchmark runs write to backend/theta-bridge/bench/ using fixed,
 * predictable filenames so `benchmark:compare` always finds them without
 * any extra arguments.
 *
 * Advanced: any extra flags after the mode are forwarded to
 * benchmark-prover.js and OVERRIDE the defaults below, e.g.:
 *   npm run benchmark:cuda -- --batch 10
 *   npm run benchmark:zan -- --sequential 20 --concurrent 5
 *
 * See docs/BENCHMARK_RUNBOOK.md for the full step-by-step guide.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..'); // backend/theta-bridge

// `.env.benchmark` is gitignored — safe place for real URLs/keys. Falls back
// silently to already-exported environment variables if the file is absent.
loadEnv({ path: resolve(ROOT, '.env.benchmark') });

const [mode, ...extraArgs] = process.argv.slice(2);

const MODES = {
  cuda: {
    label: 'edgecloud-cuda',
    urlVar: 'BENCHMARK_CUDA_URL',
    keyVar: 'BENCHMARK_CUDA_API_KEY',
    costVar: 'BENCHMARK_CUDA_COST_PER_HOUR',
    // Also accept the "real" backend env vars so the same .env works everywhere.
    urlFallback: process.env.SP1_PROVER_URL,
  },
  zan: {
    label: 'powerzebra',
    urlVar: 'BENCHMARK_ZAN_URL',
    keyVar: 'BENCHMARK_ZAN_API_KEY',
    costVar: 'BENCHMARK_ZAN_COST_PER_HOUR',
    urlFallback: process.env.ZAN_PROVER_URL,
    keyFallback: process.env.ZAN_PROVER_API_KEY,
  },
};

if (!MODES[mode]) {
  console.error('\nUsage: node scripts/run-benchmark.mjs <cuda|zan> [extra flags]\n');
  console.error('Examples:');
  console.error('  npm run benchmark:cuda');
  console.error('  npm run benchmark:zan');
  console.error('  npm run benchmark:zan -- --batch 10\n');
  process.exit(2);
}

const cfg = MODES[mode];
const url = process.env[cfg.urlVar] || cfg.urlFallback || '';
const apiKey = process.env[cfg.keyVar] || cfg.keyFallback || '';
const costPerHour = process.env[cfg.costVar] || '0';

if (!url) {
  console.error(`\n❌ No prover URL configured for "${mode}" mode.\n`);
  console.error(`   Add this line to backend/theta-bridge/.env.benchmark:`);
  console.error(`     ${cfg.urlVar}=https://your-${mode}-prover-host\n`);
  console.error('   (Copy .env.benchmark.example to .env.benchmark if you have not already.)');
  console.error('   Full instructions: docs/BENCHMARK_RUNBOOK.md\n');
  process.exit(1);
}

const benchDir = resolve(ROOT, 'bench');
if (!existsSync(benchDir)) mkdirSync(benchDir, { recursive: true });

const csvPath = resolve(benchDir, `${cfg.label}.csv`);
const summaryPath = resolve(benchDir, `${cfg.label}.summary.json`);

// extraArgs come FIRST so they win: benchmark-prover.js's getArg() uses the
// first matching --flag it finds in argv, so user overrides (e.g. --batch 10)
// must precede these built-in defaults to take effect.
const args = [
  resolve(ROOT, 'scripts', 'benchmark-prover.js'),
  ...extraArgs,
  '--sequential', '50',
  '--concurrent', '10',
  '--batch', '1',
  '--label', cfg.label,
  '--csv', csvPath,
  '--summary', summaryPath,
  '--cost-per-hour', String(costPerHour),
  ...(apiKey ? ['--api-key', apiKey] : []),
];

console.log(`\n▶ Running ${mode.toUpperCase()} benchmark`);
console.log(`  Prover URL: ${url}`);
console.log(`  Output:     ${summaryPath}`);
if (extraArgs.length) console.log(`  Extra args: ${extraArgs.join(' ')}`);
console.log('');

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: { ...process.env, SP1_PROVER_URL: url },
});

if (result.error) {
  console.error(`\n❌ Failed to start benchmark-prover.js: ${result.error.message}\n`);
  process.exit(1);
}

if (result.status === 0) {
  console.log(`\n✅ ${mode.toUpperCase()} benchmark complete. Summary saved to:`);
  console.log(`   ${summaryPath}`);
  const otherMode = mode === 'cuda' ? 'zan' : 'cuda';
  console.log(`\nNext: run "npm run benchmark:${otherMode}" (if you haven't), then "npm run benchmark:compare".\n`);
}

process.exit(result.status ?? 1);
