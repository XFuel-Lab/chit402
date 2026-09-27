export function formatAtomicUsdc(amount: string | number | bigint | null | undefined): string | null;
export function allowVerifyLink(url: string | null | undefined): string | null;
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
