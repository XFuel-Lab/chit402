import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('nextTestIssuerKey: 64 distinct known test keys per process, then it throws instead of reusing one', () => {
  const helper = new URL('./helpers/test-issuer-keys.mjs', import.meta.url).href;
  const pp = new URL('../src/production-process.js', import.meta.url).href;
  const script = `
    const { nextTestIssuerKey } = await import(${JSON.stringify(helper)});
    const { testIssuerKids } = await import(${JSON.stringify(pp)});
    const kids = new Set();
    let listed = 0;
    for (let i = 0; i < 64; i += 1) { const k = nextTestIssuerKey(); kids.add(k.kid); if (testIssuerKids().has(k.kid)) listed += 1; }
    let err = null;
    try { nextTestIssuerKey(); } catch (e) { err = e.message; }
    console.log(JSON.stringify({ distinct: kids.size, listed, err }));
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { PATH: process.env.PATH, NODE_ENV: 'test' }, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout.trim().split('\n').pop());
  assert.equal(out.distinct, 64);
  assert.equal(out.listed, 64);
  assert.match(String(out.err), /all 64 known test issuer keys are used/);
});
