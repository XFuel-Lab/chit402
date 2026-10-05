/**
 * Every field a hash recipe names is served on the receipt or book row,
 * or linked at a preimage route. A new recipe that names an orphan fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const {
  hashRecipes,
  orphanRecipeFields,
  pathIsServed,
  BOOK_ROW_HASH_FIELDS,
  COVERAGE_ROW_FIELDS,
  PAYMENT_BINDING_FIELDS,
  INFERENCE_BINDING_EXTRA_FIELDS,
  INCLUSION_LEAF_FIELDS,
  JOB_SPEC_FIELDS,
} = await import('../src/hash-recipes.js');
const {
  RECEIPT_CANONICAL_FIELDS,
  REFUSAL_CANONICAL_FIELDS,
  FOREIGN_CANONICAL_FIELDS,
} = await import('../src/canonical-preimage.js');
const { bookRowPreimage } = await import('../src/book-seq.js');
const { rowCommitment, ROW_COMMITMENT_RULE } = await import('../src/export-coverage.js');

const here = dirname(fileURLToPath(import.meta.url));

function recipes() {
  return hashRecipes({
    receiptFields: RECEIPT_CANONICAL_FIELDS,
    refusalFields: REFUSAL_CANONICAL_FIELDS,
    foreignFields: FOREIGN_CANONICAL_FIELDS,
  });
}

const FIXTURES = {
  book_row_hash: {
    book_chain: {
      book_id: 195,
      seq: 1,
      task_id: 'xfuel-row',
      prev_hash: 'aa'.repeat(32),
      event: 'collected',
      row_hash: 'bb'.repeat(32),
    },
  },
  inclusion_leaf: {
    task_id: 'xfuel-row',
    book_chain: { row_hash: 'bb'.repeat(32) },
  },
  payment_binding: {
    task_id: 'xfuel-row',
    payment: { ref: 'base:0x' + 'cd'.repeat(32), rail: 'usdc', gross_amount: '2000' },
  },
  inference_binding: {
    task_id: 'xfuel-row',
    payment: { ref: 'base:0x' + 'cd'.repeat(32), rail: 'usdc', gross_amount: '2000' },
    route: { model_commitment: { commitment: '0x' + 'ab'.repeat(32) } },
    output: { hash: '0x' + 'ef'.repeat(32) },
  },
  coverage_row: {
    task_id: 'xfuel-row',
    evidence: 'collected',
    payment: { amount: '2000', ref: 'base:0x' + 'cd'.repeat(32) },
    collected_at: '2026-10-05T00:00:00.000Z',
  },
};

test('published recipes have no orphan fields', () => {
  const list = recipes();
  assert.deepEqual(orphanRecipeFields(list), []);
  const byId = Object.fromEntries(list.map((recipe) => [recipe.id, recipe]));
  assert.deepEqual(byId.book_row_hash.fields.map((field) => field.name), [...BOOK_ROW_HASH_FIELDS]);
  assert.deepEqual(byId.coverage_row.fields.map((field) => field.name), [...COVERAGE_ROW_FIELDS]);
  assert.deepEqual(byId.payment_binding.fields.map((field) => field.name), [...PAYMENT_BINDING_FIELDS]);
  assert.deepEqual(
    byId.inference_binding.fields.map((field) => field.name),
    [...PAYMENT_BINDING_FIELDS, ...INFERENCE_BINDING_EXTRA_FIELDS],
  );
  assert.deepEqual(byId.inclusion_leaf.fields.map((field) => field.name), [...INCLUSION_LEAF_FIELDS]);
  assert.deepEqual(byId.job_spec.fields.map((field) => field.name), [...JOB_SPEC_FIELDS]);
  assert.deepEqual(byId.receipt_canonical.fields.map((field) => field.name), [...RECEIPT_CANONICAL_FIELDS]);
  assert.deepEqual(byId.refusal_canonical.fields.map((field) => field.name), [...REFUSAL_CANONICAL_FIELDS]);
  for (const name of FOREIGN_CANONICAL_FIELDS) {
    const covered = list.some((recipe) => recipe.fields.some((field) => field.name === name && (field.served || field.link)));
    assert.equal(covered, true, name);
  }
});

test('each served path exists on the row fixture and each link is a preimage route', () => {
  for (const recipe of recipes()) {
    const fixture = FIXTURES[recipe.id];
    for (const field of recipe.fields) {
      if (field.served) {
        assert.equal(pathIsServed(fixture, field.served), true, `${recipe.id}.${field.name} at ${field.served}`);
      }
      if (field.link) {
        assert.match(field.link, /^\/(receipt|refusal)\/:id\/preimage/, field.link);
      }
      assert.ok(field.served || field.link, `${recipe.id}.${field.name}`);
    }
  }
});

test('a recipe that names an unserved unlinked field fails the lint', () => {
  const orphans = orphanRecipeFields([
    { id: 'award', fields: [{ name: 'payee' }, { name: 'state', served: 'state' }] },
  ]);
  assert.deepEqual(orphans, ['award.payee']);
});

test('row hash and coverage commitment still join the named fields in order', () => {
  const line = bookRowPreimage({
    agent_id: 195,
    seq: 1,
    task_id: 'xfuel-row',
    prev_hash: null,
    event: 'collected',
  });
  assert.equal(line, '195|1|xfuel-row||collected');
  assert.equal(ROW_COMMITMENT_RULE, `sha256(${COVERAGE_ROW_FIELDS.join('|')})`);
  const digest = rowCommitment({
    task_id: 'xfuel-row',
    evidence: 'collected',
    amount: '2000',
    payment_ref: 'base:0x1',
    collected_at: '2026-10-05T00:00:00.000Z',
  });
  assert.equal(digest.length, 64);
});

test('hash of the stored preimage body is payload_hash', () => {
  const fixture = JSON.parse(readFileSync(join(here, 'fixtures/payload-hash-preimage.json'), 'utf8'));
  const hash = createHash('sha256').update(fixture.preimage, 'utf8').digest('hex');
  assert.equal(hash, fixture.payload_hash);
  assert.equal(fixture.preimage.includes('payload_hash'), false);
});
