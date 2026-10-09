export const BASE_RPC_URL: string;
export const BASE_USDC: string;
export const ERC20_TRANSFER_TOPIC: string;
export const CHIT_FEE_SINK: string;
export const EIP3009_TRANSFER_WITH_AUTHORIZATION: string;
export const ERC20_TRANSFER_SELECTOR: string;
export const ERC20_TRANSFER_FROM_SELECTOR: string;
export const AUDIT_WINDOW_BLOCKS: number;
export const AUDIT_CHUNK_BLOCKS: number;
export const AUDIT_CHUNK_FLOOR: number;
export const AUDIT_RPC_CONCURRENCY: number;
export const AUDIT_RPC_MIN_GAP_MS: number;
export const AUDIT_MAX_LOG_CALLS: number;

export function planLogRanges(fromBlock: number, toBlock: number, chunkBlocks: number): Array<[number, number]>;
export function isLogRangeLimitError(err: unknown): boolean;
export function statedLogRangeLimit(err: unknown): number | null;
export function shrinkLogRange(
  start: number,
  end: number,
  options?: { floor?: number; statedLimit?: number | null },
): Array<[number, number]> | null;
export const MAX_INCLUDED_TRANSFERS: number;
export const MAX_RECEIPT_LOOKUPS: number;
export const MAX_TX_READS: number;
export const PUBLIC_AUDIT_SCHEMA: string;
export const SAMPLE_BASE_ADDRESS: string;

export type AuditQuery =
  | { kind: 'empty' }
  | { kind: 'invalid'; reason?: string }
  | { kind: 'base'; address: string }
  | { kind: 'solana'; address: string }
  | { kind: 'agent'; agentId: string };

export function parseAuditQuery(raw: string): AuditQuery;
export function auditQueryChip(raw: string): string;
export function auditQueryMessage(query: AuditQuery): string;
export function shouldRunAuditFetch(input: { kind?: string; query?: string; armed?: string | null }): boolean;
export const SPONSORED_FEE_CAPTION: string;
export function addressTopic(address: string): string | null;
export function counterpartyLabel(address: string): string | null;

export interface DecodedTransfer {
  tx_hash: string;
  block_number: number;
  log_index: number;
  block_time: string | null;
  from: string;
  pay_to: string;
  amount_atomic: string;
}

export function decodeUsdcTransferLog(log: {
  topics?: string[];
  data?: string;
  blockNumber?: string | number;
  blockTimestamp?: string | number;
  logIndex?: string | number;
  transactionHash?: string;
}): DecodedTransfer | null;

export function selectorOf(txInput: string | null | undefined): string | null;
export function settlementMethodOf(txInput: string | null | undefined): 'eip3009' | 'erc20_transfer' | 'erc20_transfer_from' | null;
export function classifySpend(input: {
  receipt?: { status?: string; task_id?: string; schema?: string; rail?: string; matched?: boolean } | null;
  txInput?: string | null;
  settlementMethod?: string | null;
}): 'x402' | 'other' | 'undetected';

export function findAnomalies(rows: Array<{
  tx_hash: string;
  block_number: number;
  log_index: number;
  block_time: string | null;
  pay_to: string;
  amount_atomic: string;
}>): Array<{
  kind: 'spike' | 'near_duplicate';
  summary: string;
  amount_atomic: string;
  pay_to: string;
  tx_hashes: string[];
}>;

export function buildSpendAuditReport(input: {
  query: AuditQuery;
  generatedAt?: string;
  chain?: {
    logs?: unknown[];
    failedRanges?: Array<{ from_block: number | null; to_block: number | null; error: string }>;
    fromBlock?: number | null;
    toBlock?: number | null;
    fromTime?: string | null;
    toTime?: string | null;
    scanComplete?: boolean;
  } | null;
  receipts?: Map<string, Record<string, unknown>>;
  txInputs?: Map<string, string | null>;
  book?: { status?: string; httpStatus?: number | null } | null;
  rpcUrl?: string;
  windowBlocks?: number;
}): Record<string, unknown>;

export function reportToJson(report: unknown): string;
export function reportToCsv(report: unknown): string;
