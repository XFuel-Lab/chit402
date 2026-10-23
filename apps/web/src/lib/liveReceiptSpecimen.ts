/** Live collected receipt used in marketing specimens (Bankr-class Base agent door). */
export const LIVE_RECEIPT_TASK_ID = 'xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15';

export const LIVE_RECEIPT_VERIFY_URL = `https://api.chit402.com/receipt/${LIVE_RECEIPT_TASK_ID}`;

/**
 * issued_at on the public receipt shell. That shell has no collected_at.
 * Hub, model, and payer are not on the shell.
 */
export const LIVE_RECEIPT_COLLECTED_AT = '2026-10-19T02:23:00.000Z';

/** payment_tx on the public shell. Chain is base. */
export const LIVE_RECEIPT_PAYMENT_TX = '0x731e4fdc70a8dba370c579c23e8520d2edcde052f28abaf3ed26c95c8603116f';

/** 6+4 cut, same as the public page and the previous specimen wallet. */
export const LIVE_RECEIPT_PAYMENT_REF = `base:${LIVE_RECEIPT_PAYMENT_TX.slice(0, 6)}…${LIVE_RECEIPT_PAYMENT_TX.slice(-4)}`;

/** Gross USDC (6 dp atomic string) — matches public receipt page title. */
export const LIVE_RECEIPT_AMOUNT_ATOMIC = '2000';

export const LIVE_RECEIPT_AMOUNT_DISPLAY = '$0.002';
