export class AuditSourceError extends Error {
  code: string;
  constructor(message: string, code?: string);
}

export function scanBaseUsdcOut(address: string, options?: {
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  signal?: AbortSignal;
  windowBlocks?: number;
  chunkBlocks?: number;
  chunkFloor?: number;
  concurrency?: number;
  minGapMs?: number;
  maxLogCalls?: number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (message: string) => void;
}): Promise<{
  fromBlock: number;
  toBlock: number;
  fromTime: string | null;
  toTime: string | null;
  logs: unknown[];
  failedRanges: Array<{ from_block: number; to_block: number; error: string }>;
  scanComplete: boolean;
}>;

export function lookupReceipt(
  apiHost: string,
  txHash: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<Record<string, unknown>>;

export function probeAgentBook(
  apiHost: string,
  agentId: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<{ status: string; httpStatus?: number }>;

export function runPublicSpendAudit(raw: string, options?: {
  apiHost?: string;
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  windowBlocks?: number;
  chunkBlocks?: number;
  chunkFloor?: number;
  concurrency?: number;
  minGapMs?: number;
  maxLogCalls?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ ok: true; report: Record<string, unknown> } | { ok: false; error: string; message?: string; report?: undefined }>;
