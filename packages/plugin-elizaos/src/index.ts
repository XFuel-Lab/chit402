import { ModelType, type Plugin } from './eliza-types.js';
import { resolveConfig } from './config.js';
import { handleChitText } from './models.js';
import { chitBookProvider } from './provider.js';
import { getRuntimeState } from './state.js';

export const chit402Plugin: Plugin = {
  name: 'chit402',
  description:
    'Chit402 — signed spend receipts (verify_url + book), not a generic x402 payer. Routes TEXT_SMALL/TEXT_LARGE through api.chit402.com.',
  priority: 100,
  config: {
    CHIT_API_URL: process.env.CHIT_API_URL ?? process.env.XFUEL_API_URL,
    CHIT_API_KEY: process.env.CHIT_API_KEY ?? process.env.XFUEL_API_KEY,
    CHIT_SMALL_MODEL: process.env.CHIT_SMALL_MODEL ?? process.env.XFUEL_SMALL_MODEL,
    CHIT_LARGE_MODEL: process.env.CHIT_LARGE_MODEL ?? process.env.XFUEL_LARGE_MODEL,
    CHIT_PAYER_PK: process.env.CHIT_PAYER_PK ?? process.env.XFUEL_PAYER_PK,
    CHIT_SENDER: process.env.CHIT_SENDER ?? process.env.XFUEL_SENDER,
    CHIT_NETWORK: process.env.CHIT_NETWORK ?? process.env.XFUEL_NETWORK ?? 'base',
    CHIT_AGENT_ID: process.env.CHIT_AGENT_ID ?? process.env.XFUEL_AGENT_ID,
    CHIT_BOOK_SESSION: process.env.CHIT_BOOK_SESSION ?? process.env.XFUEL_BOOK_SESSION,
    CHIT_BOOK_LIMIT: process.env.CHIT_BOOK_LIMIT ?? process.env.XFUEL_BOOK_LIMIT,
    CHIT_MAX_USD_PER_CALL: process.env.CHIT_MAX_USD_PER_CALL ?? process.env.XFUEL_MAX_USD_PER_CALL,
    CHIT_MAX_USD_SESSION: process.env.CHIT_MAX_USD_SESSION ?? process.env.XFUEL_MAX_USD_SESSION,
  },
  async init(_config, runtime) {
    const settings = resolveConfig(runtime);
    await getRuntimeState(runtime);
    const mode = settings.payerPk ? 'paid (EIP-3009)' : 'demo (/v1 chat-completions)';
    runtime.logger?.success?.(
      `[chit402] initialized api=${settings.apiUrl} mode=${mode} small=${settings.smallModel} large=${settings.largeModel}`,
    );
  },
  providers: [chitBookProvider],
  models: {
    [ModelType.TEXT_SMALL]: async (runtime, params) =>
      handleChitText(runtime, params, 'small'),
    [ModelType.TEXT_LARGE]: async (runtime, params) =>
      handleChitText(runtime, params, 'large'),
  },
};

export default chit402Plugin;

export { resolveConfig } from './config.js';
export { handleChitText, buildMessages } from './models.js';
export { chitBookProvider } from './provider.js';
export {
  formatCachedBook,
  formatRemoteBook,
  pushReceipt,
  receiptFromChatXfuel,
  receiptFromTaskStatus,
  usdcMicroToUsd,
} from './receipts.js';
export {
  enforceSpendCaps,
  getRuntimeState,
  peekRuntimeState,
  recordReceiptSpend,
  resetRuntimeState,
  setRuntimeState,
} from './state.js';
export type { CachedReceipt, ChitPluginConfig, RuntimeState } from './types.js';
