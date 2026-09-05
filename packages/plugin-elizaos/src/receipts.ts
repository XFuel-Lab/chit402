import type { Receipt, TaskStatusResponse } from 'xfuel-sdk';
import type { CachedReceipt } from './types.js';

const MAX_CACHED_RECEIPTS = 200;

export function usdcMicroToUsd(micro: string | number | undefined): number {
  if (micro === undefined || micro === null || micro === '') return 0;
  const n = Number(micro);
  return Number.isFinite(n) ? n / 1_000_000 : 0;
}

export function receiptFromChatXfuel(
  xfuel: Receipt | undefined,
  model: string,
  apiUrl: string,
): CachedReceipt | null {
  if (!xfuel?.task_id) return null;
  const verify_url =
    xfuel.verify_url ??
    `${apiUrl.replace(/\/$/, '')}/receipt/${xfuel.task_id}`;
  const route = xfuel.route as { model?: string; provider?: string } | undefined;
  return {
    task_id: xfuel.task_id,
    verify_url,
    model: route?.model ?? model,
    hub: route?.provider,
    gross_amount: xfuel.payment?.gross_amount,
    payment_ref: xfuel.payment?.ref ?? null,
    rail: xfuel.payment?.rail,
    collected_at: Date.now(),
  };
}

export function receiptFromTaskStatus(
  settled: TaskStatusResponse,
  model: string,
  apiUrl: string,
): CachedReceipt {
  const verify_url =
    settled.verify_url ??
    `${apiUrl.replace(/\/$/, '')}/receipt/${settled.task_id}`;
  return {
    task_id: settled.task_id,
    verify_url,
    model: settled.result?.model ?? model,
    hub: settled.result?.provider,
    gross_amount: settled.gross_amount,
    payment_ref: settled.payment_ref ?? null,
    rail: settled.payment_rail,
    collected_at: Date.now(),
  };
}

/** Append a receipt to the runtime cache (newest first, capped). */
export function pushReceipt(
  receipts: CachedReceipt[],
  receipt: CachedReceipt,
): CachedReceipt[] {
  const next = [receipt, ...receipts.filter((r) => r.task_id !== receipt.task_id)];
  return next.slice(0, MAX_CACHED_RECEIPTS);
}

/** Human-readable spend summary for CHIT_BOOK provider fallback. */
export function formatCachedBook(receipts: CachedReceipt[], limit: number): string {
  if (receipts.length === 0) {
    return 'Chit402 book: no collected receipts yet on this runtime.';
  }
  const rows = receipts.slice(0, limit);
  const lines = rows.map((r) => {
    const usd = usdcMicroToUsd(r.gross_amount);
    const amount = usd > 0 ? `$${usd.toFixed(4)}` : '(unmetered)';
    const hub = r.hub ? ` hub=${r.hub}` : '';
    return `- ${r.task_id} | ${r.model ?? 'unknown'}${hub} | ${amount} | ${r.verify_url}`;
  });
  const totalUsd = receipts.reduce((sum, r) => sum + usdcMicroToUsd(r.gross_amount), 0);
  const header = `Chit402 spend book (last ${rows.length} cached receipts):`;
  const footer =
    totalUsd > 0
      ? `Cached session total: $${totalUsd.toFixed(4)} (${receipts.length} receipt${receipts.length === 1 ? '' : 's'}).`
      : `Cached receipts: ${receipts.length}.`;
  return [header, ...lines, footer].join('\n');
}

/** Format possession-gated book API JSON for prompt injection. */
export function formatRemoteBook(data: Record<string, unknown>, limit: number): string {
  const rows = Array.isArray(data.rows) ? data.rows.slice(0, limit) : [];
  const totals = data.totals as { count?: number; usdc_sum?: string } | undefined;
  const budget = data.budget as { cap?: string; spent?: string; remaining?: string } | undefined;
  const lines: string[] = ['Chit402 possession-gated spend book:'];
  if (budget) {
    lines.push(
      `Budget cap=${budget.cap ?? '?'} spent=${budget.spent ?? '?'} remaining=${budget.remaining ?? '?'}`,
    );
  }
  if (totals) {
    lines.push(`Totals: count=${totals.count ?? 0} usdc_sum=${totals.usdc_sum ?? '0'}`);
  }
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const taskId = String(r.task_id ?? r.taskId ?? '?');
    const verify = String(r.verify_url ?? r.verifyUrl ?? '');
    const model = String((r.route as { model?: string } | undefined)?.model ?? r.model ?? '?');
    const amount = String((r.payment as { gross_amount?: string } | undefined)?.gross_amount ?? r.amount ?? '?');
    lines.push(`- ${taskId} | ${model} | ${amount} micro-USDC | ${verify}`);
  }
  if (rows.length === 0) {
    lines.push('(no collected rows yet)');
  }
  return lines.join('\n');
}
