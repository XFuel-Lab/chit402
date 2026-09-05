import type { IAgentRuntime } from './eliza-types.js';
import type { ChitPluginConfig } from './types.js';

const DEFAULT_API_URL = 'https://api.chit402.com';
const DEFAULT_API_KEY = 'chit402-demo';
const DEFAULT_MODEL = 'xfuel/auto';

function readString(
  runtime: IAgentRuntime,
  keys: string[],
  envFallback?: string,
): string | undefined {
  for (const key of keys) {
    const fromRuntime = runtime.getSetting(key);
    if (typeof fromRuntime === 'string' && fromRuntime.trim()) {
      return fromRuntime.trim();
    }
    const fromEnv = process.env[key];
    if (typeof fromEnv === 'string' && fromEnv.trim()) {
      return fromEnv.trim();
    }
  }
  return envFallback;
}

function readUsdCap(
  runtime: IAgentRuntime,
  keys: string[],
): number | undefined {
  const raw = readString(runtime, keys);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function readPositiveInt(
  runtime: IAgentRuntime,
  keys: string[],
  fallback: number,
): number {
  const raw = readString(runtime, keys);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Resolve plugin settings from character JSON + env (CHIT_* with XFUEL_* wire aliases). */
export function resolveConfig(runtime: IAgentRuntime): ChitPluginConfig {
  const apiUrl =
    readString(runtime, ['CHIT_API_URL', 'XFUEL_API_URL'], DEFAULT_API_URL) ??
    DEFAULT_API_URL;
  const apiKey =
    readString(runtime, ['CHIT_API_KEY', 'XFUEL_API_KEY'], DEFAULT_API_KEY) ??
    DEFAULT_API_KEY;
  const smallModel =
    readString(runtime, ['CHIT_SMALL_MODEL', 'XFUEL_SMALL_MODEL', 'SMALL_MODEL'], DEFAULT_MODEL) ??
    DEFAULT_MODEL;
  const largeModel =
    readString(runtime, ['CHIT_LARGE_MODEL', 'XFUEL_LARGE_MODEL', 'LARGE_MODEL'], DEFAULT_MODEL) ??
    DEFAULT_MODEL;
  const networkRaw =
    readString(runtime, ['CHIT_NETWORK', 'XFUEL_NETWORK'], 'base') ?? 'base';
  const network =
    networkRaw === 'base-sepolia' || networkRaw === 'solana' || networkRaw === 'base'
      ? networkRaw
      : 'base';
  const sender =
    readString(runtime, ['CHIT_SENDER', 'XFUEL_SENDER'], '0x000000000000000000000000000000000000dEaD') ??
    '0x000000000000000000000000000000000000dEaD';
  const payerPk = readString(runtime, ['CHIT_PAYER_PK', 'XFUEL_PAYER_PK']);
  const agentIdRaw = readString(runtime, ['CHIT_AGENT_ID', 'XFUEL_AGENT_ID']);
  const agentId = agentIdRaw ? Number.parseInt(agentIdRaw, 10) : undefined;
  const bookSession = readString(runtime, ['CHIT_BOOK_SESSION', 'XFUEL_BOOK_SESSION']);

  return {
    apiUrl,
    apiKey,
    smallModel,
    largeModel,
    network,
    sender,
    payerPk,
    agentId: Number.isFinite(agentId) && (agentId ?? 0) > 0 ? agentId : undefined,
    bookSession,
    bookLimit: readPositiveInt(runtime, ['CHIT_BOOK_LIMIT', 'XFUEL_BOOK_LIMIT'], 10),
    maxUsdPerCall: readUsdCap(runtime, ['CHIT_MAX_USD_PER_CALL', 'XFUEL_MAX_USD_PER_CALL']),
    maxUsdSession: readUsdCap(runtime, ['CHIT_MAX_USD_SESSION', 'XFUEL_MAX_USD_SESSION']),
  };
}
