import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkController,
  controllerViewFromCast,
  FALLBACK_SLOT,
  GUARD_SLOT,
  SAFE_FALLBACK_HANDLER,
  SAFE_PROXY_RUNTIME,
  SAFE_SINGLETON,
} from './check-deploy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(here, 'controller-fixture.json'), 'utf8'));

function word(addr) {
  return `0x${String(addr).replace(/^0x/, '').padStart(64, '0')}`;
}

function viewFor(cse) {
  const owners = cse.owners === 'owners4'
    ? doc.owners4
    : doc.owners3.slice(0, cse.ownerCount ?? 3);
  return {
    code: cse.code ?? doc.proxyRuntime,
    singleton: cse.singleton ?? doc.pinnedSingleton,
    threshold: cse.threshold ?? 2,
    owners,
    modules: cse.modules ?? [],
    guard: cse.guard ?? doc.zeroGuard,
    fallbackHandler: cse.fallbackHandler ?? doc.fallbackHandler,
  };
}

test('check-deploy accepts only a pinned Safe 2-of-3 proxy', () => {
  assert.equal(doc.proxyRuntime, SAFE_PROXY_RUNTIME);
  assert.equal(doc.pinnedSingleton, SAFE_SINGLETON);
  assert.equal(doc.fallbackHandler, SAFE_FALLBACK_HANDLER);
  assert.equal(GUARD_SLOT.length, 66);
  assert.equal(FALLBACK_SLOT.length, 66);
  for (const cse of doc.cases) {
    const got = checkController(viewFor(cse));
    if (cse.expect === '') assert.equal(got, '', cse.id);
    else assert.ok(got.includes(cse.expect), `${cse.id}: ${got}`);
  }
});

test('controllerView cast glue accepts a clean Safe and sees a module', () => {
  const clean = controllerViewFromCast({
    code: doc.proxyRuntime,
    singletonSlot: word(doc.pinnedSingleton),
    threshold: doc.rpcGlue.threshold,
    owners: doc.rpcGlue.owners,
    modules: doc.rpcGlue.modules,
    guard: word(doc.zeroGuard),
    fallbackHandler: word(doc.fallbackHandler),
  });
  assert.equal(clean.owners.length, 3);
  assert.equal(checkController(clean), '');
  const hit = controllerViewFromCast({
    code: doc.proxyRuntime,
    singletonSlot: word(doc.pinnedSingleton),
    threshold: doc.rpcGlue.threshold,
    owners: doc.rpcGlue.owners,
    modules: doc.rpcGlue.moduleHit,
    guard: word(doc.zeroGuard),
    fallbackHandler: word(doc.fallbackHandler),
  });
  const got = checkController(hit);
  assert.ok(got.includes('module'), got);
});
