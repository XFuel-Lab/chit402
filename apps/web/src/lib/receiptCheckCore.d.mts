export function receiptCheckBody(input: string): { input: string };

export type ReceiptCheckView = {
  overall: string;
  lines: string[];
  error: string | null;
};

export function receiptCheckView(status: number, payload: unknown): ReceiptCheckView;
