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
  'openrouter_broadcast',
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

/** Algorithms a sender may name. The gateway does not infer one from a prefix. */
export const OUTPUT_HASH_KINDS = Object.freeze(['sha256', 'keccak256']);
const OUTPUT_HASH_KIND_SET = new Set(OUTPUT_HASH_KINDS);
const DIGEST_HEX = /^[0-9a-fA-F]{64}$/;

export class OutputCommitmentError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'OutputCommitmentError';
    this.code = 'invalid_output_commitment';
  }
}

/**
 * Parse a 32-byte digest. A `sha256:` or `keccak256:` prefix is a label, not a guess.
 * @param {unknown} value
 * @returns {{ hash: string, labeled: string|null } | { error: string } | null}
 */
function parseDigest(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return { error: 'output hash must be a 32-byte hex string' };
  const s = value.trim();
  if (!s) return null;
  let body = s;
  let labeled = null;
  const prefixed = body.match(/^(sha256|keccak256):(.*)$/i);
  if (prefixed) {
    labeled = prefixed[1].toLowerCase();
    body = prefixed[2].trim();
  }
  if (body.startsWith('0x') || body.startsWith('0X')) body = body.slice(2);
  if (!DIGEST_HEX.test(body)) {
    return { error: 'output hash must be 32 bytes of hex for sha256 or keccak256' };
  }
  return { hash: `0x${body.toLowerCase()}`, labeled };
}

/**
 * @param {unknown} kind
 * @param {{ labeled: string|null }} parsed
 */
function requireKind(kind, parsed) {
  if (typeof kind !== 'string' || !kind.trim()) {
    throw new OutputCommitmentError('output_commitment.kind is required and must be sha256 or keccak256');
  }
  const k = kind.trim().toLowerCase();
  if (!OUTPUT_HASH_KIND_SET.has(k)) {
    throw new OutputCommitmentError(`output_commitment.kind must be sha256 or keccak256, not ${k.slice(0, 32)}`);
  }
  if (parsed.labeled && parsed.labeled !== k) {
    throw new OutputCommitmentError(`output_commitment.kind ${k} does not match the ${parsed.labeled} hash label`);
  }
  return k;
}

/**
 * Build output_commitment from explicit input or output hash.
 * @param {{
 *   outputCommitment?: object|null,
 *   deliverableHash?: string|null,
 *   outputHash?: string|null,
 *   hash?: string|null,
 *   kind?: string|null,
 *   hashKind?: string|null,
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
    const parsed = parseDigest(raw.hash ?? raw.value);
    if (parsed?.error) throw new OutputCommitmentError(parsed.error);
    if (parsed?.hash) {
      const objectKind = typeof raw.kind === 'string' && raw.kind.trim() ? raw.kind : null;
      const siblingKind = input.kind ?? input.hashKind ?? input.hash_kind;
      return {
        status: OUTPUT_COMMITMENT_STATUS.COMMITTED,
        hash: parsed.hash,
        kind: requireKind(objectKind ?? siblingKind, parsed),
        omission_rule: null,
      };
    }
  }

  const parsed = parseDigest(
    input.hash
    ?? input.deliverableHash
    ?? input.deliverable_hash
    ?? input.outputHash
    ?? input.output_hash,
  );
  if (parsed?.error) throw new OutputCommitmentError(parsed.error);
  if (parsed?.hash) {
    return {
      status: OUTPUT_COMMITMENT_STATUS.COMMITTED,
      hash: parsed.hash,
      kind: requireKind(input.kind ?? input.hashKind ?? input.hash_kind, parsed),
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
    kind: params.hashKind ?? params.hash_kind ?? params.kind,
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
    issuance_commitment: params.issuanceCommitment ?? params.issuance_commitment ?? null,
  };

  return {
    intent,
    authorization,
    output_commitment,
  };
}

function kindText(value) {
  if (typeof value !== 'string') return null;
  const k = value.trim().toLowerCase();
  return k || null;
}

/**
 * Extract fulfillment fields from an ingest body (flat or nested).
 * A raw `deliverable` is hashed here as sha256. A sender-supplied hash
 * must name `deliverable_kind` or `output_commitment.kind`.
 * @param {object} body
 */
export function fulfillmentFieldsFromIngestBody(body = {}) {
  if (!body || typeof body !== 'object') return {};
  const nested = body.fulfillment && typeof body.fulfillment === 'object' ? body.fulfillment : {};
  const invoice = body.fulfillment_invoice || body.foreign_invoice || body.invoice || body;
  const src = { ...invoice, ...nested, ...body };

  let outputCommitment = src.output_commitment ?? src.outputCommitment ?? nested.output_commitment ?? null;
  let deliverableHash = src.deliverable_hash ?? src.deliverableHash ?? null;
  let hashKind = kindText(src.deliverable_kind ?? src.deliverableKind ?? src.hash_kind ?? src.hashKind);
  let commitmentError = null;

  if (outputCommitment && typeof outputCommitment === 'object') {
    const commitmentKind = kindText(outputCommitment.kind);
    let fromCommitment = null;
    if (outputCommitment.hash) {
      fromCommitment = parseDigest(outputCommitment.hash);
      const fromClient = deliverableHash != null ? parseDigest(deliverableHash) : null;
      if (fromCommitment?.error) commitmentError = fromCommitment.error;
      else if (fromClient?.error) commitmentError = fromClient.error;
      else if (fromCommitment?.hash && fromClient?.hash && fromCommitment.hash !== fromClient.hash) {
        commitmentError = 'deliverable_hash does not match output_commitment.hash';
      }
    }
    if (!commitmentError && commitmentKind && !OUTPUT_HASH_KIND_SET.has(commitmentKind)) {
      commitmentError = `output_commitment.kind must be sha256 or keccak256, not ${commitmentKind.slice(0, 32)}`;
    }
    if (!commitmentError && hashKind && commitmentKind && hashKind !== commitmentKind) {
      commitmentError = `deliverable_kind ${hashKind} does not match output_commitment.kind ${commitmentKind}`;
    }
    if (!hashKind && commitmentKind) hashKind = commitmentKind;
    const effectiveKind = commitmentKind || hashKind;
    if (!commitmentError && fromCommitment?.labeled && effectiveKind && fromCommitment.labeled !== effectiveKind) {
      commitmentError = `output_commitment.kind ${effectiveKind} does not match the ${fromCommitment.labeled} hash label`;
    }
  }

  if (!commitmentError && hashKind && !OUTPUT_HASH_KIND_SET.has(hashKind)) {
    commitmentError = `output_commitment.kind must be sha256 or keccak256, not ${hashKind.slice(0, 32)}`;
  }
  if (!commitmentError && deliverableHash != null && src.deliverable == null) {
    const labeled = parseDigest(deliverableHash);
    if (labeled?.error) commitmentError = labeled.error;
    else if (labeled?.labeled && hashKind && labeled.labeled !== hashKind) {
      commitmentError = `output_commitment.kind ${hashKind} does not match the ${labeled.labeled} hash label`;
    }
  }

  if (!commitmentError && src.deliverable != null) {
    const hashed = hashDeliverablePayload(src.deliverable);
    if (deliverableHash != null) {
      const supplied = parseDigest(deliverableHash);
      if (supplied?.error) commitmentError = supplied.error;
      else if (supplied?.hash && supplied.hash !== hashed) {
        commitmentError = 'deliverable does not match deliverable_hash; the gateway sha256 is the commitment';
      }
    }
    if (hashKind && hashKind !== 'sha256') {
      commitmentError = 'a gateway-hashed deliverable is sha256; a different kind cannot be attached';
    }
    if (outputCommitment && typeof outputCommitment === 'object' && kindText(outputCommitment.kind) && kindText(outputCommitment.kind) !== 'sha256') {
      commitmentError = 'a gateway-hashed deliverable is sha256; output_commitment.kind cannot override it';
    }
    deliverableHash = hashed;
    hashKind = 'sha256';
    if (!commitmentError) {
      outputCommitment = {
        status: OUTPUT_COMMITMENT_STATUS.COMMITTED,
        hash: hashed,
        kind: 'sha256',
      };
    }
  }

  const hasHash = deliverableHash != null && deliverableHash !== ''
    || (outputCommitment && typeof outputCommitment === 'object' && outputCommitment.hash);
  const unverified = outputCommitment && typeof outputCommitment === 'object'
    && outputCommitment.status === OUTPUT_COMMITMENT_STATUS.UNVERIFIED
    && !outputCommitment.hash;
  if (!commitmentError && hasHash && !unverified && !hashKind) {
    commitmentError = 'output_commitment.kind is required and must be sha256 or keccak256';
  }
  if (
    !commitmentError
    && hashKind
    && outputCommitment
    && typeof outputCommitment === 'object'
    && outputCommitment.hash
    && !kindText(outputCommitment.kind)
  ) {
    outputCommitment = { ...outputCommitment, kind: hashKind };
  }

  return {
    jobKind: src.job_kind ?? src.jobKind ?? nested.intent?.job_kind ?? null,
    resource: src.resource ?? src.service_url ?? src.serviceUrl ?? nested.intent?.resource ?? null,
    intentId: src.intent_id ?? src.intentId ?? nested.intent?.intent_id ?? null,
    attemptIndex: src.attempt_index ?? src.attemptIndex ?? nested.intent?.attempt_index ?? null,
    outputCommitment,
    deliverableHash,
    hashKind,
    omitDeliverable: src.omit_deliverable === true,
    ...(commitmentError ? { commitmentError } : {}),
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
        kind: {
          type: ['string', 'null'],
          enum: [...OUTPUT_HASH_KINDS],
          description: 'Required when hash is set. sha256 or keccak256. The gateway does not infer this from a 0x prefix.',
        },
        omission_rule: { type: ['string', 'null'] },
      },
    },
  },
};

export const OUTPUT_COMMITMENT_OPENAPI_SCHEMA = FULFILLMENT_OPENAPI_SCHEMA.properties.output_commitment;
