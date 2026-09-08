/**
 * Unaffiliated / no-ref inflow rows — patron-style funding without payment.ref.
 *
 * Settle-time signed bucket/allocation claim on the book row.
 * Revisable only via append-only correction — never scrape-later.
 */

import crypto from 'crypto';

export const INFLOW_HMAC_PREFIX = 'xfuel-inflow';
export const INFLOW_CORRECTION_HMAC_PREFIX = 'xfuel-inflow-correction';

/** Canonical HMAC payload for an inflow allocation claim. */
export function inflowClaimPayload(agentId, taskId, bucket, allocation, asOf) {
  return `${INFLOW_HMAC_PREFIX}:${Number(agentId)}:${String(taskId)}:${String(bucket)}:${String(allocation)}:${String(asOf)}`;
}

/** Canonical HMAC payload for an append-only inflow correction. */
export function inflowCorrectionPayload(agentId, taskId, bucket, allocation, asOf, reason) {
  return `${INFLOW_CORRECTION_HMAC_PREFIX}:${Number(agentId)}:${String(taskId)}:${String(bucket)}:${String(allocation)}:${String(asOf)}:${String(reason || '')}`;
}

/**
 * Sign an inflow allocation claim with the possession session.
 * @param {{ agentId: number, taskId: string, bucket: string, allocation: string, asOf?: string }} claim
 * @param {string} session
 */
export function signInflowClaim(claim, session) {
  const asOf = claim.asOf || new Date().toISOString();
  const digest = crypto
    .createHmac('sha256', session)
    .update(inflowClaimPayload(claim.agentId, claim.taskId, claim.bucket, claim.allocation, asOf))
    .digest('hex');
  return {
    bucket: String(claim.bucket),
    allocation: String(claim.allocation),
    as_of: asOf,
    signature: { alg: 'HMAC-SHA256', value: `sha256=${digest}` },
  };
}

/**
 * Verify an inflow allocation claim HMAC.
 * @param {object} inflowClaim
 * @param {{ agentId: number, taskId: string }} ctx
 * @param {string} session
 */
export function verifyInflowClaim(inflowClaim, ctx, session) {
  if (!session || !inflowClaim?.signature?.value) {
    return { checked: false, valid: null, reason: 'no_verify_key' };
  }
  const digest = crypto
    .createHmac('sha256', session)
    .update(inflowClaimPayload(
      ctx.agentId,
      ctx.taskId,
      inflowClaim.bucket,
      inflowClaim.allocation,
      inflowClaim.as_of,
    ))
    .digest('hex');
  const expected = `sha256=${digest}`;
  const a = Buffer.from(String(inflowClaim.signature.value).toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { checked: true, valid };
}

/**
 * Sign an append-only inflow correction.
 */
export function signInflowCorrection(claim, session) {
  const asOf = claim.asOf || new Date().toISOString();
  const digest = crypto
    .createHmac('sha256', session)
    .update(inflowCorrectionPayload(
      claim.agentId,
      claim.taskId,
      claim.bucket,
      claim.allocation,
      asOf,
      claim.reason,
    ))
    .digest('hex');
  return {
    bucket: String(claim.bucket),
    allocation: String(claim.allocation),
    reason: String(claim.reason || ''),
    as_of: asOf,
    signature: { alg: 'HMAC-SHA256', value: `sha256=${digest}` },
  };
}

/**
 * Verify an inflow correction HMAC.
 */
export function verifyInflowCorrection(correction, ctx, session) {
  if (!session || !correction?.signature?.value) {
    return { checked: false, valid: null, reason: 'no_verify_key' };
  }
  const digest = crypto
    .createHmac('sha256', session)
    .update(inflowCorrectionPayload(
      ctx.agentId,
      ctx.taskId,
      correction.bucket,
      correction.allocation,
      correction.as_of,
      correction.reason,
    ))
    .digest('hex');
  const expected = `sha256=${digest}`;
  const a = Buffer.from(String(correction.signature.value).toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { checked: true, valid };
}

/**
 * Record an unaffiliated inflow row on the book.
 *
 * @param {number|string} agentId
 * @param {object} body — { bucket, allocation, task_id?, model?, hub?, signature? }
 * @param {{ ledger, registry, verify, isDemo?, claim? }} deps
 */
export function recordBookInflow(agentId, body = {}, { ledger, registry, verify, isDemo = false, claim = {} } = {}) {
  if (isDemo) {
    return {
      status: 403,
      body: { error: 'demo_rejected', message: 'Demo keys cannot write inflow rows' },
    };
  }
  const session = claim.session ? String(claim.session) : null;
  const proof = claim.proof ? String(claim.proof) : null;
  if (!session && !proof) {
    return { status: 401, body: null };
  }

  const id = Number(agentId);
  if (!Number.isInteger(id) || id < 1) {
    return { status: 403, body: null };
  }
  if (typeof verify !== 'function' || !ledger || !registry) {
    return { status: 403, body: null };
  }

  const checked = verify({ agentId: id, window: 50, session, proof });
  if (!checked || checked.checked !== true || checked.valid !== true) {
    return { status: 403, body: null };
  }

  const identity = typeof registry.get === 'function' ? registry.get(id) : null;
  const sessionKey = session || identity?.session;
  if (!sessionKey) {
    return { status: 403, body: null };
  }

  const bucket = String(body.bucket || 'patron').trim();
  const allocation = String(body.allocation || '').trim();
  if (!allocation) {
    return {
      status: 400,
      body: { error: 'invalid_allocation', message: 'allocation (USDC atomic) is required' },
    };
  }

  const taskId = body.task_id
    ? String(body.task_id)
    : `inflow-${id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  let inflowClaim = body.inflow_claim;
  if (!inflowClaim?.signature?.value) {
    inflowClaim = signInflowClaim({
      agentId: id,
      taskId,
      bucket,
      allocation,
      asOf: body.as_of,
    }, sessionKey);
  } else {
    const v = verifyInflowClaim(inflowClaim, { agentId: id, taskId }, sessionKey);
    if (!v.checked || !v.valid) {
      return {
        status: 403,
        body: { error: 'invalid_inflow_claim', message: 'inflow_claim signature invalid' },
      };
    }
  }

  const recorded = ledger.appendInflow({
    agentId: id,
    taskId,
    bucket,
    allocation,
    inflowClaim,
    model: body.model || null,
    hub: body.hub || null,
    intentId: body.intent_id || null,
    attemptIndex: body.attempt_index ?? null,
  });

  if (!recorded.ok) {
    return {
      status: recorded.code === 'duplicate_task' ? 409 : 400,
      body: { error: recorded.code, message: recorded.reason },
    };
  }

  return {
    status: 201,
    body: {
      agent_id: id,
      task_id: taskId,
      bucket,
      allocation,
      inflow_claim: inflowClaim,
      entry: recorded.entry,
    },
  };
}

/**
 * Append-only correction to an inflow row.
 *
 * @param {number|string} agentId
 * @param {object} body — { task_id, bucket?, allocation?, reason, correction? }
 * @param {{ ledger, registry, verify, isDemo?, claim? }} deps
 */
export function correctBookInflow(agentId, body = {}, { ledger, registry, verify, isDemo = false, claim = {} } = {}) {
  if (isDemo) {
    return {
      status: 403,
      body: { error: 'demo_rejected', message: 'Demo keys cannot correct inflow rows' },
    };
  }
  const session = claim.session ? String(claim.session) : null;
  const proof = claim.proof ? String(claim.proof) : null;
  if (!session && !proof) {
    return { status: 401, body: null };
  }

  const id = Number(agentId);
  const taskId = String(body.task_id || '').trim();
  if (!Number.isInteger(id) || id < 1 || !taskId) {
    return { status: 403, body: null };
  }
  if (typeof verify !== 'function' || !ledger || !registry) {
    return { status: 403, body: null };
  }

  const checked = verify({ agentId: id, window: 50, session, proof });
  if (!checked || checked.checked !== true || checked.valid !== true) {
    return { status: 403, body: null };
  }

  const identity = typeof registry.get === 'function' ? registry.get(id) : null;
  const sessionKey = session || identity?.session;
  if (!sessionKey) {
    return { status: 403, body: null };
  }

  const reason = String(body.reason || '').trim();
  if (!reason) {
    return {
      status: 400,
      body: { error: 'reason_required', message: 'reason is required for inflow correction' },
    };
  }

  const entry = ledger.findByTask(taskId);
  const bucket = body.bucket || entry?.bucket || entry?.inflow_claim?.bucket || 'patron';
  const allocation = body.allocation || entry?.amount;

  let correction = body.correction;
  if (!correction?.signature?.value) {
    correction = signInflowCorrection({
      agentId: id,
      taskId,
      bucket,
      allocation,
      reason,
      asOf: body.as_of,
    }, sessionKey);
  } else {
    const v = verifyInflowCorrection(correction, { agentId: id, taskId }, sessionKey);
    if (!v.checked || !v.valid) {
      return {
        status: 403,
        body: { error: 'invalid_correction', message: 'correction signature invalid' },
      };
    }
  }

  const result = ledger.appendInflowCorrection(taskId, id, correction);
  if (!result.ok) {
    return {
      status: result.code === 'not_found' ? 404 : 400,
      body: { error: result.code, message: result.reason },
    };
  }

  return {
    status: 200,
    body: {
      agent_id: id,
      task_id: taskId,
      correction,
      inflow_corrections: result.entry.inflow_corrections,
      bucket: result.entry.bucket,
      allocation: result.entry.amount,
    },
  };
}
