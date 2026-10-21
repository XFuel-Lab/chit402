/**
 * verify_receipt MCP tool: the chit402-verify CLI verdict for one receipt.
 *
 * The receipt is fetched only from the issuer host. Any other verify_url host,
 * a redirect, credentials in the URL, an IP literal, a port, or a non-https
 * URL is refused before any request. The answer is the CLI's three-way
 * verdict: VERIFIED (exit 0), INVALID (exit 1), COULD_NOT_CHECK (exit 2).
 */
import { checkReceiptInput } from 'chit402-verify/check-input';
import type { XFuelClient } from 'xfuel-sdk';
import type { McpConfig } from './config.js';
import { ok, fail, describeError } from './format.js';

export interface VerifyReceiptArgs {
  task_id?: string;
  verify_url?: string;
}

/**
 * Hosts that serve issuer receipts. `api.xfuel.app` is an alias of the same
 * gateway; a URL on it is fetched from the canonical host, which is the one
 * the verifier trusts for the signed log and issuer history.
 */
export const ISSUER_RECEIPT_HOSTS = ['api.chit402.com', 'api.xfuel.app'] as const;
export const CANONICAL_ISSUER_ORIGIN = 'https://api.chit402.com';

/** Receipt ids the gateway issues. No path separators, dots, or escapes. */
const RECEIPT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type VerifyResultLabel = 'VERIFIED' | 'INVALID' | 'COULD_NOT_CHECK';

export type ReceiptTarget =
  | { ok: true; id: string; url: string }
  | { ok: false; reason: string };

/**
 * Turn task_id or verify_url into the one URL this tool will fetch:
 * `https://api.chit402.com/receipt/<id>`. Never throws.
 */
export function receiptTarget(args: VerifyReceiptArgs): ReceiptTarget {
  if (args.task_id != null && args.task_id !== '') {
    const id = String(args.task_id);
    if (!RECEIPT_ID.test(id)) return { ok: false, reason: 'task_id is not a receipt id' };
    return { ok: true, id, url: `${CANONICAL_ISSUER_ORIGIN}/receipt/${id}` };
  }
  if (args.verify_url == null || args.verify_url === '') {
    return { ok: false, reason: 'verify_receipt requires task_id or verify_url' };
  }
  const raw = String(args.verify_url);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'verify_url is not a URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'verify_url must be https' };
  if (url.username || url.password) return { ok: false, reason: 'verify_url must not carry credentials' };
  if (url.port !== '') return { ok: false, reason: 'verify_url must not name a port' };
  const host = url.hostname.toLowerCase();
  if (!(ISSUER_RECEIPT_HOSTS as readonly string[]).includes(host)) {
    return { ok: false, reason: 'verify_url host is not an issuer host' };
  }
  const match = /^\/receipt\/([^/]+?)(?:\.json)?\/?$/.exec(url.pathname);
  if (!match || !RECEIPT_ID.test(match[1])) {
    return { ok: false, reason: 'verify_url is not a receipt URL' };
  }
  const id = match[1];
  return { ok: true, id, url: `${CANONICAL_ISSUER_ORIGIN}/receipt/${id}` };
}

function label(exitCode: number): VerifyResultLabel {
  if (exitCode === 0) return 'VERIFIED';
  if (exitCode === 1) return 'INVALID';
  return 'COULD_NOT_CHECK';
}

export async function runVerifyReceipt(
  _client: XFuelClient,
  _config: McpConfig,
  args: VerifyReceiptArgs,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  const target = receiptTarget(args);
  if (!target.ok) return fail(target.reason);
  try {
    // publicInput: fetch only from the verifier's trusted host, no redirects,
    // no files or stdin. The CLI's own path and verdict mapping.
    const outcome = await checkReceiptInput(target.url, { publicInput: true });
    const verdict = outcome.verdict;
    const exit_code = outcome.report === 'stderr' ? 1 : verdict.exit_code;
    const reason = outcome.report === 'stderr' ? (outcome.reason || 'unreadable') : verdict.reason;
    const result = label(exit_code);
    const structured: Record<string, unknown> = {
      result,
      exit_code,
      reason,
      message: outcome.report === 'stderr' ? (outcome.message || verdict.message) : verdict.message,
      scope: verdict.result === 'verified_public' ? 'public' : (exit_code === 0 ? 'full' : null),
      receipt_id: verdict.receipt_id,
      task_id: target.id,
      verify_url: `${CANONICAL_ISSUER_ORIGIN}/receipt/${target.id}`,
      checks: verdict.checks,
      verifier: verdict.verifier,
    };
    const summary =
      `verify_receipt(${target.id}): ${result} (exit ${exit_code})` +
      (reason ? `, reason ${reason}` : '') +
      (verdict.result === 'verified_public' ? ', public scope: amount, payee, tx, log position; payer not claimed' : '');
    return ok(structured, summary);
  } catch (err) {
    return fail(describeError(err));
  }
}
