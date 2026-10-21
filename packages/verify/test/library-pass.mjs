/**
 * 0.4.11: `overall` comes from the shared verdict. The library does not
 * fetch the public log or the anchors, so a receipt whose every library
 * check passed is `partial` with verdict exit 2, never `verified`. Results
 * from other entry points (no `verdict` field) keep their own `overall`.
 */
import assert from 'node:assert/strict';

export function assertLibraryPass(result, message) {
  if (!result.verdict) {
    assert.equal(result.overall, 'verified', message);
    return;
  }
  assert.equal(result.overall, 'partial', message);
  assert.equal(result.verdict.exit_code, 2, message);
  assert.equal(result.verdict.checks.signature, 'pass', message);
  for (const [name, state] of Object.entries(result.verdict.checks)) {
    assert.notEqual(state, 'fail', `${name}: ${message ?? ''}`);
  }
  assert.equal(result.verdict.checks.log_inclusion, 'could_not_check', message);
}
