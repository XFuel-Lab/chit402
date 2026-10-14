/**
 * OV519-AUD: the owner-view audience is a configured host, not the Host header.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { normalizeAudienceHost, resolveOwnerAudiences } = await import('../src/owner-view.js');

test('audience hosts are taken from the configured allowlist', () => {
  assert.deepEqual(resolveOwnerAudiences({}), []);
  assert.deepEqual(resolveOwnerAudiences({
    PUBLIC_BASE_URL: 'https://api.chit402.com/v1',
    PUBLIC_HOSTS: 'api.xfuel.app, API.chit402.com:443',
    OWNER_VIEW_AUDIENCES: '*',
  }), ['api.xfuel.app', 'api.chit402.com']);
  assert.equal(normalizeAudienceHost('API.chit402.com:443'), 'api.chit402.com');
  assert.equal(normalizeAudienceHost('https://api.chit402.com/receipt'), 'api.chit402.com');
  assert.equal(normalizeAudienceHost('*'), '');
});
