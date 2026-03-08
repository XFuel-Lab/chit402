#!/usr/bin/env node
/**
 * SP1 Prover Benchmark
 * Runs sequential + concurrent proofs (single or batch), measures GPU time
 * and round-trip, outputs min/avg/max/p50/p95 stats and saves CSV for graphing.
 *
 * Usage:
 *   node scripts/benchmark-prover.js [options]
 *
 * Options:
 *   --sequential N    Number of sequential proofs (default: 50)
 *   --concurrent N    Number of concurrent proofs (default: 10)
 *   --batch N         Deposits per proof (1 = single, >1 = batch) (default: 1)
 *   --endpoint TYPE   binary | json (default: binary)
 *   --csv PATH        Output CSV path (default: benchmark-results.csv)
 *
 * Environment:
 *   SP1_PROVER_URL  - Required. Theta EdgeCloud prover URL.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROVER_URL = process.env.SP1_PROVER_URL;
if (!PROVER_URL) {
  console.error('ERROR: SP1_PROVER_URL environment variable is required');
  process.exit(1);
}

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const SEQ_COUNT = parseInt(getArg('sequential', '50'));
const CONC_COUNT = parseInt(getArg('concurrent', '10'));
const BATCH_SIZE = parseInt(getArg('batch', '1'));
const ENDPOINT = getArg('endpoint', 'binary');
const CSV_PATH = getArg('csv', resolve(__dirname, '..', 'benchmark-results.csv'));
const HIGH_CONC_MODE = CONC_COUNT >= 500;
const USE_EDGECLOUD = !!(process.env.THETA_EDGECLOUD_API_KEY || process.env.SP1_PROVER_URL?.includes('edgecloud'));

const testDataPath = resolve(__dirname, '..', '..', '..', 'sp1-prover', 'test-data', 'deposit-1tfuel.json');
const singleDeposit = JSON.parse(readFileSync(testDataPath, 'utf-8'));

function buildPayload(batchSize) {
  if (batchSize <= 1) return singleDeposit;
  const deposits = [];
  for (let i = 0; i < batchSize; i++) {
    const d = { ...singleDeposit };
    const blockBuf = Buffer.alloc(8);
    blockBuf.writeBigUInt64BE(BigInt(singleDeposit.block_number + i));
    d.block_number = singleDeposit.block_number + i;
    deposits.push(d);
  }
  return { deposits };
}

async function doProof(index, tag) {
  const url = ENDPOINT === 'binary'
    ? `${PROVER_URL}/prove/binary`
    : `${PROVER_URL}/prove`;
  const isBinary = ENDPOINT === 'binary';
  const payload = buildPayload(BATCH_SIZE);
  const body = JSON.stringify(payload);
  const startMs = Date.now();

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(300000),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  let gpuTimeMs = 0;
  let responseBytes = 0;
  let batchSize = BATCH_SIZE;

  if (isBinary) {
    const buf = await resp.arrayBuffer();
    responseBytes = buf.byteLength;
    const view = new DataView(buf);
    const proofLen = Number(view.getBigUint64(0, true));
    let offset = 8 + proofLen;
    const pubLen = Number(view.getBigUint64(offset, true));
    offset += 8 + pubLen;
    offset += 1; // is_batch
    batchSize = view.getUint32(offset, true);
    offset += 4;
    gpuTimeMs = Number(view.getBigUint64(offset, true));
  } else {
    const data = await resp.json();
    gpuTimeMs = data.proving_time_ms || 0;
    batchSize = data.batch_size || BATCH_SIZE;
    responseBytes = JSON.stringify(data).length;
  }

  const roundTripMs = Date.now() - startMs;
  const effectiveMsPerDeposit = batchSize > 0 ? Math.round(gpuTimeMs / batchSize) : gpuTimeMs;

  return {
    index,
    tag,
    gpuTimeMs,
    roundTripMs,
    responseBytes,
    batchSize,
    effectiveMsPerDeposit,
    timestamp: new Date().toISOString(),
  };
}

function percentile(sorted, pct) {
  const idx = Math.ceil(sorted.length * pct / 100) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(results, field) {
  const vals = results.map(r => r[field]).sort((a, b) => a - b);
  const sum = vals.reduce((a, b) => a + b, 0);
  return {
    min: vals[0],
    max: vals[vals.length - 1],
    avg: Math.round(sum / vals.length),
    p50: percentile(vals, 50),
    p95: percentile(vals, 95),
    count: vals.length,
  };
}

function printStats(label, results) {
  const gpu = stats(results, 'gpuTimeMs');
  const rtt = stats(results, 'roundTripMs');
  const eff = stats(results, 'effectiveMsPerDeposit');
  console.log(`\n${'='.repeat(65)}`);
  console.log(`  ${label}  (${results.length} proofs, batch=${BATCH_SIZE}, endpoint=${ENDPOINT})`);
  console.log(`${'='.repeat(65)}`);
  console.log(`  GPU Time (ms):            min=${gpu.min}  avg=${gpu.avg}  p50=${gpu.p50}  p95=${gpu.p95}  max=${gpu.max}`);
  console.log(`  Effective ms/deposit:     min=${eff.min}  avg=${eff.avg}  p50=${eff.p50}  p95=${eff.p95}  max=${eff.max}`);
  console.log(`  Round-trip (ms):          min=${rtt.min}  avg=${rtt.avg}  p50=${rtt.p50}  p95=${rtt.p95}  max=${rtt.max}`);
  console.log(`  Response size:            ${results[0]?.responseBytes || 0} bytes`);
  console.log(`  Total deposits proved:    ${results.length * BATCH_SIZE}`);
}

async function runBenchmark() {
  console.log(`\nSP1 Prover Benchmark`);
  console.log(`  URL:          ${PROVER_URL}`);
  console.log(`  Endpoint:     /prove${ENDPOINT === 'binary' ? '/binary' : ''}`);
  console.log(`  Batch size:   ${BATCH_SIZE} deposit(s) per proof`);
  console.log(`  Sequential:   ${SEQ_COUNT} proofs (${SEQ_COUNT * BATCH_SIZE} deposits)`);
  console.log(`  Concurrent:   ${CONC_COUNT} proofs (${CONC_COUNT * BATCH_SIZE} deposits)`);
  console.log(`  Stress mode:  ${HIGH_CONC_MODE ? 'YES (waves of 50)' : 'NO (use --concurrent 500+)'}`);
  console.log(`  Runtime:      ${USE_EDGECLOUD ? 'Theta EdgeCloud' : 'Local prover'}`);
  console.log(`  CSV output:   ${CSV_PATH}\n`);

  try {
    const hResp = await fetch(`${PROVER_URL}/healthz`, { signal: AbortSignal.timeout(10000) });
    const hData = await hResp.json();
    console.log(`  Prover status: ${hData.status} | uptime: ${hData.uptime_seconds}s | proofs: ${hData.proofs_served}\n`);
  } catch (e) {
    console.error(`  WARNING: Health check failed: ${e.message}\n`);
  }

  const allResults = [];

  // Warm-up (3 proofs)
  console.log('--- Warm-up (3 proofs, not counted) ---');
  for (let i = 0; i < 3; i++) {
    try {
      const r = await doProof(i, 'warmup');
      console.log(`  warmup #${i + 1}: gpu=${r.gpuTimeMs}ms  rtt=${r.roundTripMs}ms  effective=${r.effectiveMsPerDeposit}ms/dep  batch=${r.batchSize}`);
    } catch (e) {
      console.error(`  warmup #${i + 1} FAILED: ${e.message}`);
    }
  }

  // Sequential
  console.log(`\n--- Sequential proofs (${SEQ_COUNT}) ---`);
  const seqResults = [];
  for (let i = 0; i < SEQ_COUNT; i++) {
    try {
      const r = await doProof(i, 'sequential');
      seqResults.push(r);
      allResults.push(r);
      const pct = Math.round(((i + 1) / SEQ_COUNT) * 100);
      process.stdout.write(`\r  [${pct}%] #${i + 1}/${SEQ_COUNT}  gpu=${r.gpuTimeMs}ms  eff=${r.effectiveMsPerDeposit}ms/dep  rtt=${r.roundTripMs}ms`);
    } catch (e) {
      console.error(`\n  sequential #${i + 1} FAILED: ${e.message}`);
      allResults.push({ index: i, tag: 'sequential', gpuTimeMs: 0, roundTripMs: 0, responseBytes: 0, batchSize: BATCH_SIZE, effectiveMsPerDeposit: 0, timestamp: new Date().toISOString(), error: e.message });
    }
  }
  console.log('');
  const validSeq = seqResults.filter(r => r.gpuTimeMs > 0);
  if (validSeq.length > 0) printStats('SEQUENTIAL RESULTS', validSeq);

  // Concurrent
  console.log(`\n--- Concurrent proofs (${CONC_COUNT} in parallel) ---`);
  const concStartMs = Date.now();
  const concPromises = [];
  for (let i = 0; i < CONC_COUNT; i++) {
    concPromises.push(
      doProof(i, 'concurrent').catch(e => ({
        index: i, tag: 'concurrent', gpuTimeMs: 0, roundTripMs: 0, responseBytes: 0,
        batchSize: BATCH_SIZE, effectiveMsPerDeposit: 0, timestamp: new Date().toISOString(), error: e.message,
      }))
    );
  }
  const concResults = await Promise.all(concPromises);
  const concWallTime = Date.now() - concStartMs;
  const validConc = concResults.filter(r => r.gpuTimeMs > 0);
  allResults.push(...concResults);

  for (const r of concResults) {
    if (r.error) {
      console.log(`  concurrent #${r.index + 1}: FAILED - ${r.error}`);
    } else {
      console.log(`  concurrent #${r.index + 1}: gpu=${r.gpuTimeMs}ms  eff=${r.effectiveMsPerDeposit}ms/dep  rtt=${r.roundTripMs}ms`);
    }
  }
  if (validConc.length > 0) {
    printStats('CONCURRENT RESULTS', validConc);
    console.log(`  Wall-clock time: ${concWallTime}ms`);
    const totalDeps = validConc.reduce((s, r) => s + r.batchSize, 0);
    console.log(`  Effective throughput: ${(totalDeps / (concWallTime / 1000)).toFixed(2)} deposits/sec`);
  }

  // High-concurrency stress mode (--concurrent 500+)
  if (HIGH_CONC_MODE) {
    console.log(`\n--- High-concurrency stress test (${CONC_COUNT} in parallel, ${USE_EDGECLOUD ? 'EdgeCloud' : 'local'}) ---`);
    const stressStartMs = Date.now();
    const WAVE_SIZE = 50;
    const waves = Math.ceil(CONC_COUNT / WAVE_SIZE);
    const stressResults = [];
    let successCount = 0;
    let failCount = 0;

    for (let w = 0; w < waves; w++) {
      const waveCount = Math.min(WAVE_SIZE, CONC_COUNT - w * WAVE_SIZE);
      const wavePromises = [];
      for (let i = 0; i < waveCount; i++) {
        const idx = w * WAVE_SIZE + i;
        wavePromises.push(
          doProof(idx, 'stress').catch(e => ({
            index: idx, tag: 'stress', gpuTimeMs: 0, roundTripMs: 0, responseBytes: 0,
            batchSize: BATCH_SIZE, effectiveMsPerDeposit: 0, timestamp: new Date().toISOString(), error: e.message,
          }))
        );
      }
      const waveResults = await Promise.all(wavePromises);
      for (const r of waveResults) {
        stressResults.push(r);
        allResults.push(r);
        if (r.gpuTimeMs > 0) successCount++;
        else failCount++;
      }
      const pct = Math.round(((w + 1) / waves) * 100);
      process.stdout.write(`\r  [${pct}%] Wave ${w + 1}/${waves} complete (${successCount} ok, ${failCount} fail)`);
    }
    console.log('');

    const stressWallTime = Date.now() - stressStartMs;
    const validStress = stressResults.filter(r => r.gpuTimeMs > 0);
    if (validStress.length > 0) {
      printStats('HIGH-CONCURRENCY STRESS RESULTS', validStress);
      console.log(`  Wall-clock time: ${stressWallTime}ms`);
      const totalDeps = validStress.reduce((s, r) => s + r.batchSize, 0);
      const throughput = (totalDeps / (stressWallTime / 1000)).toFixed(2);
      console.log(`  Effective throughput: ${throughput} deposits/sec`);
      const uptimePct = ((validStress.length / stressResults.length) * 100).toFixed(1);
      const utilPct = validStress.length > 0
        ? ((validStress.reduce((s, r) => s + r.gpuTimeMs, 0) / (stressWallTime * CONC_COUNT / WAVE_SIZE)) * 100).toFixed(1)
        : '0.0';
      console.log(`  Uptime:   ${uptimePct}% (target: 99%)`);
      console.log(`  GPU util: ${utilPct}% (target: >50%)`);
      console.log(`  Runtime:  ${USE_EDGECLOUD ? 'Theta EdgeCloud' : 'Local prover'}`);
    }
  }

  // Combined
  const allValid = allResults.filter(r => r.gpuTimeMs > 0);
  if (allValid.length > 0) {
    printStats('COMBINED (ALL PROOFS)', allValid);
  }

  // CSV
  const csvHeader = 'index,tag,gpu_time_ms,roundtrip_ms,batch_size,effective_ms_per_deposit,response_bytes,timestamp,error\n';
  const csvRows = allResults.map(r =>
    `${r.index},${r.tag},${r.gpuTimeMs},${r.roundTripMs},${r.batchSize},${r.effectiveMsPerDeposit},${r.responseBytes},${r.timestamp},${r.error || ''}`
  ).join('\n');
  writeFileSync(CSV_PATH, csvHeader + csvRows + '\n');
  console.log(`\nCSV saved to: ${CSV_PATH}`);

  // Summary
  console.log(`\n${'='.repeat(65)}`);
  console.log('  BENCHMARK COMPLETE');
  console.log(`${'='.repeat(65)}`);
  const gpuS = stats(allValid, 'gpuTimeMs');
  const effS = stats(allValid, 'effectiveMsPerDeposit');
  const totalDeps = allValid.reduce((s, r) => s + r.batchSize, 0);
  console.log(`  Total proofs:            ${allValid.length} succeeded, ${allResults.length - allValid.length} failed`);
  console.log(`  Total deposits proved:   ${totalDeps} (batch=${BATCH_SIZE})`);
  console.log(`  GPU time:                ${gpuS.avg}ms avg (${gpuS.min}-${gpuS.max}ms range)`);
  console.log(`  Effective ms/deposit:    ${effS.avg}ms avg (${effS.min}-${effS.max}ms range)`);
  console.log(`  Sub-200ms/deposit:       ${effS.avg <= 200 ? 'YES' : 'NO'} (avg=${effS.avg}ms)`);
  console.log(`  Sub-1s GPU:              ${gpuS.min < 1000 ? 'YES' : 'NO'} (min=${gpuS.min}ms)`);
  console.log(`${'='.repeat(65)}\n`);

  try {
    const mResp = await fetch(`${PROVER_URL}/metrics`, { signal: AbortSignal.timeout(10000) });
    const mData = await mResp.json();
    console.log('Final prover metrics:', JSON.stringify(mData, null, 2));
  } catch (_) { /* ignore */ }

  process.exit(0);
}

runBenchmark().catch(e => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
