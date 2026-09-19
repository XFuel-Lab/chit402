import type { BookEntry } from './agentBook';
import {
  LIVE_RECEIPT_AMOUNT_ATOMIC,
  LIVE_RECEIPT_HUB,
  LIVE_RECEIPT_MODEL,
  LIVE_RECEIPT_TASK_ID,
} from './liveReceiptSpecimen';

export const BOOK_SPECIMEN_BANNER = 'Specimen — not live money';

/** Static last-N rows for first paint on /book — only row 0 is a live verify link. */
export const BOOK_SPECIMEN_ENTRIES: BookEntry[] = [
  {
    task_id: LIVE_RECEIPT_TASK_ID,
    evidence: 'collected',
    collected_at: '2026-09-05T18:14:09.000Z',
    route: { hub: LIVE_RECEIPT_HUB, model: LIVE_RECEIPT_MODEL },
    payment: {
      rail: 'usdc',
      ref: 'base:0xf63e…83f6f',
      amount: LIVE_RECEIPT_AMOUNT_ATOMIC,
    },
    payer_wallet: '0x2536…e499',
    collected: true,
  },
  {
    task_id: 'chit-specimen-02-policy-block',
    evidence: 'policy_blocked',
    event: 'policy_blocked',
    collected_at: '2026-09-04T09:22:00.000Z',
    route: { hub: 'openrouter', model: 'anthropic/claude-sonnet-4' },
    payment: { rail: 'usdc', ref: '—', amount: null },
    reason: 'daily_cap',
    policy_key: 'daily_cap',
  },
  {
    task_id: 'chit-specimen-03-inflow',
    evidence: 'inflow_claimed',
    collected_at: '2026-09-03T16:05:00.000Z',
    route: { hub: 'foreign-x402', model: 'gpt-4.1-mini' },
    payment: { rail: 'usdc', ref: 'patron grant', amount: '1250000' },
    bucket: 'patron',
  },
];

export const BOOK_SPECIMEN_STATS = {
  agentLabel: 'agent 42 (specimen)',
  cap: '50000000',
  spent: '4820000',
  remaining: '45180000',
  window: 'last 50 collected rows',
  rowCount: BOOK_SPECIMEN_ENTRIES.length,
};
