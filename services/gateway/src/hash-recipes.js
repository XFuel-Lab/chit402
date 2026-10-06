/**
 * Hash recipes and where each named field is served or linked.
 *
 * A recipe that names a field the receipt or book row never serves, and
 * that no preimage route links, is an orphan. New recipes fail that check
 * in CI. Linking the stored canonical object at GET /preimage covers every
 * field inside payload_hash. A per-field preimage covers that hash's inputs.
 *
 * The field lists below are the bytes those hashes already join. This
 * module does not change the join order or the hash algorithm.
 *
 * Credit: moth-lamp on 1F916 post 7404 (c92426, c93542, c93881, c94234).
 * A recipe that names a field the row does not serve cannot be recomputed.
 */

/** Pipe order of book_chain.row_hash. `event` falls back to `evidence`. */
export const BOOK_ROW_HASH_FIELDS = Object.freeze([
  'agent_id', 'seq', 'task_id', 'prev_hash', 'event',
]);

/** Pipe order of a coverage row commitment. Amount and ref are ledger fields. */
export const COVERAGE_ROW_FIELDS = Object.freeze([
  'task_id', 'evidence', 'amount', 'payment_ref', 'collected_at',
]);

/** abi.encodePacked order of a payment binding, before inference extras. */
export const PAYMENT_BINDING_FIELDS = Object.freeze([
  'payment_ref', 'task_id', 'rail', 'amount',
]);

export const INFERENCE_BINDING_EXTRA_FIELDS = Object.freeze([
  'model_commitment', 'output_hash',
]);

export const INCLUSION_LEAF_FIELDS = Object.freeze(['task_id', 'row_hash']);

/** JSON key order of a board job spec. */
export const JOB_SPEC_FIELDS = Object.freeze([
  'text', 'budget', 'deadline', 'acceptance',
]);

const RECEIPT_PREIMAGE = '/receipt/:id/preimage';
const REFUSAL_PREIMAGE = '/refusal/:id/preimage';

function field(name, { served = null, link = null } = {}) {
  const row = { name };
  if (served) row.served = served;
  if (link) row.link = link;
  return row;
}

function fromNames(id, names, { served = {}, link = null } = {}) {
  return {
    id,
    fields: names.map((name) => field(name, { served: served[name] || null, link })),
  };
}

/**
 * Dispositions for every field a published recipe names.
 * `served` is a path on the public receipt or book row.
 * `link` is a preimage route whose body contains those bytes.
 */
export function hashRecipes({
  receiptFields = [],
  refusalFields = [],
  foreignFields = [],
} = {}) {
  const foreignOnly = foreignFields.filter((name) => !receiptFields.includes(name));
  return [
    fromNames('book_row_hash', BOOK_ROW_HASH_FIELDS, {
      link: '/receipt/:id/preimage/book_chain.row_hash',
      served: {
        agent_id: 'book_chain.book_id',
        seq: 'book_chain.seq',
        task_id: 'book_chain.task_id',
        prev_hash: 'book_chain.prev_hash',
        event: 'book_chain.event',
      },
    }),
    fromNames('inclusion_leaf', INCLUSION_LEAF_FIELDS, {
      link: '/receipt/:id/preimage/inclusion.leaf',
      served: {
        task_id: 'task_id',
        row_hash: 'book_chain.row_hash',
      },
    }),
    fromNames('payment_binding', PAYMENT_BINDING_FIELDS, {
      link: '/receipt/:id/preimage/binding.expected_commitment',
      served: {
        payment_ref: 'payment.ref',
        task_id: 'task_id',
        rail: 'payment.rail',
        amount: 'payment.gross_amount',
      },
    }),
    fromNames('inference_binding', [...PAYMENT_BINDING_FIELDS, ...INFERENCE_BINDING_EXTRA_FIELDS], {
      link: '/receipt/:id/preimage/binding.expected_commitment',
      served: {
        payment_ref: 'payment.ref',
        task_id: 'task_id',
        rail: 'payment.rail',
        amount: 'payment.gross_amount',
        model_commitment: 'route.model_commitment.commitment',
        output_hash: 'output.hash',
      },
    }),
    fromNames('coverage_row', COVERAGE_ROW_FIELDS, {
      served: {
        task_id: 'task_id',
        evidence: 'evidence',
        amount: 'payment.amount',
        payment_ref: 'payment.ref',
        collected_at: 'collected_at',
      },
    }),
    fromNames('job_spec', JOB_SPEC_FIELDS, {
      link: '/receipt/:id/preimage/job_spec_hash',
    }),
    fromNames('receipt_canonical', receiptFields, { link: RECEIPT_PREIMAGE }),
    fromNames('refusal_canonical', refusalFields, { link: REFUSAL_PREIMAGE }),
    fromNames('foreign_canonical', foreignOnly, { link: RECEIPT_PREIMAGE }),
  ];
}

/**
 * Field names with neither a served path nor a preimage link.
 * @param {{ id: string, fields: { name: string, served?: string, link?: string }[] }[]} recipes
 */
export function orphanRecipeFields(recipes) {
  const orphans = [];
  for (const recipe of recipes || []) {
    for (const item of recipe.fields || []) {
      const served = typeof item.served === 'string' && item.served.length > 0;
      const link = typeof item.link === 'string' && item.link.length > 0;
      if (!served && !link) orphans.push(`${recipe.id}.${item.name}`);
    }
  }
  return orphans;
}

/**
 * @param {object|null|undefined} root
 * @param {string} path dot path
 */
export function pathIsServed(root, path) {
  if (!root || typeof path !== 'string' || !path) return false;
  let cursor = root;
  for (const key of path.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, key)) {
      return false;
    }
    cursor = cursor[key];
  }
  return cursor != null && cursor !== '';
}
