import {
  runPublicSpendAudit as runPublicSpendAuditJs,
  probeAgentBook as probeAgentBookJs,
} from './spendAuditFetch.mjs';
import {
  SAMPLE_BASE_ADDRESS,
  SPONSORED_FEE_CAPTION as sponsoredFeeCaption,
  auditQueryChip as auditQueryChipJs,
  parseAuditQuery as parseAuditQueryJs,
  shouldRunAuditFetch as shouldRunAuditFetchJs,
  reportToCsv as reportToCsvJs,
  reportToJson as reportToJsonJs,
} from './spendAuditCore.mjs';

export { SAMPLE_BASE_ADDRESS };
export const SPONSORED_FEE_CAPTION = sponsoredFeeCaption as string;

export function parseAuditQuery(raw: string): {
  kind: string;
  address?: string;
  agentId?: string;
  reason?: string;
} {
  return parseAuditQueryJs(raw);
}

export function auditQueryChip(raw: string): string {
  return auditQueryChipJs(raw);
}

export function shouldRunAuditFetch(input: { kind?: string; query?: string; armed?: string | null }): boolean {
  return shouldRunAuditFetchJs(input);
}

export type AuditQueryKind = 'base' | 'solana' | 'agent';

export type SpendClass = 'x402' | 'other' | 'undetected';

export type ReceiptMatchStatus =
  | 'receipted'
  | 'unreceipted'
  | 'unavailable'
  | 'not_checked'
  | 'receipt_mismatch';

export interface AuditTransfer {
  tx_hash: string;
  block_number: number | null;
  log_index: number | string;
  block_time: string | null;
  pay_to: string | null;
  pay_to_token_account?: string | null;
  pay_to_label: string | null;
  amount_atomic: string;
  amount_usdc: string;
  spend_class: SpendClass;
  settlement_method: 'eip3009' | 'erc20_transfer' | 'erc20_transfer_from' | 'spl_transfer' | 'spl_transfer_checked' | 'spl_transfer_checked_sponsored' | null;
  receipt_status: ReceiptMatchStatus;
  task_id: string | null;
  verify_url: string | null;
  explorer_url: string | null;
  counts_toward_total: boolean;
}

export interface AuditAnomaly {
  kind: 'spike' | 'near_duplicate';
  summary: string;
  amount_atomic: string;
  pay_to: string;
  tx_hashes: string[];
}

export interface PublicSpendAuditReport {
  schema: string;
  generated_at: string;
  query: { kind: 'base'; address: string } | { kind: 'solana'; address: string } | { kind: 'agent'; agent_id: string };
  headline: {
    status: string;
    usdc_out_atomic: string | null;
    label: string;
  };
  coverage: {
    chain: string | null;
    asset: string | null;
    rpc: string | null;
    window_blocks: number | null;
    from_block: number | null;
    to_block: number | null;
    from_time: string | null;
    to_time: string | null;
    scan_complete: boolean;
    truncated: boolean;
    failed_ranges: Array<{ from_block: number | null; to_block: number | null; error: string }>;
    receipt_api: string;
    receipts_checked: number;
    receipts_not_checked: number;
    book: string;
    caps: string;
    solana: string;
    notes: string[];
    block_unit?: string;
    window_seconds?: number;
    token_accounts?: string[];
    signatures_seen?: number;
    signatures_read?: number;
  };
  totals: {
    usdc_out_atomic: string | null;
    observed_out_atomic: string;
    observed_count: number;
    zero_value_count: number;
    by_counterparty: Array<{ pay_to: string | null; label: string | null; usdc_out_atomic: string; count: number }>;
    by_class: { x402: string; other: string; undetected: string };
  } | null;
  receipt_match: {
    receipted_atomic: string;
    unreceipted_atomic: string;
    unavailable_count: number;
    not_checked_count: number;
    mismatch_count: number;
    note: string;
  } | null;
  anomalies: AuditAnomaly[];
  transfers: AuditTransfer[];
  caps: { status: 'not_read'; note: string };
  book: { status: string; http_status: number | null; note: string } | null;
}

export type AuditRunResult =
  | { ok: true; report: PublicSpendAuditReport }
  | { ok: false; error: 'empty' | 'invalid' | 'source_unavailable'; message?: string };

export function reportToCsv(report: PublicSpendAuditReport): string {
  return reportToCsvJs(report);
}

export function reportToJson(report: PublicSpendAuditReport): string {
  return reportToJsonJs(report);
}

export function runPublicSpendAudit(
  raw: string,
  options: {
    apiHost?: string;
    rpcUrl?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
    windowBlocks?: number;
    chunkBlocks?: number;
  } = {},
): Promise<AuditRunResult> {
  return runPublicSpendAuditJs(raw, options) as Promise<AuditRunResult>;
}

export function probeAgentBook(
  apiHost: string,
  agentId: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
) {
  return probeAgentBookJs(apiHost, agentId, fetchImpl, signal);
}
