import type { XFuelClient, X402Payer } from 'xfuel-sdk';

/** One collected Chit402 receipt cached on the runtime for CHIT_BOOK fallback. */
export interface CachedReceipt {
  task_id: string;
  verify_url: string;
  model?: string;
  hub?: string;
  /** USDC gross amount in smallest units (6 decimals). */
  gross_amount?: string;
  payment_ref?: string | null;
  rail?: string;
  collected_at: number;
}

export interface ChitPluginConfig {
  apiUrl: string;
  apiKey: string;
  smallModel: string;
  largeModel: string;
  network: 'base' | 'base-sepolia' | 'solana';
  sender: string;
  payerPk?: string;
  agentId?: number;
  bookSession?: string;
  bookLimit: number;
  maxUsdPerCall?: number;
  maxUsdSession?: number;
}

export interface RuntimeState {
  config: ChitPluginConfig;
  client: XFuelClient;
  payer?: X402Payer;
  sender: string;
  receipts: CachedReceipt[];
  sessionSpendUsd: number;
}
