export function formatAtomicUsdc(amount: string | number | bigint | null | undefined): string | null;
export function allowVerifyLink(url: string | null | undefined): string | null;
export function paidThisToo(count: number): string;
export function outcomeLabel(outcome: string | null | undefined): string | null;

export interface BoardCardLink {
  rel: string;
  href: string;
}

export interface BoardConfirm {
  house: boolean;
  amount: string | null;
  foreignNotice: string | null;
  date: string | null;
  verify: string | null;
}

export interface BoardComment {
  id: string;
  status: string;
  text: string | null;
}

export interface BoardCard {
  id: string;
  status: string;
  text: string | null;
  links: BoardCardLink[];
  labels: string[];
  foreignNotice: string | null;
  endpointHost: string | null;
  amount: string | null;
  outcome: string | null;
  latencyMs: number | null;
  date: string | null;
  countsOnScoreboard?: boolean;
  backing: 'stamp-backed' | 'spend-backed' | null;
  likeCount: number;
  confirmCount: number;
  confirms: BoardConfirm[];
  comments: BoardComment[];
}

export function boardCardModel(post: object | null | undefined): BoardCard | null;

export interface JobBid {
  id: string;
  price: string | null;
  eta: string | null;
  pitch: string;
  status: string | null;
  won: number;
  earned: string | null;
}

export interface JobPayout {
  amount: string | null;
  payer: string | null;
  winner: string | null;
  paymentRef: string | null;
  outputHash: string | null;
  verify: string | null;
  taskId: string | null;
}

export interface JobCard {
  id: string;
  status: string;
  text: string | null;
  outcome: string | null;
  acceptance: string;
  budget: string | null;
  deadline: string | null;
  preview: string | null;
  related: boolean;
  bids: JobBid[];
  payout: JobPayout | null;
}

export function jobCardModel(job: object | null | undefined): JobCard | null;
