import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function runListed(dir, listName) {
  return spawnSync(process.execPath, [
    runner,
    dir,
    '--list',
    join(dir, listName),
    '--no-unshare',
    '--timeout-sec',
    '30',
  ], { encoding: 'utf8' });
}

test('a compile error is COMPILE_FAIL and a real test failure names the killer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mut-class-'));
  try {
    const init = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    writeFileSync(join(dir, 'src.txt'), 'alpha\n');
    writeFileSync(join(dir, 'compile.json'), JSON.stringify({
      suites: {
        anchor: {
          cwd: '.',
          argv: ['sh', '-c', 'if grep -q beta src.txt; then echo "Compiler run failed"; echo "Error (6275): missing source"; exit 1; fi'],
        },
      },
      mutants: [{
        id: 'C1',
        file: 'src.txt',
        find: 'alpha',
        replace: 'beta',
        nth: 1,
        suite: 'anchor',
        note: 'compile',
      }],
    }));
    writeFileSync(join(dir, 'killed.json'), JSON.stringify({
      suites: {
        anchor: {
          cwd: '.',
          argv: ['sh', '-c', 'if grep -q beta src.txt; then echo "[FAIL: revert] test_sample() (gas: 1)"; exit 1; fi'],
        },
      },
      mutants: [{
        id: 'K1',
        file: 'src.txt',
        find: 'alpha',
        replace: 'beta',
        nth: 1,
        suite: 'anchor',
        note: 'killed',
      }],
    }));
    const compiled = runListed(dir, 'compile.json');
    const compiledOut = `${compiled.stdout || ''}${compiled.stderr || ''}`;
    assert.equal(compiled.status, 0, compiledOut);
    assert.match(compiledOut, /^MUT\tC1\tCOMPILE_FAIL\t/m);
    assert.equal(/^MUT\tC1\tKILLED\t/m.test(compiledOut), false);
    assert.equal(readFileSync(join(dir, 'src.txt'), 'utf8'), 'alpha\n');

    const killed = runListed(dir, 'killed.json');
    const killedOut = `${killed.stdout || ''}${killed.stderr || ''}`;
    assert.equal(killed.status, 0, killedOut);
    assert.match(killedOut, /^KILLED_BY\tK1\ttest_sample/m);
    assert.match(killedOut, /^MUT\tK1\tKILLED\t/m);
    assert.equal(readFileSync(join(dir, 'src.txt'), 'utf8'), 'alpha\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
