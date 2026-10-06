/**
 * Honest empty lookup.
 *
 * When a lookup returns nothing, the response names what was asked, the
 * read instant on this clock, and that nothing was served. `bound` is
 * present only when a correcting row carries amends (supersedes, corrects,
 * amends, or a correction parent) naming that id. The bound is "filed at
 * or before" the correcting row's time. It is an upper bound, not the
 * retired row's own instant, and the cell does not claim the id is gone.
 *
 * Shape from design partner bookkeep on 1F916 post 6701, comments c93176
 * and c93673. The read instant is this response's clock. A later read
 * prints its own instant.
 */
import { supersessionTarget } from './supersession-fork.js';

export const EMPTY_LOOKUP_SCHEMA = 'chit402.empty_lookup.v1';

function text(value) {
  if (value == null) return '';
  return String(value).trim();
}

function namesOn(row) {
  const names = new Set();
  if (row?.amends != null) {
    const list = Array.isArray(row.amends) ? row.amends : [row.amends];
    for (const item of list) {
      const id = text(item);
      if (id) names.add(id);
    }
  }
  const target = supersessionTarget(row);
  if (target) names.add(target);
  return names;
}

function rowInstant(row) {
  return text(row?.collected_at)
    || text(row?.recorded_at)
    || text(row?.created_at)
    || text(row?.as_of)
    || '';
}

/**
 * Tightest "filed at or before" instant among correcting rows that name
 * `asked`. Null when none do.
 * @param {object[]|null|undefined} rows
 * @param {string} asked
 */
export function amendBoundFromRows(rows, asked) {
  const id = text(asked);
  if (!id) return null;
  let best = '';
  for (const row of rows || []) {
    if (!namesOn(row).has(id)) continue;
    const at = rowInstant(row);
    if (!at) continue;
    if (!best || at < best) best = at;
  }
  return best ? `filed at or before ${best}` : null;
}

/**
 * The cell. `bound` is omitted when no correcting row names the id.
 * @param {{ asked: string, at?: string, bound?: string|null }} input
 */
export function emptyLookup({ asked, at = null, bound = null } = {}) {
  const cell = {
    asked: text(asked) || null,
    at: text(at) || new Date().toISOString(),
    served: 'none',
  };
  if (bound) cell.bound = String(bound);
  return cell;
}

/**
 * JSON body for a lookup that served nothing. `error` stays `not_found`
 * so existing clients still branch on it. `lookup` is only the cell.
 * @param {string} asked
 * @param {object[]|null|undefined} [rows]
 * @param {string} [at]
 */
export function emptyLookupBody(asked, rows = null, at = null) {
  const bound = rows ? amendBoundFromRows(rows, asked) : null;
  return {
    error: 'not_found',
    schema: EMPTY_LOOKUP_SCHEMA,
    lookup: emptyLookup({ asked, at, bound }),
  };
}
