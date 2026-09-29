import { stampSettledRead } from './stamp.js';
import type {
  ChitEmDashConfig,
  EmDashEnforcer,
  EmDashEnforceOptions,
  EmDashEnforceResult,
  OnSettled,
  OnSettledContext,
} from './types.js';

export {
  CHIT_RECEIPT_HEADER,
  DEFAULT_API_URL,
  DEFAULT_HARD_TIMEOUT_MS,
  DEFAULT_NETWORK,
  DEFAULT_TIMEOUT_MS,
  STAMP_FEE_UNITS,
  STAMP_FEE_USD,
  ingestUrl,
  normalizeContentHash,
  stampSettledRead,
} from './stamp.js';

export { priceToAtomicUsdc, usdDecimalToAtomic } from './price.js';

export type {
  ChitEmDashConfig,
  ContentHashInput,
  EmDashEnforcer,
  EmDashEnforceOptions,
  EmDashEnforceResult,
  EmDashPrice,
  EmDashSettlement,
  OnSettled,
  OnSettledContext,
  WaitUntil,
} from './types.js';

/**
 * Call the real enforce(). On a paid read, stamp the book and set
 * `X-Chit-Receipt` when verify_url arrives inside the timeout.
 * A 402 response and a skipped (human, botOnly) result are returned unchanged.
 */
export function withReceipts(enforcer: EmDashEnforcer, config: ChitEmDashConfig = {}): EmDashEnforcer {
  return {
    async enforce(request: Request, options?: EmDashEnforceOptions): Promise<Response | EmDashEnforceResult> {
      const out = await enforcer.enforce(request, options);
      if (out instanceof Response) return out;
      if (!out.paid || out.skipped) return out;

      const resource = pageResource(request);
      await stampSettledRead({ request, result: out, resource, options }, config);

      if (config.onSettled) {
        try {
          await config.onSettled({ request, result: out, resource, options });
        } catch (err) {
          const log = config.log ?? ((message: string) => console.warn(`[chit402-emdash] ${message}`));
          const detail = err instanceof Error ? err.message : String(err);
          log(`onSettled failed: ${detail}`);
        }
      }
      return out;
    },
    applyHeaders(result, response) {
      enforcer.applyHeaders(result, response);
    },
    hasPayment(request) {
      return enforcer.hasPayment(request);
    },
  };
}

/** Same wrapper as withReceipts. */
export const stampedEnforce = withReceipts;

/**
 * Factory for a future EmDash `onSettled` hook.
 * One line once upstream calls `(ctx) => void | Promise<void>` after settle.
 */
export function chit402OnSettled(config: ChitEmDashConfig = {}): OnSettled {
  return (ctx: OnSettledContext) => stampSettledRead(ctx, config);
}

function pageResource(request: Request): string {
  try {
    const url = new URL(request.url);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return request.url;
  }
}
