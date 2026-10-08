/**
 * Leaf input for `task_id|row_hash`.
 * Same order as verifyAnchoredRoot: top-level row_hash, then book_chain, then
 * the inclusion or carry document. One source is enough. Two or three that
 * differ fail closed. The value used for the leaf is the one they agree on.
 * No string at all is `row: null`. An empty string is a present source.
 */
export function boundRowHash(
  receipt: { row_hash?: string | null; book_chain?: { row_hash?: string | null } | null },
  extra?: { row_hash?: string | null } | null,
): { ok: true; row: string | null } | { ok: false; reason: 'row_hash_mismatch' } {
  const present: string[] = [];
  if (typeof receipt.row_hash === 'string') present.push(receipt.row_hash);
  if (typeof receipt.book_chain?.row_hash === 'string') present.push(receipt.book_chain.row_hash);
  if (typeof extra?.row_hash === 'string') present.push(extra.row_hash);
  if (present.length === 0) return { ok: true, row: null };
  const agreed = present[0];
  if (present.some((value) => value !== agreed)) return { ok: false, reason: 'row_hash_mismatch' };
  return { ok: true, row: agreed };
}
