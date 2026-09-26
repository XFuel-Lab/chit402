export function formatAtomicUsdc(amount: string | number | bigint | null | undefined): string | null;
export function allowVerifyLink(url: string | null | undefined): string | null;
export function outcomeLabel(outcome: string | null | undefined): string | null;

export interface BoardCardLink {
  rel: string;
  href: string;
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
}

export function boardCardModel(post: object | null | undefined): BoardCard | null;
