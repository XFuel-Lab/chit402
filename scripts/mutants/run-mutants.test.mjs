import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run-mutants.mjs', import.meta.url));

test('a suite that fails to spawn is ERROR and the mutated file is restored', () => {
  const ran = spawnSync(process.execPath, [runner, '--self-check'], { encoding: 'utf8' });
  const out = `${ran.stdout || ''}${ran.stderr || ''}`;
  assert.equal(ran.status, 0, out);
  const reSpawn = /^MUT\tself_spawn\tERROR\t/m;
  assert.ok(reSpawn.test(out), out);
  const reExit = /^MUT\tself_exit\tRESTORED\t/m;
  assert.ok(reExit.test(out), out);
  const reKilled = /^MUT\tself_spawn\tKILLED\t/m;
  assert.equal(reKilled.test(out), false);
});
