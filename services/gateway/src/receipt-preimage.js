/**
 * Public preimages for receipt hashes a stranger can recompute.
 *
 * The block is unsigned. It is not inside the payment JWS, the book-seq
 * JWS, or the coverage JWS, so existing signatures still verify.
 *
 * Hashes over private bytes are listed under `not_recomputable` and their
 * inputs are not served. That includes model output, API-key material,
 * weight shards, and possession-gated book rows.
 */
import crypto from 'crypto';
import { keccak256, solidityPacked, toUtf8Bytes } from 'ethers';
import { bookRowPreimage, bookRowHash } from './book-seq.js';
import { PAYMENT_RAIL } from './payment-binding.js';
import { emptyUniverseHash } from './export-coverage.js';
import { canonicalSignedPayload } from './receipt.js';
import { jcsCanonicalize } from './offer-receipt.js';
import { canonicalObjectDescriptor } from './canonical-preimage.js';
import {
  BOOK_ROW_HASH_FIELDS,
  INCLUSION_LEAF_FIELDS,
  JOB_SPEC_FIELDS,
} from './hash-recipes.js';

export const PREIMAGE_SCHEMA = 'chit402.preimage.v1';

const ZERO32 = `0x${'0'.repeat(64)}`;

export const NOT_RECOMPUTABLE_REASONS = Object.freeze({
  output: 'output.hash is a commitment to the model output. The output is private and is not part of the public preimage.',
  apiKey: 'caller_binding.api_key_hash covers the caller API key. The key is not published.',
  model: 'route.model_commitment is a Merkle root over weight shards. The shards are not published.',
  coverage: 'coverage.universe_hash and coverage.enumerated_hash commit to possession-gated book rows (task_id|evidence|amount|payment_ref|collected_at, then SHA-256 of the ordered lines). Those rows are not a public preimage. A book holder recomputes them from the export.',
  hmac: 'hmac_attestation.value is HMAC-SHA256 over the canonical payload array with the gateway secret. The secret is not public, so a stranger cannot recompute the tag. The public signature is issuer_signature.jws.',
  delegation: 'delegation_hash is the EIP-712 digest of the session authorization. The typed-data bytes are not on the public receipt.',
  tree: 'tree_head_hash is the Merkle root of the log prefix. A prefix leaf whose original bytes are not retained cannot be republished, so the root is not publicly recomputable from this receipt.',
  binding: 'binding.expected_commitment does not match the public payment fields, so the packed preimage is not published.',
  jobSpec: 'job_spec_hash was supplied by the client. The spec bytes were not retained, so the hash is not publicly recomputable.',
  content: 'A client content hash covers bytes the client did not give us to publish.',
});

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256Utf8(text) {
  return sha256Hex(Buffer.from(String(text), 'utf8'));
}

/**
 * RFC 8785 canonical form. Same function offer receipts already sign with.
 * @param {unknown} value
 */
export function canonicalJson(value) {
  return jcsCanonicalize(value);
}

function fieldEntry(partial) {
  return {
    recomputable: true,
    ...partial,
  };
}

/**
 * abi.encodePacked preimage of the payment or inference binding.
 * The hash is keccak256 of these bytes. It matches computePaymentCommitment
 * / computeInferenceBinding and does not change those commitments.
 * @param {object} input
 */
export function paymentBindingPreimage(input = {}) {
  const rail = input.rail;
  const railDiscriminant = typeof rail === 'number' ? rail : (PAYMENT_RAIL[rail] ?? 0);
  const paymentRef = input.paymentRef ?? input.payment_ref ?? null;
  const taskId = input.taskId ?? input.task_id ?? '';
  const paymentRefHash = paymentRef ? keccak256(toUtf8Bytes(String(paymentRef))) : ZERO32;
  const taskIdHash = keccak256(toUtf8Bytes(String(taskId)));
  const amount = BigInt(input.amount ?? 0);
  const inference = input.inference === true;
  const isValid32 = (h) => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h);
  const model = isValid32(input.modelCommitment) ? input.modelCommitment : ZERO32;
  const output = isValid32(input.outputHash) ? input.outputHash : ZERO32;
  const preimageHex = inference
    ? solidityPacked(
      ['bytes32', 'bytes32', 'uint8', 'uint256', 'bytes32', 'bytes32'],
      [paymentRefHash, taskIdHash, railDiscriminant, amount, model, output],
    )
    : solidityPacked(
      ['bytes32', 'bytes32', 'uint8', 'uint256'],
      [paymentRefHash, taskIdHash, railDiscriminant, amount],
    );
  return {
    alg: 'keccak256',
    encoding: 'abi.encodePacked',
    rule: inference
      ? 'keccak256(abi.encodePacked(paymentRefHash, taskIdHash, rail, amount, modelCommitment, outputHash))'
      : 'keccak256(abi.encodePacked(paymentRefHash, taskIdHash, rail, amount))',
    preimage_hex: preimageHex,
    hash: keccak256(preimageHex),
    inputs: {
      payment_ref: paymentRef ? String(paymentRef) : null,
      task_id: String(taskId),
      rail: typeof rail === 'number' ? rail : (rail || null),
      rail_discriminant: railDiscriminant,
      amount: amount.toString(),
      ...(inference ? { model_commitment: model, output_hash: output } : {}),
    },
  };
}

/** SHA-256 input of an inclusion leaf, domain byte included. */
export function inclusionLeafPreimage(taskId, rowHash) {
  const body = Buffer.from(`${taskId}|${rowHash || ''}`, 'utf8');
  const bytes = Buffer.concat([Buffer.from([0x00]), body]);
  return {
    alg: 'sha256',
    encoding: 'binary',
    rule: `sha256(0x00 || utf8(${INCLUSION_LEAF_FIELDS.join('|')}))`,
    preimage_hex: bytes.toString('hex'),
    preimage_utf8_body: body.toString('utf8'),
    hash: sha256Hex(bytes),
  };
}

function rowHashField(chain, fieldName) {
  if (!chain || chain.row_hash == null || chain.row_hash === '') return null;
  const line = bookRowPreimage({
    agent_id: chain.agent_id ?? chain.book_id ?? '',
    seq: chain.seq ?? '',
    task_id: chain.task_id ?? '',
    prev_hash: chain.prev_hash,
    event: chain.event || chain.evidence || '',
  });
  const hash = bookRowHash({
    agent_id: chain.agent_id ?? chain.book_id ?? '',
    seq: chain.seq ?? '',
    task_id: chain.task_id ?? '',
    prev_hash: chain.prev_hash,
    event: chain.event || chain.evidence || '',
  });
  if (hash !== String(chain.row_hash)) return null;
  return fieldEntry({
    field: fieldName,
    alg: 'sha256',
    encoding: 'utf8',
    rule: `sha256(utf8(${BOOK_ROW_HASH_FIELDS.join('|')}))`,
    preimage_utf8: line,
    hash,
  });
}

function bindingField(receipt) {
  const expected = receipt?.binding?.expected_commitment;
  if (expected == null || expected === '') return { skip: true };
  if (typeof expected !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(expected)) {
    return { unavailable: true };
  }
  const covers = Array.isArray(receipt.binding?.covers) ? receipt.binding.covers : [];
  const inference = covers.includes('inference')
    || covers.includes('model')
    || !!(receipt.binding?.model_commitment && receipt.binding?.output_hash);
  const amount = receipt.binding?.amount
    ?? receipt.payment?.gross_amount
    ?? receipt.payment?.settled_amount
    ?? receipt.payment?.net_amount
    ?? '0';
  const packed = paymentBindingPreimage({
    paymentRef: receipt.payment?.ref ?? receipt.binding?.payment_ref ?? null,
    taskId: receipt.task_id,
    rail: receipt.binding?.rail || receipt.payment?.rail || 'usdc',
    amount,
    inference,
    modelCommitment: receipt.binding?.model_commitment || receipt.route?.model_commitment?.commitment || null,
    outputHash: receipt.binding?.output_hash || receipt.output?.hash || null,
  });
  if (String(packed.hash).toLowerCase() !== expected.toLowerCase()) {
    return { unavailable: true };
  }
  return {
    entry: fieldEntry({
      field: 'binding.expected_commitment',
      ...packed,
      hash: expected,
    }),
  };
}

function coverageEmptyField(receipt) {
  const coverage = receipt?.coverage;
  if (!coverage || coverage.universe_hash == null) return null;
  const empty = emptyUniverseHash();
  if (coverage.universe_count === 0 && coverage.universe_hash === empty && coverage.enumerated_count === 0) {
    return fieldEntry({
      field: 'coverage.universe_hash',
      alg: 'sha256',
      encoding: 'utf8',
      rule: 'sha256(utf8("")) — the empty set. enumerated_hash is the same bytes when the window is empty.',
      preimage_utf8: '',
      hash: empty,
    });
  }
  return null;
}

function treeField(prefix) {
  if (!prefix?.ok || !Array.isArray(prefix.leaves) || !prefix.leaves.length) return null;
  return fieldEntry({
    field: 'tree_head_hash',
    alg: 'sha256',
    encoding: 'binary',
    merkle: 'rfc6962',
    rule: 'Leaf hash is sha256(0x00 || utf8(preimage_utf8)). Node hash is sha256(0x01 || left || right). A trailing odd node is promoted. The root is the prefix that ends at this receipt.',
    leaves: prefix.leaves.map((leaf) => ({
      index: leaf.index,
      kind: leaf.kind,
      task_id: leaf.task_id,
      preimage_utf8: leaf.preimage_utf8,
    })),
    hash: prefix.root,
  });
}

function jobSpecField(receipt) {
  const hash = receipt?.job_spec_hash || receipt?.board?.job_spec_hash || receipt?.a2a_escrow?.job_spec_hash || null;
  if (!hash) return null;
  const preimage = receipt?.job_spec_preimage || receipt?.board?.job_spec_preimage || null;
  if (typeof preimage !== 'string') return { unavailable: true, hash };
  const digest = `0x${sha256Utf8(preimage)}`;
  if (digest.toLowerCase() !== String(hash).toLowerCase()) return { unavailable: true, hash };
  return {
    entry: fieldEntry({
      field: 'job_spec_hash',
      alg: 'sha256',
      encoding: 'utf8',
      rule: `sha256(utf8(JSON.stringify({${JOB_SPEC_FIELDS.join(',')}}))) with 0x prefix. Key order is ${JOB_SPEC_FIELDS.join(', ')}.`,
      preimage_utf8: preimage,
      hash: digest,
    }),
  };
}

/**
 * Board job spec bytes. Same JSON.stringify the hash was computed from.
 * @param {string} text
 * @param {string|number|bigint} budget
 * @param {string} deadline
 * @param {string} acceptance
 */
export function jobSpecPreimage(text, budget, deadline, acceptance) {
  return JSON.stringify({
    text: String(text),
    budget: String(budget),
    deadline: String(deadline),
    acceptance: String(acceptance || ''),
  });
}

function listed(receipt, field) {
  const value = field.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), receipt);
  return value != null && value !== '';
}

/**
 * @param {object} receipt
 * @param {{ baseUrl?: string, taskId?: string, prefix?: object|null }} [opts]
 */
export function buildPublicPreimages(receipt, { baseUrl = '', taskId = null, prefix = null } = {}) {
  if (!receipt || typeof receipt !== 'object') return null;
  const fields = {};
  const not = [];

  const chain = receipt.book_chain || null;
  const row = rowHashField(chain, 'book_chain.row_hash');
  if (row) fields['book_chain.row_hash'] = row;
  else if (chain?.row_hash) {
    not.push({ field: 'book_chain.row_hash', hash: chain.row_hash, reason: 'The public book_chain fields do not reproduce row_hash, so the preimage is not published.' });
  }

  const refusalRow = receipt.book_row || null;
  const refusal = rowHashField(
    refusalRow ? { ...refusalRow, book_id: receipt.book_id ?? receipt.agent_id } : null,
    'book_row.row_hash',
  );
  if (refusal) fields['book_row.row_hash'] = refusal;

  const leaf = receipt.inclusion?.leaf;
  const leafTask = receipt.inclusion?.task_id || receipt.task_id;
  const leafRow = chain?.row_hash || receipt.row_hash || null;
  if (leaf && leafTask && leafRow != null) {
    const pre = inclusionLeafPreimage(leafTask, leafRow);
    if (pre.hash === String(leaf).replace(/^0x/, '').toLowerCase()) {
      fields['inclusion.leaf'] = fieldEntry({ field: 'inclusion.leaf', ...pre });
    }
  }

  const bound = bindingField(receipt);
  if (bound?.entry) fields['binding.expected_commitment'] = bound.entry;
  else if (bound?.unavailable) {
    not.push({
      field: 'binding.expected_commitment',
      hash: receipt.binding?.expected_commitment || null,
      reason: NOT_RECOMPUTABLE_REASONS.binding,
    });
  }

  const emptyCoverage = coverageEmptyField(receipt);
  if (emptyCoverage) {
    fields['coverage.universe_hash'] = emptyCoverage;
    if (receipt.coverage?.enumerated_hash === emptyCoverage.hash) {
      fields['coverage.enumerated_hash'] = { ...emptyCoverage, field: 'coverage.enumerated_hash' };
    }
  } else if (receipt.coverage?.universe_hash || receipt.coverage?.enumerated_hash) {
    not.push({
      field: 'coverage.universe_hash',
      hash: receipt.coverage?.universe_hash || null,
      reason: NOT_RECOMPUTABLE_REASONS.coverage,
    });
    if (receipt.coverage?.enumerated_hash && receipt.coverage.enumerated_hash !== receipt.coverage.universe_hash) {
      not.push({
        field: 'coverage.enumerated_hash',
        hash: receipt.coverage.enumerated_hash,
        reason: NOT_RECOMPUTABLE_REASONS.coverage,
      });
    }
  }

  const treeHash = receipt.tree_head_hash || null;
  if (treeHash && prefix?.ok && prefix.root === String(treeHash).replace(/^0x/, '').toLowerCase()) {
    const tree = treeField(prefix);
    if (tree) fields.tree_head_hash = tree;
  } else if (treeHash) {
    not.push({ field: 'tree_head_hash', hash: treeHash, reason: NOT_RECOMPUTABLE_REASONS.tree });
  }

  const spec = jobSpecField(receipt);
  if (spec?.entry) fields.job_spec_hash = spec.entry;
  else if (spec?.unavailable) {
    not.push({ field: 'job_spec_hash', hash: spec.hash, reason: NOT_RECOMPUTABLE_REASONS.jobSpec });
  }

  if (listed(receipt, 'output.hash')) {
    not.push({ field: 'output.hash', hash: receipt.output.hash, reason: NOT_RECOMPUTABLE_REASONS.output });
  }
  if (receipt.fulfillment?.output_commitment?.hash) {
    not.push({
      field: 'fulfillment.output_commitment.hash',
      hash: receipt.fulfillment.output_commitment.hash,
      reason: NOT_RECOMPUTABLE_REASONS.output,
    });
  }
  if (receipt.caller_binding?.api_key_hash) {
    not.push({
      field: 'caller_binding.api_key_hash',
      hash: receipt.caller_binding.api_key_hash,
      reason: NOT_RECOMPUTABLE_REASONS.apiKey,
    });
  }
  const modelCommitment = receipt.route?.model_commitment?.commitment || receipt.route?.model_commitment || null;
  if (typeof modelCommitment === 'string' && modelCommitment) {
    not.push({ field: 'route.model_commitment', hash: modelCommitment, reason: NOT_RECOMPUTABLE_REASONS.model });
  }
  if (receipt.hmac_attestation?.value || receipt.signature?.value) {
    const vendorBlind = receipt.privacy?.mode === 'vendor_blind';
    const note = {
      field: 'hmac_attestation.value',
      hash: receipt.hmac_attestation?.value || receipt.signature?.value,
      reason: NOT_RECOMPUTABLE_REASONS.hmac,
    };
    if (!vendorBlind) {
      try {
        note.preimage_utf8 = canonicalSignedPayload(receipt);
        note.encoding = 'utf8';
        note.rule = 'JSON.stringify of the canonical field array. HMAC-SHA256 with the gateway secret. Not a bare SHA-256.';
      } catch {
        /* the array is informational; a failure here does not hide the reason */
      }
    } else {
      note.reason += ' This receipt is vendor-blind, so the payload bytes are not published.';
    }
    not.push(note);
  }
  if (receipt.delegation_hash || receipt.caller_binding?.delegation_hash || receipt.session?.delegation_hash) {
    not.push({
      field: 'delegation_hash',
      hash: receipt.delegation_hash || receipt.caller_binding?.delegation_hash || receipt.session?.delegation_hash,
      reason: NOT_RECOMPUTABLE_REASONS.delegation,
    });
  }

  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  const links = {};
  const refusalId = receipt.refusal_id;
  const isRefusal = receipt.schema === 'chit402.refusal.v1' || receipt.kind === 'refusal';
  if (isRefusal && refusalId) {
    const path = `/refusal/${encodeURIComponent(String(refusalId))}/preimage`;
    links.preimage = base ? `${base}${path}` : path;
  } else {
    const id = taskId || receipt.task_id || null;
    if (id) {
      const path = `/receipt/${encodeURIComponent(String(id))}/preimage`;
      links.preimage = base ? `${base}${path}` : path;
    }
  }

  return {
    schema: PREIMAGE_SCHEMA,
    canonical: canonicalObjectDescriptor(receipt),
    canonicalization: {
      utf8: 'Pipe-joined and JSON preimages are UTF-8 with no trailing newline. Null and missing pipe fields are empty strings.',
      sha256: 'SHA-256. Hex is lowercase. A 0x prefix is present only when the published hash uses one.',
      keccak256: 'keccak256 of the hex preimage bytes (abi.encodePacked).',
      jcs: 'JCS (RFC 8785) is the form for issuer-history entries, the sealed history document, and the whole receipt or refusal canonical object. Per-field receipt hashes keep the encoding they were signed with.',
      merkle: 'RFC 6962. Leaf = SHA-256(0x00 || body). Node = SHA-256(0x01 || left || right). A trailing odd node is promoted.',
    },
    fields,
    not_recomputable: not,
    links,
  };
}

/**
 * Attach `preimages` to a public receipt. Does not copy prompts, output text,
 * or book rows.
 * @param {object} receipt
 * @param {{ baseUrl?: string, prefix?: object|null }} [opts]
 */
export function withPublicPreimages(receipt, opts = {}) {
  if (!receipt || typeof receipt !== 'object') return receipt;
  if (receipt.schema && receipt.schema !== 'xfuel.receipt.v4' && receipt.schema !== 'chit402.refusal.v1' && !receipt.book_chain && !receipt.book_row) {
    return receipt;
  }
  const preimages = buildPublicPreimages(receipt, opts);
  if (!preimages) return receipt;
  return { ...receipt, preimages };
}

export function preimageField(preimages, field) {
  if (!preimages || !field) return null;
  const key = String(field);
  if (preimages.fields && preimages.fields[key]) return preimages.fields[key];
  return null;
}

export function preimageBytes(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.preimage_hex === 'string' && entry.preimage_hex) {
    const hex = entry.preimage_hex.replace(/^0x/, '');
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2) return null;
    return Buffer.from(hex, 'hex');
  }
  if (typeof entry.preimage_utf8 === 'string' || entry.preimage_utf8 === '') {
    return Buffer.from(entry.preimage_utf8, 'utf8');
  }
  return null;
}

export { canonicalJson as jcsCanonicalize };
