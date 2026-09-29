/**
 * Types mirrored from @emdash-cms/x402 so this package does not import it.
 * Settlement follows @x402/core SettleResponse (`transaction`, `network`).
 * `tx` is accepted as an alias because some facilitators use that name.
 */

export type EmDashPrice =
  | string
  | number
  | { amount: string; asset?: string; extra?: Record<string, unknown> };

export interface EmDashEnforceOptions {
  price?: EmDashPrice;
  payTo?: string;
  network?: string;
  scheme?: string;
  description?: string;
  mimeType?: string;
}

/** Subset of @x402/core SettleResponse this stamp reads. */
export interface EmDashSettlement {
  success?: boolean;
  errorReason?: string;
  payer?: string;
  transaction?: string;
  tx?: string;
  network?: string;
  /** Atomic units actually settled, when the facilitator includes them. */
  amount?: string;
}

export interface EmDashEnforceResult {
  paid: boolean;
  skipped: boolean;
  payer?: string;
  settlement?: EmDashSettlement;
  responseHeaders: Record<string, string>;
}

export interface EmDashEnforcer {
  enforce(
    request: Request,
    options?: EmDashEnforceOptions,
  ): Promise<Response | EmDashEnforceResult>;
  applyHeaders(result: EmDashEnforceResult, response: { headers: Headers }): void;
  hasPayment(request: Request): boolean;
}

/** Shape EmDash can call later if it adds an onSettled hook. */
export interface OnSettledContext {
  request: Request;
  result: EmDashEnforceResult;
  /** Page URL or path. Defaults to the request URL without a query string. */
  resource?: string;
  /** Present when the wrapper saw the enforce() options. */
  options?: EmDashEnforceOptions;
}

export type OnSettled = (ctx: OnSettledContext) => void | Promise<void>;

export type WaitUntil = (promise: Promise<unknown>) => void;

export type ContentHashInput = string | Uint8Array;

export interface ChitEmDashConfig {
  /** Possession-gated book id from POST /v1/agents/register. */
  agentId?: string | number;
  /** Possession session. Sent as X-Xfuel-Session and in the JSON body. */
  session?: string;
  /** Book API key. Sent as X-API-Key. Demo keys cannot write the book. */
  apiKey?: string;
  /** Publisher wallet. Page options.payTo wins when set. */
  payTo?: string;
  /** CAIP-2 network used when the settlement omits one. Default eip155:8453. */
  network?: string;
  /** Dollar or atomic price used when the page omits options.price. */
  defaultPrice?: EmDashPrice;
  /** Gateway origin. Default https://api.chit402.com. */
  apiUrl?: string;
  /**
   * How long enforce() waits for verify_url before returning the page.
   * Default 1500. The paid page is never held longer than this.
   */
  timeoutMs?: number;
  /**
   * Hard cap on the stamp HTTP call. Default 8000, and never shorter than timeoutMs.
   * A hung ingest cannot pin the isolate past this.
   */
  hardTimeoutMs?: number;
  /**
   * Cloudflare Workers: pass `ctx.waitUntil` so the stamp can finish after the
   * response is sent. Astro on Cloudflare: `(p) => Astro.locals.runtime?.ctx?.waitUntil?.(p)`.
   */
  waitUntil?: WaitUntil;
  /**
   * Optional sha256 of the page (64 hex, 0x-prefixed, or sha256: prefixed),
   * or raw page bytes/text to hash, or a function of the settled read.
   */
  contentHash?:
    | ContentHashInput
    | ((ctx: OnSettledContext) => ContentHashInput | undefined | Promise<ContentHashInput | undefined>);
  /**
   * Extra hook with the future EmDash onSettled shape. Invoked after a paid
   * read, in addition to the stamp. Errors are logged.
   */
  onSettled?: OnSettled;
  /** Override console.warn. */
  log?: (message: string) => void;
  /** Override global fetch (tests). */
  fetch?: typeof fetch;
}
