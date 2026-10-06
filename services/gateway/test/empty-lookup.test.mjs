/**
 * An empty lookup names what was asked, when, that nothing was served,
 * and an amend bound only when a correcting row names the id.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { emptyLookup, emptyLookupBody, amendBoundFromRows, EMPTY_LOOKUP_SCHEMA } = await import('../src/empty-lookup.js');
const { queryLineage } = await import('../src/agent-book.js');

test('a miss with no correcting row is asked, at, and served none', () => {
  const at = '2026-10-05T19:39:25.650Z';
  const cell = emptyLookup({ asked: 'missing-row', at });
  assert.deepEqual(Object.keys(cell), ['asked', 'at', 'served']);
  assert.equal(cell.asked, 'missing-row');
  assert.equal(cell.at, at);
  assert.equal(cell.served, 'none');
  const body = emptyLookupBody('missing-row', [], at);
  assert.equal(body.error, 'not_found');
  assert.equal(body.schema, EMPTY_LOOKUP_SCHEMA);
  assert.deepEqual(body.lookup, cell);
});

test('a correcting row that names the id adds the amend bound and nothing else', () => {
  const rows = [
    {
      event: 'inflow_correction',
      corrects: 'retired-row',
      collected_at: '2026-10-03T21:41:08.893Z',
    },
    {
      amends: ['other-row'],
      collected_at: '2026-10-04T00:00:00.000Z',
    },
  ];
  const bound = amendBoundFromRows(rows, 'retired-row');
  assert.equal(bound, 'filed at or before 2026-10-03T21:41:08.893Z');
  assert.equal(amendBoundFromRows(rows, 'other-row'), 'filed at or before 2026-10-04T00:00:00.000Z');
  assert.equal(amendBoundFromRows(rows, 'absent'), null);
  const body = emptyLookupBody('retired-row', rows, '2026-10-05T19:39:25.650Z');
  assert.deepEqual(Object.keys(body.lookup).sort(), ['asked', 'at', 'bound', 'served']);
  assert.equal(body.lookup.served, 'none');
  assert.equal(body.lookup.bound, bound);
});

test('an authenticated book lookup that misses returns the cell and does not leak another book', () => {
  const ledger = {
    entries: [{
      event: 'inflow_correction',
      corrects: 'asked-task',
      collected_at: '2026-10-02T05:00:50.364Z',
      agent_id: 9,
    }],
    findByTask(id) {
      if (id === 'someone-elses') return { task_id: id, agent_id: 9 };
      return null;
    },
  };
  const verify = () => ({ checked: true, valid: true });
  const miss = queryLineage(4, 'asked-task', { session: 'ok' }, { ledger, verify });
  assert.equal(miss.status, 404);
  assert.equal(miss.body.lookup.asked, 'asked-task');
  assert.equal(miss.body.lookup.served, 'none');
  assert.equal(miss.body.lookup.bound, 'filed at or before 2026-10-02T05:00:50.364Z');
  assert.equal(miss.body.lookup.at.includes('T'), true);

  const hidden = queryLineage(4, 'someone-elses', { session: 'ok' }, { ledger, verify });
  assert.equal(hidden.status, 403);
  assert.equal(hidden.body, null);

  const unauth = queryLineage(4, 'asked-task', {}, { ledger, verify });
  assert.equal(unauth.status, 401);
});
