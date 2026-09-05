/**
 * Promote receipt fields to the top level of MCP structuredContent.
 *
 * MCP clients often read flat JSON; the Chit402 API nests task_id + verify_url
 * under `xfuel` on chat completions. Every tool that yields a receipt should
 * pass through here so verify_url is never stripped from structuredContent.
 */

export interface ReceiptLike {
  task_id?: string;
  verify_url?: string;
  xfuel?: {
    task_id?: string;
    verify_url?: string;
  };
}

/** Public receipt page for a task when the server omits verify_url. */
export function receiptUrlFor(apiUrl: string, taskId: string): string {
  return `${apiUrl.replace(/\/$/, '')}/receipt/${taskId}`;
}

/** Resolve verify_url from payload fields or construct from task_id + apiUrl. */
export function verifyUrlOf(res: ReceiptLike, apiUrl: string): string {
  if (res.verify_url) return res.verify_url;
  const nested = res.xfuel?.verify_url;
  if (nested) return nested;
  const taskId = res.task_id ?? res.xfuel?.task_id;
  return taskId ? receiptUrlFor(apiUrl, taskId) : '';
}

/**
 * Return a shallow copy with top-level `task_id` and `verify_url` when known.
 * Does not remove nested `xfuel` — callers keep the raw API shape too.
 */
export function withReceiptFields(
  payload: Record<string, unknown>,
  apiUrl: string,
): Record<string, unknown> {
  const like = payload as ReceiptLike;
  const task_id = like.task_id ?? like.xfuel?.task_id;
  const verify_url = verifyUrlOf(like, apiUrl) || undefined;
  return {
    ...payload,
    ...(task_id ? { task_id } : {}),
    ...(verify_url ? { verify_url } : {}),
  };
}
