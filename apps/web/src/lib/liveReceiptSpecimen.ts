/** Live collected receipt used in marketing specimens (Bankr-class Base agent door). */
export const LIVE_RECEIPT_TASK_ID = 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96';

export const LIVE_RECEIPT_VERIFY_URL = `https://api.chit402.com/receipt/${LIVE_RECEIPT_TASK_ID}`;

export const LIVE_RECEIPT_HUB = 'akash-network';

export const LIVE_RECEIPT_MODEL = 'akash/meta-llama/Llama-3.3-70B-Instruct';

/** Gross USDC (6 dp atomic string) — matches public receipt page title. */
export const LIVE_RECEIPT_AMOUNT_ATOMIC = '2000';

export const LIVE_RECEIPT_AMOUNT_DISPLAY = '$0.002';
