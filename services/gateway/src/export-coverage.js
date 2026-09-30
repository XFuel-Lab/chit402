/**
 * Signed export coverage — the set a book view or export commits to.
 *
 * A stranger holding the document can tell:
 *   - a complete export from a truncated window (complete, counts, two hashes)
 *   - an empty result the issuer actually scanned (empty_by_policy, empty-set hash)
 *   - an empty result where the scan did not finish (empty_by_drain, null hash)
 *
 * Schema chit402.export_coverage.v1. The issuer JWS covers the coverage
 * object. It does not re-sign each payment.
 */
import crypto from 'crypto';
import { deriveEvidence } from './usage-settled.js';
import { signJws, verifyJwsWithJwks, getIssuerPublicKeyJwk, getJwks } from './issuer-key.js';

function jwksUri(baseUrl = '') {
  const path = '/.well-known/jwks.json';
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  return base ? `${base}${path}` : path;
}

export const EXPORT_COVERAGE_SCHEMA = 'chit402.export_coverage.v1';
export const EXPORT_COVERAGE_VERSION = 1;
export const COVERAGE_JWT_TYP = 'chit402-export-coverage+jwt';
/** Sort key a holder can recompute from the rows they were given. */
export const COVERAGE_ORDER = 'collected_at,task_id';
/**
 * SHA-256 over `task_id|evidence|amount|payment_ref|collected_at`.
 * Amount and ref are the ledger fields, not a second encoding.
 */
export const ROW_COMMITMENT_RULE = 'sha256(task_id|evidence|amount|payment_ref|collected_at)';

const EMPTY_HASH = crypto.createHash('sha256').update('').digest('hex');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * @param {object} entry ledger row or export row
 */
export function rowCommitment(entry) {
  const taskId = String(entry?.task_id || '');
  const evidence = String(entry?.evidence || deriveEvidence(entry) || '');
  const amount = entry?.amount ?? entry?.payment?.amount ?? '';
  const ref = entry?.payment_ref ?? entry?.payment?.ref ?? '';
  const at = entry?.collected_at || entry?.recorded_at || '';
  const line = [taskId, evidence, String(amount ?? ''), String(ref ?? ''), String(at ?? '')].join('|');
  return crypto.createHash('sha256').update(line).digest('hex');
}

/** @param {string[]} commitments already in COVERAGE_ORDER */
export function hashOrderedCommitments(commitments) {
  const body = (commitments || []).join('\n');
  return crypto.createHash('sha256').update(body).digest('hex');
}

export function emptyUniverseHash() {
  return EMPTY_HASH;
}

function sortKey(entry) {
  const at = String(entry?.collected_at || entry?.recorded_at || '');
  const id = String(entry?.task_id || '');
  return `${at}\t${id}`;
}

/** Oldest collected_at first, then task_id. Stable for a holder recomputing the hash. */
export function sortForCoverage(entries) {
  return [...(entries || [])].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
}

function timeMs(entry) {
  const raw = entry?.collected_at || entry?.recorded_at || '';
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {object} entry
 * @param {{ from?: string|null, to?: string|null, evidence?: string|null, intentId?: string|null }} scope
 */
export function entryMatchesScope(entry, scope = {}) {
  const from = scope.from ? Date.parse(scope.from) : null;
  const to = scope.to ? Date.parse(scope.to) : null;
  if (from != null || to != null) {
    const ms = timeMs(entry);
    if (ms == null) return false;
    if (from != null && !Number.isNaN(from) && ms < from) return false;
    if (to != null && !Number.isNaN(to) && ms > to) return false;
  }
  if (scope.evidence) {
    const ev = String(entry?.evidence || deriveEvidence(entry) || '');
    if (ev !== String(scope.evidence)) return false;
  }
  if (scope.intentId) {
    if (String(entry?.intent_id || '') !== String(scope.intentId)) return false;
  }
  return true;
}

/**
 * Build the unsigned coverage object.
 *
 * @param {{
 *   bookId: number,
 *   universe: object[],
 *   enumerated: object[],
 *   omittedByPolicy?: number,
 *   filteredOut?: number,
 *   scanComplete?: boolean,
 *   scope?: object,
 *   subjectTaskId?: string|null,
 * }} input
 */
export function buildExportCoverage({
  bookId,
  universe = [],
  enumerated = [],
  omittedByPolicy = 0,
  filteredOut = 0,
  scanComplete = true,
  scope = {},
  subjectTaskId = null,
} = {}) {
  const scanned = scanComplete === true;
  const enumeratedSorted = sortForCoverage(enumerated);
  const universeSorted = sortForCoverage(universe);
  const enumeratedCommitments = enumeratedSorted.map(rowCommitment);
  const universeCommitments = universeSorted.map(rowCommitment);
  const enumeratedCount = enumeratedSorted.length;

  let universeCount = scanned ? universeSorted.length : null;
  let universeHash = scanned ? hashOrderedCommitments(universeCommitments) : null;
  const enumeratedHash = scanned || enumeratedCount > 0
    ? hashOrderedCommitments(enumeratedCommitments)
    : null;
  let emptyReason = null;
  let complete = false;

  if (!scanned) {
    emptyReason = enumeratedCount === 0 ? 'empty_by_drain' : null;
    universeCount = null;
    universeHash = null;
    complete = false;
  } else if (enumeratedCount === 0) {
    emptyReason = 'empty_by_policy';
    complete = true;
    universeCount = universeSorted.length;
    universeHash = hashOrderedCommitments(universeCommitments);
  } else {
    complete = enumeratedCount === universeSorted.length;
    emptyReason = null;
  }

  const subject = subjectTaskId ? String(subjectTaskId) : null;
  const subjectInUniverse = subject
    ? universeSorted.some((row) => String(row.task_id) === subject)
    : null;

  return {
    schema: EXPORT_COVERAGE_SCHEMA,
    payload_version: EXPORT_COVERAGE_VERSION,
    book_id: Number(bookId),
    scope: {
      book_id: Number(bookId),
      from: scope.from || null,
      to: scope.to || null,
      filters: {
        evidence: scope.evidence || null,
        intent_id: scope.intentId || scope.intent_id || null,
      },
      limit: scope.limit ?? null,
    },
    order: COVERAGE_ORDER,
    row_commitment: ROW_COMMITMENT_RULE,
    enumerated_count: enumeratedCount,
    universe_count: universeCount,
    enumerated_hash: enumeratedHash,
    universe_hash: universeHash,
    hash_covers: scanned ? 'universe' : 'unavailable',
    complete,
    truncated: scanned && enumeratedCount > 0 && enumeratedCount < (universeCount || 0),
    empty_reason: emptyReason,
    omitted_by_policy_count: scanned ? Number(omittedByPolicy) || 0 : null,
    filtered_out_count: scanned ? Number(filteredOut) || 0 : null,
    subject_task_id: subject,
    subject_in_universe: subjectInUniverse,
    proves: 'The issuer scanned this book scope and commits to the ordered row set named by universe_hash. complete=false means the document holds a window, not the set. empty_by_policy means the scan finished and the set is empty. empty_by_drain means the scan did not finish; the hash is null.',
    does_not_prove: 'It does not prove a row was paid, that a missing row never existed outside this book, or that a later append is included. Re-export to cover a later set.',
  };
}

export function coverageClaims(coverage) {
  return {
    schema: coverage.schema,
    payload_version: coverage.payload_version,
    book_id: coverage.book_id,
    scope: coverage.scope,
    order: coverage.order,
    row_commitment: coverage.row_commitment,
    enumerated_count: coverage.enumerated_count,
    universe_count: coverage.universe_count,
    enumerated_hash: coverage.enumerated_hash,
    universe_hash: coverage.universe_hash,
    hash_covers: coverage.hash_covers,
    complete: coverage.complete,
    truncated: coverage.truncated,
    empty_reason: coverage.empty_reason,
    omitted_by_policy_count: coverage.omitted_by_policy_count,
    filtered_out_count: coverage.filtered_out_count,
    subject_task_id: coverage.subject_task_id,
    subject_in_universe: coverage.subject_in_universe,
  };
}

/**
 * @param {object} coverage
 * @param {{ baseUrl?: string }} [opts]
 */
export function signExportCoverage(coverage, { baseUrl = '' } = {}) {
  const claims = coverageClaims(coverage);
  const uri = jwksUri(baseUrl);
  const { jws, kid } = signJws(claims, {
    jku: uri.startsWith('http') ? uri : null,
    typ: COVERAGE_JWT_TYP,
  });
  return {
    ...coverage,
    issuer_signature: {
      alg: 'ES256',
      typ: COVERAGE_JWT_TYP,
      payload_version: EXPORT_COVERAGE_VERSION,
      jws,
      kid,
      issuer_jwk: getIssuerPublicKeyJwk(),
    },
  };
}

/**
 * @param {object} signed coverage object with issuer_signature.jws
 * @param {{ keys: object[] }} [jwks]
 */
export function verifyExportCoverage(signed, jwks = null) {
  const sig = signed?.issuer_signature;
  if (!sig?.jws) return { checked: false, valid: false, reason: 'no_signature' };
  const keys = jwks || getJwks();
  const result = verifyJwsWithJwks(sig.jws, keys);
  if (!result.valid) return { checked: true, valid: false, reason: result.reason || 'signature_invalid' };
  const claims = coverageClaims(signed);
  const payload = result.payload || {};
  const same = JSON.stringify(claims) === JSON.stringify({
    schema: payload.schema,
    payload_version: payload.payload_version,
    book_id: payload.book_id,
    scope: payload.scope,
    order: payload.order,
    row_commitment: payload.row_commitment,
    enumerated_count: payload.enumerated_count,
    universe_count: payload.universe_count,
    enumerated_hash: payload.enumerated_hash,
    universe_hash: payload.universe_hash,
    hash_covers: payload.hash_covers,
    complete: payload.complete,
    truncated: payload.truncated,
    empty_reason: payload.empty_reason,
    omitted_by_policy_count: payload.omitted_by_policy_count,
    filtered_out_count: payload.filtered_out_count,
    subject_task_id: payload.subject_task_id ?? null,
    subject_in_universe: payload.subject_in_universe ?? null,
  });
  if (!same) return { checked: true, valid: false, reason: 'claims_mismatch', payload };
  return { checked: true, valid: true, payload };
}

/**
 * Coverage for one agent book from a ledger.
 * Enumerated rows are the newest `limit` visible rows in the scope (same
 * window as the book view). The universe is every visible row in that scope.
 *
 * @param {{ collectVisible: Function }} ledger
 * @param {number} agentId
 * @param {{ limit?: number, from?: string|null, to?: string|null, evidence?: string|null, intentId?: string|null, subjectTaskId?: string|null, scanComplete?: boolean, baseUrl?: string }} [opts]
 */
/**
 * Newest-first window plus the signed coverage of the full scoped set.
 * @returns {{ entries: object[], coverage: object }}
 */
export function selectBookWindow(ledger, agentId, opts = {}) {
  const scope = {
    from: opts.from || null,
    to: opts.to || null,
    evidence: opts.evidence || null,
    intentId: opts.intentId || opts.intent_id || null,
    limit: opts.limit ?? null,
  };
  if (!ledger || typeof ledger.collectVisible !== 'function') {
    return {
      entries: [],
      coverage: signExportCoverage(buildExportCoverage({
        bookId: agentId,
        universe: [],
        enumerated: [],
        scanComplete: false,
        scope,
        subjectTaskId: opts.subjectTaskId || null,
      }), { baseUrl: opts.baseUrl || '' }),
    };
  }
  const scan = ledger.collectVisible(agentId);
  const scanComplete = opts.scanComplete === false ? false : scan.scanComplete === true;
  const matched = [];
  let filteredOut = 0;
  for (const row of scan.rows || []) {
    if (entryMatchesScope(row, scope)) matched.push(row);
    else filteredOut += 1;
  }
  const limit = scope.limit == null ? matched.length : Number(scope.limit);
  const enumerated = Number.isFinite(limit) && limit >= 0 ? matched.slice(0, limit) : matched;
  return {
    entries: enumerated,
    coverage: signExportCoverage(buildExportCoverage({
      bookId: agentId,
      universe: matched,
      enumerated,
      omittedByPolicy: scan.omittedByPolicy,
      filteredOut,
      scanComplete,
      scope,
      subjectTaskId: opts.subjectTaskId || null,
    }), { baseUrl: opts.baseUrl || '' }),
  };
}

export function coverageForLedger(ledger, agentId, opts = {}) {
  return selectBookWindow(ledger, agentId, opts).coverage;
}

/**
 * Coverage over an already-materialized export document (public pull specimens).
 * The file is the universe when row_count matches the rows present.
 * A row_count larger than the rows, with no ids for the rest, is a drain:
 * the hash cannot cover rows the file does not contain.
 *
 * @param {object|string|null} document
 * @param {{ bookId?: number, format?: string }} [opts]
 */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function coverageFromDocument(document, { bookId = null, format = 'json' } = {}) {
  if (format === 'csv' || typeof document === 'string') {
    const lines = String(document || '').split('\n').filter((line) => line && !line.startsWith('#'));
    const header = splitCsvLine(lines[0] || '');
    const idx = (name) => header.indexOf(name);
    const rows = lines.slice(1).filter((line) => line.trim()).map((line) => {
      const cols = splitCsvLine(line);
      const at = (name) => {
        const i = idx(name);
        return i >= 0 ? (cols[i] ?? '') : '';
      };
      return {
        task_id: at('task_id'),
        evidence: at('evidence'),
        amount: at('amount'),
        payment_ref: at('payment_ref'),
        collected_at: at('collected_at'),
      };
    });
    return buildExportCoverage({
      bookId: bookId ?? 0,
      universe: rows,
      enumerated: rows,
      scanComplete: true,
      scope: { limit: rows.length },
    });
  }
  const doc = document && typeof document === 'object' ? document : {};
  const rows = Array.isArray(doc.rows) ? doc.rows : [];
  const declared = doc.row_count != null ? Number(doc.row_count) : rows.length;
  const id = bookId ?? doc.agent_id ?? 0;
  if (Number.isFinite(declared) && declared > rows.length) {
    return buildExportCoverage({
      bookId: id,
      universe: [],
      enumerated: rows,
      scanComplete: false,
      scope: { limit: rows.length },
    });
  }
  return buildExportCoverage({
    bookId: id,
    universe: rows,
    enumerated: rows,
    scanComplete: true,
    scope: { limit: rows.length },
  });
}

export function coverageCsvPreamble(coverage) {
  if (!coverage) return '';
  const lines = [
    `# ${EXPORT_COVERAGE_SCHEMA}`,
    `# book_id=${coverage.book_id}`,
    `# enumerated_count=${coverage.enumerated_count}`,
    `# universe_count=${coverage.universe_count ?? ''}`,
    `# enumerated_hash=${coverage.enumerated_hash ?? ''}`,
    `# universe_hash=${coverage.universe_hash ?? ''}`,
    `# complete=${coverage.complete}`,
    `# truncated=${coverage.truncated}`,
    `# empty_reason=${coverage.empty_reason ?? ''}`,
    `# hash_covers=${coverage.hash_covers}`,
    `# order=${coverage.order}`,
    `# scope=${JSON.stringify(coverage.scope)}`,
    `# coverage_jws=${coverage.issuer_signature?.jws || ''}`,
  ];
  return `${lines.join('\n')}\n`;
}

/** HTML block for the verify page and the print export. */
export function renderCoverageSection(coverage) {
  if (!coverage || typeof coverage !== 'object') return '';
  const reason = coverage.empty_reason
    ? `<span class="badge pending">${esc(coverage.empty_reason)}</span>`
    : (coverage.complete
      ? '<span class="badge ok">complete</span>'
      : '<span class="badge pending">truncated</span>');
  const subject = coverage.subject_task_id
    ? `<div class="row"><span class="k">This receipt in the set</span><span class="v">${coverage.subject_in_universe ? '<span class="badge ok">in universe</span>' : '<span class="badge bad">not in universe</span>'}</span></div>`
    : '';
  return `<section class="card">
      <h2>Export coverage <span class="scope">${esc(coverage.schema)}</span></h2>
      <div class="row"><span class="k">Set</span><span class="v">${reason}</span></div>
      <div class="row"><span class="k">Enumerated</span><span class="v"><code>${esc(coverage.enumerated_count)}</code></span></div>
      <div class="row"><span class="k">Universe</span><span class="v"><code>${esc(coverage.universe_count ?? '—')}</code></span></div>
      <div class="row"><span class="k">Universe hash</span><span class="v"><code>${esc(coverage.universe_hash || '—')}</code></span></div>
      <div class="row"><span class="k">Scope</span><span class="v"><code>${esc(JSON.stringify(coverage.scope || {}))}</code></span></div>
      ${subject}
      <p class="muted" style="margin:8px 0 0;font-size:12px">${esc(coverage.proves || '')}</p>
      <p class="muted" style="margin:8px 0 0;font-size:12px">${esc(coverage.does_not_prove || '')}</p>
    </section>`;
}
