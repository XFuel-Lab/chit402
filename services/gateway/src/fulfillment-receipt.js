/**
 * Fulfillment receipt v1 — paid job envelope beyond chat completions.
 *
 * Chain: intent → authorization → payment.ref → output_commitment → verify_url
 * See docs/product/fulfillment-receipt-v1.md
 */

import crypto from 'crypto';

export const FULFILLMENT_JOB_KINDS = Object.freeze([
  'completions',
  'scrape',
  'review',
  'swap',
  'research',
  'acp_job',
  'other',
]);

export const OUTPUT_COMMITMENT_STATUS = Object.freeze({
  COMMITTED: 'committed',
  UNVERIFIED: 'UNVERIFIED',
});

export const OUTPUT_OMISSION_RULES = Object.freeze({
  MISSING_DELIVERABLE: 'missing_deliverable_at_stamp',
});

const JOB_KIND_SET = new Set(FULFILLMENT_JOB_KINDS);

/**
 * @param {unknown} value
 * @param {{ resource?: string|null, defaultKind?: string }} [opts]
 * @returns {string}
 */
export function normalizeJobKind(value, { resource = null, defaultKind = 'other' } = {}) {
  if (value != null && String(value).trim()) {
    const k = String(value).trim().toLowerCase();
    if (JOB_KIND_SET.has(k)) return k;
  }
  const r = resource ? String(resource).toLowerCase() : '';
  if (r.includes('chat/completions') || r.includes('/v1/completions')) return 'completions';
  if (r.includes('/acp') || r.includes('acp_job') || r.includes('virtuals')) return 'acp_job';
  if (r.includes('scrape') || r.includes('/scrape')) return 'scrape';
  if (r.includes('review')) return 'review';
  if (r.includes('swap')) return 'swap';
  if (r.includes('research')) return 'research';
  const fallback = String(defaultKind || 'other').toLowerCase();
  return JOB_KIND_SET.has(fallback) ? fallback : 'other';
}

function normalizeHash(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  if (/^sha256:[0-9a-fA-F]{64}$/i.test(s)) return s.toLowerCase();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return `0x${s.toLowerCase()}`;
  return s;
}

/**
 * Build output_commitment from explicit input or output hash.
 * @param {{
 *   outputCommitment?: object|null,
 *   deliverableHash?: string|null,
 *   outputHash?: string|null,
 *   hash?: string|null,
 *   omitDeliverable?: boolean,
 * }} input
 */
export function outputCommitmentOf(input = {}) {
  const raw = input.outputCommitment || input.output_commitment;
  if (raw && typeof raw === 'object') {
    if (raw.status === OUTPUT_COMMITMENT_STATUS.UNVERIFIED) {
      return {
        status: OUTPUT_COMMITMENT_STATUS.UNVERIFIED,
        hash: null,
        omission_rule: raw.omission_rule || OUTPUT_OMISSION_RULES.MISSING_DELIVERABLE,
      };
    }
    const h = normalizeHash(raw.hash ?? raw.value);
    if (h) {
      return {
        status: OUTPUT_COMMITMENT_STATUS.COMMITTED,
        hash: h,
        kind: raw.kind || (h.startsWith('0x') ? 'keccak256' : 'sha256'),
        omission_rule: null,
      };
    }
  }

  const h = normalizeHash(
    input.hash
    ?? input.deliverableHash
    ?? input.deliverable_hash
    ?? input.outputHash
    ?? input.output_hash,
  );
  if (h) {
    return {
      status: OUTPUT_COMMITMENT_STATUS.COMMITTED,
      hash: h,
      kind: h.startsWith('0x') ? 'keccak256' : 'sha256',
      omission_rule: null,
    };
  }

  if (input.omitDeliverable === true) {
    return {
      status: OUTPUT_COMMITMENT_STATUS.UNVERIFIED,
      hash: null,
      omission_rule: OUTPUT_OMISSION_RULES.MISSING_DELIVERABLE,
    };
  }

  return {
    status: OUTPUT_COMMITMENT_STATUS.UNVERIFIED,
    hash: null,
    omission_rule: OUTPUT_OMISSION_RULES.MISSING_DELIVERABLE,
  };
}

/** Hash arbitrary deliverable bytes for ingest (sha256 hex with 0x prefix). */
export function hashDeliverablePayload(payload) {
  const buf = typeof payload === 'string'
    ? Buffer.from(payload, 'utf8')
    : Buffer.from(payload);
  return `0x${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

/**
 * @param {{
 *   jobKind?: string|null,
 *   resource?: string|null,
 *   intentId?: string|null,
 *   attemptIndex?: number|null,
 *   payerWallet?: string|null,
 *   delegationHash?: string|null,
 *   paymentRef?: string|null,
 *   outputCommitment?: object|null,
 *   outputHash?: string|null,
 *   deliverableHash?: string|null,
 *   defaultJobKind?: string,
 * }} params
 */
export function buildFulfillmentEnvelope(params = {}) {
  const resource = params.resource ?? null;
  const job_kind = normalizeJobKind(params.jobKind ?? params.job_kind, {
    resource,
    defaultKind: params.defaultJobKind || 'other',
  });
  const output_commitment = outputCommitmentOf({
    outputCommitment: params.outputCommitment,
    outputHash: params.outputHash,
    deliverableHash: params.deliverableHash,
    hash: params.hash,
    omitDeliverable: params.omitDeliverable,
  });

  const intent = {
    job_kind,
    resource,
    intent_id: params.intentId ?? params.intent_id ?? null,
    attempt_index: params.attemptIndex ?? params.attempt_index ?? null,
  };

  const authorization = {
    payer_wallet: params.payerWallet ?? params.payer_wallet ?? null,
    delegation_hash: params.delegationHash ?? params.delegation_hash ?? null,
    payment_ref: params.paymentRef ?? params.payment_ref ?? null,
  };

  return {
    intent,
    authorization,
    output_commitment,
  };
}

/**
 * Extract fulfillment fields from an ingest body (flat or nested).
 * @param {object} body
 */
export function fulfillmentFieldsFromIngestBody(body = {}) {
  if (!body || typeof body !== 'object') return {};
  const nested = body.fulfillment && typeof body.fulfillment === 'object' ? body.fulfillment : {};
  const invoice = body.fulfillment_invoice || body.foreign_invoice || body.invoice || body;
  const src = { ...invoice, ...nested, ...body };

  let deliverableHash = src.deliverable_hash ?? src.deliverableHash ?? null;
  if (!deliverableHash && src.deliverable != null) {
    deliverableHash = hashDeliverablePayload(src.deliverable);
  }

  return {
    jobKind: src.job_kind ?? src.jobKind ?? nested.intent?.job_kind ?? null,
    resource: src.resource ?? src.service_url ?? src.serviceUrl ?? nested.intent?.resource ?? null,
    intentId: src.intent_id ?? src.intentId ?? nested.intent?.intent_id ?? null,
    attemptIndex: src.attempt_index ?? src.attemptIndex ?? nested.intent?.attempt_index ?? null,
    outputCommitment: src.output_commitment ?? src.outputCommitment ?? nested.output_commitment ?? null,
    deliverableHash,
    omitDeliverable: src.omit_deliverable === true,
  };
}

/** Compact fulfillment fields for /book rows and export. */
export function bookFulfillmentRowOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.fulfillment && typeof entry.fulfillment === 'object') {
    const f = entry.fulfillment;
    return {
      job_kind: f.intent?.job_kind ?? entry.job_kind ?? null,
      resource: f.intent?.resource ?? null,
      intent_id: f.intent?.intent_id ?? entry.intent_id ?? null,
      attempt_index: f.intent?.attempt_index ?? entry.attempt_index ?? null,
      output_commitment: f.output_commitment ?? null,
    };
  }
  if (entry.job_kind) {
    return {
      job_kind: entry.job_kind,
      resource: null,
      intent_id: entry.intent_id ?? null,
      attempt_index: entry.attempt_index ?? null,
      output_commitment: {
        status: 'UNVERIFIED',
        hash: null,
        omission_rule: OUTPUT_OMISSION_RULES.MISSING_DELIVERABLE,
      },
    };
  }
  return null;
}

/** OpenAPI fragment for fulfillment on receipts and book rows. */
export const FULFILLMENT_OPENAPI_SCHEMA = {
  type: 'object',
  description:
    'Paid job envelope: intent → authorization → payment.ref → output_commitment → verify_url.',
  properties: {
    intent: {
      type: 'object',
      properties: {
        job_kind: { type: 'string', enum: [...FULFILLMENT_JOB_KINDS] },
        resource: { type: ['string', 'null'] },
        intent_id: { type: ['string', 'null'] },
        attempt_index: { type: ['integer', 'null'] },
      },
    },
    authorization: {
      type: 'object',
      properties: {
        payer_wallet: { type: ['string', 'null'] },
        delegation_hash: { type: ['string', 'null'] },
        payment_ref: { type: ['string', 'null'] },
      },
    },
    output_commitment: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['committed', 'UNVERIFIED'] },
        hash: { type: ['string', 'null'] },
        kind: { type: ['string', 'null'] },
        omission_rule: { type: ['string', 'null'] },
      },
    },
  },
};

export const OUTPUT_COMMITMENT_OPENAPI_SCHEMA = FULFILLMENT_OPENAPI_SCHEMA.properties.output_commitment;
