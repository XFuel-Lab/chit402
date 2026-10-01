/**
 * Fork detector for receipt supersession.
 *
 * A successor claims a predecessor through `supersedes` or `corrects`.
 * A correction row may also name it in `parent_ref`. Ordinary lineage
 * (`parent_ref` on a spend) is not a supersession claim.
 *
 * Authority is the successor id only when exactly one claimant matches the
 * subject's handle or wallet. Two claimants that both match are FORKED.
 * `authoritative` is null, and neither seq nor recorded_at elects a tip.
 * A gapless book_seq does not hide that fork.
 *
 * The report is derived at read time. It is not part of the payment JWS
 * or the signed book_chain, so an existing receipt still verifies.
 */
export const SUPERSESSION_SCHEMA = 'chit402.supersession.v1';

function text(value) {
  if (value == null) return '';
  const s = String(value).trim();
  return s;
}

/**
 * @param {object|null|undefined} row
 * @returns {string|null}
 */
export function rowIdentity(row) {
  const id = text(row?.task_id);
  if (id) return id;
  const hash = text(row?.row_hash || row?.book_chain?.row_hash);
  return hash || null;
}

/**
 * @param {object|null|undefined} row
 * @returns {boolean}
 */
export function isCorrectionRow(row) {
  const act = row?.act || row?.book_chain?.act;
  const event = row?.event || row?.evidence || row?.book_chain?.event;
  return act === 'correction' || event === 'inflow_correction' || event === 'correction';
}

/**
 * The predecessor this row claims to replace. Null when the row is not a
 * supersession claim.
 * @param {object|null|undefined} row
 * @returns {string|null}
 */
export function supersessionTarget(row) {
  const named = text(row?.supersedes) || text(row?.corrects);
  if (named) return named;
  if (isCorrectionRow(row)) {
    const parent = text(row?.parent_ref);
    if (parent) return parent;
  }
  return null;
}

function authorityOf(row) {
  return row?.authority || row?.book_chain?.authority || {};
}

/**
 * Subject identity carried on the row. Handle wins over wallet when both
 * are present, but matching compares them separately.
 * @param {object|null|undefined} row
 */
export function subjectParts(row) {
  const authority = authorityOf(row);
  const handle = text(authority.subject_handle || row?.subject_handle) || null;
  const walletRaw = text(authority.subject_wallet || row?.subject_wallet || row?.payer);
  return {
    handle,
    wallet: walletRaw ? walletRaw.toLowerCase() : null,
  };
}

function subjectLabel(row) {
  const parts = subjectParts(row);
  return parts.handle || parts.wallet || null;
}

function aliasesOf(row) {
  const out = [];
  for (const value of [row?.task_id, row?.payment_ref, row?.row_hash, row?.book_chain?.row_hash]) {
    const id = text(value);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * A claimant matches the subject when it names the same handle or wallet.
 * A predecessor that names neither matches every claimant: the claim itself
 * is the match. A conflicting handle or wallet does not match.
 * @param {object} successor
 * @param {object} subject
 */
export function successorMatchesSubject(successor, subject) {
  const want = subjectParts(subject);
  const got = subjectParts(successor);
  if (!want.handle && !want.wallet) return true;
  const handleConflict = !!(want.handle && got.handle && got.handle !== want.handle);
  const walletConflict = !!(want.wallet && got.wallet && got.wallet !== want.wallet);
  if (handleConflict || walletConflict) return false;
  if (want.handle && got.handle === want.handle) return true;
  if (want.wallet && got.wallet === want.wallet) return true;
  return false;
}

function successorView(row) {
  const seq = Number(row?.seq);
  return {
    id: rowIdentity(row),
    seq: Number.isInteger(seq) && seq > 0 ? seq : null,
    subject: subjectLabel(row),
  };
}

function baseReport(subject, successors) {
  return {
    schema: SUPERSESSION_SCHEMA,
    successors,
    signed: false,
    subject: rowIdentity(subject),
  };
}

/**
 * Classify who supersedes `subject`. Input order is kept. Seq and time are
 * not consulted.
 * @param {object} subject
 * @param {object[]} claimants rows that already claim this subject
 */
export function reportSupersession(subject, claimants) {
  const list = Array.isArray(claimants) ? claimants.filter(Boolean) : [];
  if (list.length === 0) {
    return {
      ...baseReport(subject, []),
      status: 'none',
      authoritative: null,
    };
  }
  const matching = list.filter((row) => successorMatchesSubject(row, subject));
  const successors = list.map(successorView);
  if (matching.length === 1) {
    return {
      ...baseReport(subject, successors),
      status: 'linear',
      authoritative: rowIdentity(matching[0]),
    };
  }
  return {
    ...baseReport(subject, successors),
    status: 'forked',
    authoritative: null,
  };
}

/**
 * Index every row. The value is the report a verifier should read for that
 * row: its own supersession, or the predecessor's when this row is a
 * claimant in a fork (so the higher seq is not presented as the tip).
 * @param {object[]} rows
 * @returns {Map<string, object>}
 */
function predecessorOf(row, byAlias) {
  const target = supersessionTarget(row);
  if (!target) return null;
  return byAlias.get(target) || null;
}

export function indexSupersession(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const byAlias = new Map();
  for (const row of list) {
    for (const alias of aliasesOf(row)) {
      if (!byAlias.has(alias)) byAlias.set(alias, row);
    }
  }

  /** @type {Map<string, object>} */
  const own = new Map();
  for (const row of list) {
    const id = rowIdentity(row);
    if (!id || own.has(id)) continue;
    own.set(id, reportSupersession(row, claimantsOf(row, list)));
  }

  /** @type {Map<string, object>} */
  const surfaced = new Map();
  for (const row of list) {
    const id = rowIdentity(row);
    if (!id || surfaced.has(id)) continue;
    const mine = own.get(id) || reportSupersession(row, []);
    const pred = predecessorOf(row, byAlias);
    const predReport = pred ? own.get(rowIdentity(pred)) : null;
    surfaced.set(id, surfaceReport(mine, predReport));
  }
  return surfaced;
}

function surfaceReport(mine, predReport) {
  if (mine.status === 'forked') {
    return predReport ? { ...mine, of_predecessor: predReport } : mine;
  }
  if (predReport?.status === 'forked') return { ...predReport };
  if (mine.status === 'linear') {
    return predReport ? { ...mine, of_predecessor: predReport } : mine;
  }
  if (predReport?.status === 'linear') return { ...predReport };
  return mine;
}

/**
 * Report for one row inside a book. Same rules as {@link indexSupersession}.
 * @param {object} row
 * @param {object[]} rows
 */
export function supersessionForRow(row, rows) {
  if (!row) {
    return {
      schema: SUPERSESSION_SCHEMA,
      status: 'none',
      successors: [],
      authoritative: null,
      signed: false,
      subject: null,
    };
  }
  const index = indexSupersession(rows);
  const id = rowIdentity(row);
  return index.get(id) || reportSupersession(row, []);
}

/**
 * Claimants of one row, in input order. A successor is not a claimant of itself.
 * @param {object} subject
 * @param {object[]} rows
 */
function claimantsOf(subject, rows) {
  const aliases = aliasesOf(subject);
  const self = rowIdentity(subject);
  const out = [];
  for (const other of rows) {
    if (other === subject) continue;
    if (self && rowIdentity(other) === self) continue;
    const claimed = supersessionTarget(other);
    if (claimed && aliases.includes(claimed)) out.push(other);
  }
  return out;
}

/**
 * Book-level rollup. `status` is `forked` when any subject has a fork.
 * There is no book-level tip: `authoritative` stays null here even when
 * each subject is linear.
 * @param {object[]} rows
 */
export function summarizeSupersession(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const seen = new Set();
  const forks = [];
  let linear = false;
  for (const row of list) {
    const id = rowIdentity(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const report = reportSupersession(row, claimantsOf(row, list));
    if (report.status === 'forked') forks.push(report);
    else if (report.status === 'linear') linear = true;
  }
  return {
    schema: SUPERSESSION_SCHEMA,
    status: forks.length > 0 ? 'forked' : (linear ? 'linear' : 'none'),
    authoritative: null,
    forks,
    signed: false,
  };
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** HTML block for the public verify page. */
export function renderSupersessionSection(report) {
  if (!report || !report.status) return '';
  const status = report.status === 'forked'
    ? '<span class="badge bad">FORKED</span>'
    : (report.status === 'linear'
      ? '<span class="badge ok">linear</span>'
      : '<span class="muted">none</span>');
  const successors = Array.isArray(report.successors) && report.successors.length
    ? report.successors.map((item) => {
      const seq = item?.seq != null ? ` <span class="muted">seq ${esc(item.seq)}</span>` : '';
      return `<code>${esc(item?.id)}</code>${seq}`;
    }).join(', ')
    : '—';
  const authoritative = report.authoritative
    ? `<code>${esc(report.authoritative)}</code>`
    : '—';
  return `<section class="card">
      <h2>Supersession <span class="scope">${esc(report.schema || SUPERSESSION_SCHEMA)}</span></h2>
      <div class="row"><span class="k">Status</span><span class="v">${status}</span></div>
      <div class="row"><span class="k">Authoritative</span><span class="v">${authoritative}</span></div>
      <div class="row"><span class="k">Successors</span><span class="v">${successors}</span></div>
      <p class="muted" style="margin:8px 0 0;font-size:12px">Unsigned. Derived from the book at read time. Authority is set only when exactly one successor matches the subject. A fork stays FORKED — seq and time do not pick a tip. A gapless book seq does not hide it.</p>
    </section>`;
}
