export const USDC_DECIMALS: number;

export function formatUsdc(units: string | number | bigint | null | undefined): string;
export function parseUsdcInput(input: string): string | null;
export function verifyUrlFor(taskId: string, apiHost: string): string;
export function auditorVerifyUrlFor(taskId: string, apiHost: string): string;
export function formatPayerWallet(wallet: string | null | undefined): string | null;
export function summarizePaymentRef(ref: string, rail: string): string;

export interface BurnRate {
  windowHours: number;
  spentUnits: bigint;
  perHour: string;
  perDay: string;
  rowCount: number;
}

export interface ModelMixItem {
  model: string;
  hub: string;
  amount: bigint;
  count: number;
  pct: number;
}

export interface BookEntryLike {
  task_id: string;
  payment: { ref: string; rail: string; amount: string | null };
  route?: { model?: string; hub?: string };
  collected_at: string | null;
  evidence?: string;
  event?: string;
  collected?: boolean;
  inflow_claim?: unknown;
  replay_of?: string | null;
  replay_events?: Array<{ replay_of?: string }>;
  replay_count?: number;
  idempotent_replay?: boolean;
}

export function computeBurnRate(entries: BookEntryLike[], windowHours?: number): BurnRate;
export function computeModelMix(entries: BookEntryLike[]): ModelMixItem[];
export function formatCollectedAt(iso: string | null): string;

export const BOOK_EVIDENCE: {
  COLLECTED: 'collected';
  RECORDED_BY_SETTLE: 'RECORDED_BY_SETTLE';
  ARRIVAL_UNVERIFIED: 'ARRIVAL_UNVERIFIED';
  INFLOW_CLAIMED: 'inflow_claimed';
  UNVERIFIED: 'UNVERIFIED';
  POLICY_BLOCKED: 'policy_blocked';
};

export function resolveRowEvidence(row: BookEntryLike): string;
export function evidenceLabel(evidence: string): string;
export function evidenceBadgeTone(evidence: string): string;
export function evidenceHint(evidence: string): string;
export function replayParentTaskId(row: BookEntryLike): string | null;
