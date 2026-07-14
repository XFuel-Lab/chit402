import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProverConfig } from '../src/sp1-prover-client.js';

const CUDA = 'http://cuda.example:8080';
const ZAN = 'https://zan.example/prover';
const SUCCINCT = 'https://succinct.example';

test('defaults to cuda when SP1_PROVER is unset', () => {
  const cfg = resolveProverConfig({ SP1_PROVER_URL: CUDA });
  assert.equal(cfg.mode, 'cuda');
  assert.equal(cfg.primaryUrl, CUDA);
  assert.equal(cfg.fallbackUrl, null);
  assert.equal(cfg.zanUrl, null);
});

test('cuda mode keeps SP1_FALLBACK_URL as fallback', () => {
  const cfg = resolveProverConfig({ SP1_PROVER: 'cuda', SP1_PROVER_URL: CUDA, SP1_FALLBACK_URL: SUCCINCT });
  assert.equal(cfg.mode, 'cuda');
  assert.equal(cfg.primaryUrl, CUDA);
  assert.equal(cfg.fallbackUrl, SUCCINCT);
});

test('zan mode makes ZAN primary and CUDA the automatic fallback', () => {
  const cfg = resolveProverConfig({ SP1_PROVER: 'zan', ZAN_PROVER_URL: ZAN, SP1_PROVER_URL: CUDA });
  assert.equal(cfg.mode, 'zan');
  assert.equal(cfg.primaryUrl, ZAN);
  assert.equal(cfg.fallbackUrl, CUDA);
  assert.equal(cfg.zanUrl, ZAN);
});

test('zan mode falls back to explicit SP1_FALLBACK_URL when no CUDA url', () => {
  const cfg = resolveProverConfig({ SP1_PROVER: 'zan', ZAN_PROVER_URL: ZAN, SP1_FALLBACK_URL: SUCCINCT });
  assert.equal(cfg.mode, 'zan');
  assert.equal(cfg.primaryUrl, ZAN);
  assert.equal(cfg.fallbackUrl, SUCCINCT);
});

test('zan requested without ZAN_PROVER_URL degrades to cuda', () => {
  const cfg = resolveProverConfig({ SP1_PROVER: 'zan', SP1_PROVER_URL: CUDA });
  assert.equal(cfg.mode, 'cuda');
  assert.equal(cfg.primaryUrl, CUDA);
  assert.equal(cfg.degraded, 'zan_url_missing');
});

test('case-insensitive mode + no urls yields null primary', () => {
  const cfg = resolveProverConfig({ SP1_PROVER: 'ZAN' });
  assert.equal(cfg.mode, 'cuda'); // degraded (no zan url), and no cuda url
  assert.equal(cfg.primaryUrl, null);
});
