/**
 * Per-book append position.
 *
 * Every indexed row in a book gets a monotonic seq (1, 2, 3, …) and the
 * previous row's hash. Idempotent replays do not pass through _index, so
 * they do not take a new seq. A correction is a new row and does.
 *
 * The position is signed as chit402.book_seq.v1. Payload version 4 also signs
 * payment_ref with book_id. It is not mixed into the payment JWS, so a v8
 * receipt still verifies. Versions 2 and 3 still verify.
 */
import crypto from 'crypto';
import { signJws, verifyJwsWithJwks, getIssuerPublicKeyJwk, getJwks } from './issuer-key.js';
import { actOf } from './book-act.js';

export const BOOK_SEQ_SCHEMA = 'chit402.book_seq.v1';
/** v4 signs payment_ref next to book_id. v2 (act) and v3 (authority) still verify. */
export const BOOK_SEQ_VERSION = 4;
export const BOOK_SEQ_JWT_TYP = 'chit402-book-seq+jwt';

/**
 * Identity hash. Amount is omitted: a later correction row carries the new
 * figure, and the original row's hash stays the hash it had at append.
 * @param {object} row
 */
/**
 * Exact UTF-8 preimage of `row_hash`. Null and missing fields are empty.
 * `agent_id` is the book id. Amount and payment ref are not in this string.
 * @param {object} row
 */
export function bookRowPreimage(row) {
  return [
    row?.agent_id ?? '',
    row?.seq ?? '',
    row?.task_id ?? '',
    row?.prev_hash || '',
    row?.event || row?.evidence || '',
  ].join('|');
}

export function bookRowHash(row) {
  return crypto.createHash('sha256').update(bookRowPreimage(row)).digest('hex');
}

function prevOf(row) {
  if (row?.prev_hash == null || row.prev_hash === '') return null;
  return String(row.prev_hash);
}

/**
 * Gap check plus fork check. A duplicate seq, two rows that share a prev_hash,
 * or a prev_hash that is not the previous seq's row_hash marks the chain
 * FORKED. The first row in input order keeps a duplicated seq. The last line
 * does not win.
 * @param {object[]} rows rows that carry seq
 * @returns {{ gapless: boolean, gaps: number[], next_seq: number, count: number, max_seq: number, forked: boolean, status: string, duplicates: number[], prev_hash_mismatches: object[] }}
 */
export function analyzeSeq(rows) {
  const seqs = [];
  const bySeq = new Map();
  const duplicates = [];
  const seenPrev = new Map();
  for (const row of rows || []) {
    const n = Number(row?.seq);
    if (!Number.isInteger(n) || n <= 0) continue;
    seqs.push(n);
    if (bySeq.has(n)) {
      if (!duplicates.includes(n)) duplicates.push(n);
    } else {
      bySeq.set(n, row);
    }
    const prev = prevOf(row);
    if (prev) {
      const holders = seenPrev.get(prev) || [];
      holders.push(row);
      seenPrev.set(prev, holders);
    }
  }
  const unique = [...bySeq.keys()].sort((a, b) => a - b);
  const gaps = [];
  let expected = 1;
  for (const seq of unique) {
    while (expected < seq) {
      gaps.push(expected);
      expected += 1;
    }
    if (seq === expected) expected += 1;
  }
  const mismatches = [];
  for (const seq of unique) {
    const row = bySeq.get(seq);
    const actual = prevOf(row);
    if (seq === unique[0] && seq === 1) {
      if (actual) mismatches.push({ seq, reason: 'prev_hash_mismatch', expected: null, actual });
      continue;
    }
    const parent = bySeq.get(seq - 1);
    const expectedHash = parent?.row_hash ? String(parent.row_hash) : null;
    if (!parent || actual !== expectedHash) {
      mismatches.push({ seq, reason: 'prev_hash_mismatch', expected: expectedHash, actual });
    }
  }
  const sharedPrev = [];
  for (const [prev, holders] of seenPrev) {
    const ids = [...new Set(holders.map((row) => Number(row.seq)))];
    if (ids.length > 1) sharedPrev.push({ prev_hash: prev, seqs: ids });
  }
  const max = unique.length ? unique[unique.length - 1] : 0;
  const forked = duplicates.length > 0 || mismatches.length > 0 || sharedPrev.length > 0;
  let status = 'ok';
  if (forked) status = 'FORKED';
  else if (gaps.length > 0) status = 'gapped';
  return {
    gapless: gaps.length === 0 && !forked,
    gaps,
    next_seq: max + 1,
    count: seqs.length,
    max_seq: max,
    forked,
    status,
    duplicates,
    prev_hash_mismatches: mismatches,
    shared_prev: sharedPrev,
  };
}

export function bookSeqClaims(row) {
  const act = actOf(row);
  return {
    schema: BOOK_SEQ_SCHEMA,
    payload_version: BOOK_SEQ_VERSION,
    book_id: Number(row.agent_id),
    task_id: String(row.task_id),
    seq: Number(row.seq),
    prev_hash: row.prev_hash || null,
    row_hash: row.row_hash,
    event: row.event || row.evidence || null,
    act,
    replay_of: row.replay_of || null,
    payment_ref: row.payment_ref ? String(row.payment_ref) : null,
    ...(row.anchor ? { anchor: row.anchor } : {}),
    ...(row.authority ? { authority: row.authority } : {}),
  };
}

/**
 * Sign the append position. Claims have no iat, so the same row signs to
 * the same JWS for a stable issuer key.
 * @param {object} row
 */
export function signBookSeq(row) {
  if (row?.seq == null || !row?.task_id || !row?.agent_id) return null;
  const claims = bookSeqClaims(row);
  const { jws, kid } = signJws(claims, { typ: BOOK_SEQ_JWT_TYP });
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: BOOK_SEQ_JWT_TYP,
      payload_version: claims.payload_version,
      jws,
      kid,
      issuer_jwk: getIssuerPublicKeyJwk(),
    },
  };
}

export function verifyBookSeq(signed, jwks = null) {
  const sig = signed?.issuer_signature;
  if (!sig?.jws) return { checked: false, valid: false, reason: 'no_signature' };
  const result = verifyJwsWithJwks(sig.jws, jwks || getJwks());
  if (!result.valid) return { checked: true, valid: false, reason: result.reason || 'signature_invalid' };
  const payload = result.payload || {};
  if (Number(payload.seq) !== Number(signed.seq)) {
    return { checked: true, valid: false, reason: 'seq_mismatch' };
  }
  if (String(payload.task_id) !== String(signed.task_id)) {
    return { checked: true, valid: false, reason: 'task_mismatch' };
  }
  if ((payload.prev_hash || null) !== (signed.prev_hash || null)) {
    return { checked: true, valid: false, reason: 'prev_hash_mismatch' };
  }
  if (payload.row_hash !== signed.row_hash) {
    return { checked: true, valid: false, reason: 'row_hash_mismatch' };
  }
  const version = Number(payload.payload_version);
  if (version >= 4 || Object.prototype.hasOwnProperty.call(payload, 'payment_ref')) {
    const signedRef = payload.payment_ref || null;
    const outerRef = signed.payment_ref || null;
    if (signedRef !== outerRef) {
      return { checked: true, valid: false, reason: 'payment_ref_mismatch' };
    }
  }
  return { checked: true, valid: true, payload };
}

/** HTML rows for the verify page. `lane` is the unsigned receipt-lane decision. */
export function renderBookSeqSection(chain, lane = null) {
  if ((!chain || chain.seq == null) && !lane) return '';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const seq = chain?.seq ?? lane?.book_seq;
  if (seq == null && !lane) return '';
  const changed = lane?.anchor_changed_since_binding;
  const changedLabel = changed == null ? 'unknown' : (changed ? 'true' : 'false');
  const laneRows = lane ? `
      <div class="row"><span class="k">settled_by</span><span class="v"><code>${esc(lane.settled_by ?? 'null')}</code></span></div>
      <div class="row"><span class="k">settled</span><span class="v"><code>${esc(lane.settled == null ? 'null' : lane.settled)}</code></span></div>
      <div class="row"><span class="k">anchor_changed_since_binding</span><span class="v"><code>${esc(changedLabel)}</code></span></div>
      <div class="row"><span class="k">freeze</span><span class="v">${lane.freeze
        ? `<span class="badge pending">freeze</span> <code>${esc(lane.reason || '')}</code>`
        : '<code>false</code>'}</span></div>
      <div class="row"><span class="k">classification</span><span class="v"><code>${esc(lane.classification || '')}</code></span></div>
      ${lane.local_check ? `<div class="row"><span class="k">local_check</span><span class="v"><code>${esc(lane.local_check.payee)}</code> <code>${esc(lane.local_check.amount_atomic)}</code> <span class="muted">not a payment</span></span></div>` : ''}
      <p class="muted" style="margin:8px 0 0;font-size:12px">Unsigned. Ordering is seq + settled_by + (anchor_changed AND not settled). Boundary: complete over registry marks, blind to payments the registry never joined. Freeze only when seq is set, settled_by is receipt, the anchor changed after binding, and the row is not settled. An anchor change alone does not freeze. classification unverifiable_from_registry means past expiry with no registry marks, not unpaid. Not part of the payment signature.</p>` : '';
  return `<section class="card">
      <h2>Book position <span class="scope">${esc(chain?.schema || (lane ? 'chit402.receipt_lane.v1' : BOOK_SEQ_SCHEMA))}</span></h2>
      <div class="row"><span class="k">seq</span><span class="v"><code>${esc(seq ?? '—')}</code></span></div>
      ${chain && Object.prototype.hasOwnProperty.call(chain, 'payment_ref') ? `<div class="row"><span class="k">Payment ref</span><span class="v"><code>${esc(chain.payment_ref || '—')}</code></span></div>` : ''}
      ${chain?.act ? `<div class="row"><span class="k">Act</span><span class="v"><code>${esc(chain.act)}</code></span></div>` : ''}
      ${chain?.authority ? `<div class="row"><span class="k">Subject</span><span class="v"><code>${esc(chain.authority.subject_handle || chain.authority.subject_wallet || '—')}</code> <span class="muted">writer ${esc(chain.authority.writer)} · issuer ${esc(chain.authority.issuer)}</span></span></div>` : ''}
      <div class="row"><span class="k">Previous hash</span><span class="v"><code>${esc(chain?.prev_hash || '—')}</code></span></div>
      <div class="row"><span class="k">Row hash</span><span class="v"><code>${esc(chain?.row_hash || '—')}</code></span></div>
      ${chain?.anchor ? `<div class="row"><span class="k">Chain anchor</span><span class="v">${chain.anchor.status === 'observed'
        ? `<code>${esc(chain.anchor.rail)} ${esc(chain.anchor.chain_id)} #${esc(chain.anchor.block_number)}</code> <code>${esc(chain.anchor.block_hash)}</code>`
        : `<span class="badge pending">${esc(chain.anchor.status || 'UNAVAILABLE')}</span>`}</span></div>` : ''}
      <p class="muted" style="margin:8px 0 0;font-size:12px">Proves this row's append position in the book and the previous row's hash. Payload version 4 also names payment_ref. It does not prove the transfer succeeded, and a replay of the same payment does not take a new seq.</p>
      ${laneRows}
    </section>`;
}
