import { XFuelClient, type X402Payer } from 'xfuel-sdk';
import type { IAgentRuntime } from './eliza-types.js';
import { resolveConfig } from './config.js';
import type { RuntimeState } from './types.js';

const runtimeStates = new WeakMap<IAgentRuntime, RuntimeState>();

async function buildPayer(payerPk: string): Promise<{ payer: X402Payer; sender: string }> {
  const { Wallet } = await import('ethers');
  const { createEip3009Payer } = await import('xfuel-sdk/onchain');
  const wallet = new Wallet(payerPk);
  return {
    payer: createEip3009Payer(wallet as never),
    sender: wallet.address,
  };
}

/** Initialize or return cached per-runtime Chit402 state. */
export async function getRuntimeState(runtime: IAgentRuntime): Promise<RuntimeState> {
  const existing = runtimeStates.get(runtime);
  if (existing) return existing;

  const config = resolveConfig(runtime);
  const client = new XFuelClient({ baseUrl: config.apiUrl, apiKey: config.apiKey });

  let payer: X402Payer | undefined;
  let sender = config.sender;
  if (config.payerPk) {
    const built = await buildPayer(config.payerPk);
    payer = built.payer;
    sender = built.sender;
  }

  const state: RuntimeState = {
    config,
    client,
    payer,
    sender,
    receipts: [],
    sessionSpendUsd: 0,
  };
  runtimeStates.set(runtime, state);
  return state;
}

/** Test hook — reset cached state for a runtime. */
export function resetRuntimeState(runtime: IAgentRuntime): void {
  runtimeStates.delete(runtime);
}

/** Test hook — read cached state without initializing network clients. */
export function peekRuntimeState(runtime: IAgentRuntime): RuntimeState | undefined {
  return runtimeStates.get(runtime);
}

/** Test hook — seed runtime state directly. */
export function setRuntimeState(runtime: IAgentRuntime, state: RuntimeState): void {
  runtimeStates.set(runtime, state);
}

export function recordReceiptSpend(state: RuntimeState, grossMicro: string | undefined): void {
  const usd = grossMicro ? Number(grossMicro) / 1_000_000 : 0;
  if (Number.isFinite(usd) && usd > 0) {
    state.sessionSpendUsd += usd;
  }
}

export async function enforceSpendCaps(state: RuntimeState, quotedMicro: string): Promise<void> {
  const callUsd = Number(quotedMicro) / 1_000_000;
  if (!Number.isFinite(callUsd)) return;

  const { maxUsdPerCall, maxUsdSession } = state.config;
  if (maxUsdPerCall !== undefined && callUsd > maxUsdPerCall) {
    throw new Error(
      `Chit402 CHIT_MAX_USD_PER_CALL exceeded: $${callUsd.toFixed(6)} > $${maxUsdPerCall}`,
    );
  }
  if (maxUsdSession !== undefined && state.sessionSpendUsd + callUsd > maxUsdSession) {
    throw new Error(
      `Chit402 CHIT_MAX_USD_SESSION exceeded: $${(state.sessionSpendUsd + callUsd).toFixed(6)} > $${maxUsdSession}`,
    );
  }
}
