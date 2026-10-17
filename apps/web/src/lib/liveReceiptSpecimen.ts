/** Live collected receipt used in marketing specimens (Bankr-class Base agent door). */
export const LIVE_RECEIPT_TASK_ID = 'xfuel-661ca345-973c-4cb6-b073-8ae0c7b37944';

export const LIVE_RECEIPT_VERIFY_URL = `https://api.chit402.com/receipt/${LIVE_RECEIPT_TASK_ID}`;

/**
 * issued_at on the public receipt shell. That shell has no collected_at.
 * Hub, model, and payer are not on the shell.
 */
export const LIVE_RECEIPT_COLLECTED_AT = '2026-10-10T00:17:00.000Z';

/** payment_tx on the public shell. Chain is base. */
export const LIVE_RECEIPT_PAYMENT_TX = '0x923bf06d920f2886d28c07202fe6b58fc30cb119169dd39e749f822ca6a0ac48';

/** 6+4 cut, same as the public page and the previous specimen wallet. */
export const LIVE_RECEIPT_PAYMENT_REF = `base:${LIVE_RECEIPT_PAYMENT_TX.slice(0, 6)}…${LIVE_RECEIPT_PAYMENT_TX.slice(-4)}`;

/** Gross USDC (6 dp atomic string) — matches public receipt page title. */
export const LIVE_RECEIPT_AMOUNT_ATOMIC = '2000';

export const LIVE_RECEIPT_AMOUNT_DISPLAY = '$0.002';
