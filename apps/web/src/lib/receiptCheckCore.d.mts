export function receiptCheckBody(input: string): { input: string; client: 'web' };

export type ReceiptCheckReport = {
  result_code: string | null;
  reason: string | null;
  checks: Record<string, string> | null;
  input_kind: string | null;
  input_bytes: number | null;
  receipt_id: string | null;
  receipt_version: number | string | null;
  issuer: string | null;
  chain: string | null;
  client: 'web' | 'api';
};

export type ReceiptCheckView = {
  kind: 'verdict' | 'input-error';
  overall: string;
  lines: string[];
  error: string | null;
  hint: string | null;
  accepted: string[] | null;
  example: string | null;
  feedbackEnabled: boolean;
  requestId: string | null;
  report: ReceiptCheckReport | null;
};

export function receiptCheckView(status: number, payload: unknown): ReceiptCheckView;

export function receiptFeedbackBody(fields: {
  view: ReceiptCheckView;
  expected: string;
  intent: string;
  note: string;
  attach: boolean;
  receipt: string;
}): {
  expected: string;
  intent: string;
  note: string;
  attach_receipt: boolean;
  result_code: string | null;
  reason: string | null;
  checks: Record<string, string> | null;
  input_kind: string | null;
  input_bytes: number | null;
  receipt_id: string | null;
  receipt_version: number | string | null;
  issuer: string | null;
  chain: string | null;
  page: string;
  request_id: string | null;
  client: 'web';
  receipt?: string;
};
