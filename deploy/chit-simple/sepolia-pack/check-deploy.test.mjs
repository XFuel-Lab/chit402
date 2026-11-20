import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkController, SAFE_PROXY_RUNTIME, SAFE_SINGLETON } from './check-deploy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(here, 'controller-fixture.json'), 'utf8'));

function viewFor(cse) {
  const owners = cse.owners === 'owners4'
    ? doc.owners4
    : doc.owners3.slice(0, cse.ownerCount ?? 3);
  return {
    code: cse.code ?? doc.proxyRuntime,
    singleton: cse.singleton ?? doc.pinnedSingleton,
    threshold: cse.threshold ?? 2,
    owners,
  };
}

test('check-deploy accepts only a pinned Safe 2-of-3 proxy', () => {
  assert.equal(doc.proxyRuntime, SAFE_PROXY_RUNTIME);
  assert.equal(doc.pinnedSingleton, SAFE_SINGLETON);
  for (const cse of doc.cases) {
    const got = checkController(viewFor(cse));
    if (cse.expect === '') assert.equal(got, '', cse.id);
    else assert.ok(got.includes(cse.expect), `${cse.id}: ${got}`);
  }
});
