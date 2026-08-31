/**
 * XFuel Sidecar Middleware
 *
 * Wraps any OpenAI-compatible fetch to emit XFuel receipts.
 * The middleware intercepts responses, hashes outputs, and attaches receipts.
 *
 * Usage with OpenAI SDK:
 *   const openai = new OpenAI({ baseURL: 'https://api.openrouter.ai/api/v1', apiKey, fetch: createSidecarFetch({ ... }) });
 *
 * Usage with raw fetch:
 *   const sidecarFetch = createSidecarFetch({ ... });
 *   const res = await sidecarFetch('https://api.groq.com/v1/chat/completions', { ... });
 */

import {
  buildSidecarReceipt,
  type SidecarReceipt,
  type BuildReceiptParams,
} from './receipt.js';

export interface SidecarMiddlewareConfig {
  /** HMAC signing secret (optional — for tamper-evident receipts) */
  signingSecret?: string;
  /** XFuel API base URL for verify_url construction */
  xfuelBaseUrl?: string;
  /** Callback invoked with each receipt (for logging, ingest, etc.) */
  onReceipt?: (receipt: SidecarReceipt, request: Request, response: Response) => void | Promise<void>;
  /** Extract x402 payment info from request headers (for payment binding) */
  extractPayment?: (headers: Headers) => { ref?: string; payer?: string; payTo?: string; amount?: string } | null;
  /** Per-model pricing (optional — for estimating uncollected amounts) */
  pricing?: Record<string, { promptPrice: number; completionPrice: number }>;
}

export interface SidecarResponse extends Response {
  /** XFuel sidecar receipt for this request */
  xfuelReceipt?: SidecarReceipt;
}

/**
 * Parse the host from a URL for the receipt hub field.
 */
function extractHub(url: string | URL): string {
  try {
    const u = typeof url === 'string' ? new URL(url) : url;
    return u.host;
  } catch {
    return 'unknown';
  }
}

/**
 * Parse OpenAI-compatible chat completion response.
 */
interface ChatCompletionChoice {
  index?: number;
  message?: { role?: string; content?: string | null; tool_calls?: unknown[] };
  delta?: { role?: string; content?: string };
  finish_reason?: string | null;
}

interface ChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: ChatCompletionChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * Extract the acting output from a chat completion response.
 * This is what we hash for the output commitment.
 */
function extractOutput(data: ChatCompletionResponse): string | null {
  const choices = data.choices;
  if (!choices || choices.length === 0) return null;

  const first = choices[0];
  const message = first.message;

  if (!message) return null;

  if (message.tool_calls && message.tool_calls.length > 0) {
    return JSON.stringify({
      content: message.content || null,
      tool_calls: message.tool_calls,
    });
  }

  return message.content ?? null;
}

/**
 * Parse the x402 X-PAYMENT header.
 */
function parseX402Header(header: string | null): { ref?: string; payer?: string; amount?: string } | null {
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf8');
    const payload = JSON.parse(decoded);
    return {
      ref: payload.network && payload.tx ? `${payload.network}:${payload.tx}` : undefined,
      payer: payload.from || payload.payer,
      amount: payload.amount,
    };
  } catch {
    return null;
  }
}

/**
 * Default payment extractor — looks for X-PAYMENT header (x402 format).
 */
function defaultExtractPayment(headers: Headers): { ref?: string; payer?: string; payTo?: string; amount?: string } | null {
  const payment = headers.get('x-payment');
  return parseX402Header(payment);
}

/**
 * Create a fetch wrapper that emits XFuel receipts for OpenAI-compatible endpoints.
 */
export function createSidecarFetch(config: SidecarMiddlewareConfig = {}): typeof fetch {
  const {
    signingSecret,
    xfuelBaseUrl = 'https://api.xfuel.app',
    onReceipt,
    extractPayment = defaultExtractPayment,
    pricing = {},
  } = config;

  return async function sidecarFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<SidecarResponse> {
    const request = new Request(input, init);
    const url = request.url;
    const hub = extractHub(url);

    const response = await fetch(request.clone());

    if (!url.includes('/chat/completions')) {
      return response;
    }

    if (!response.ok) {
      return response;
    }

    try {
      const clonedResponse = response.clone();
      const data = (await clonedResponse.json()) as ChatCompletionResponse;

      const model = data.model || 'unknown';
      const output = extractOutput(data);
      const usage = data.usage;

      const paymentInfo = extractPayment(request.headers);
      const isCollected = !!(paymentInfo?.ref && paymentInfo?.payer);

      let amount = paymentInfo?.amount || '0';
      if (!isCollected && usage && pricing[model]) {
        const { promptPrice, completionPrice } = pricing[model];
        const promptCost = Math.floor(((usage.prompt_tokens || 0) / 1_000_000) * promptPrice);
        const completionCost = Math.floor(((usage.completion_tokens || 0) / 1_000_000) * completionPrice);
        amount = String(promptCost + completionCost);
      }

      const receiptParams: BuildReceiptParams = {
        hub,
        model,
        amount,
        output,
        usage,
        paymentRef: paymentInfo?.ref,
        payer: paymentInfo?.payer,
        payTo: paymentInfo?.payTo,
        signingSecret,
        xfuelBaseUrl,
      };

      const receipt = buildSidecarReceipt(receiptParams);

      if (onReceipt) {
        await Promise.resolve(onReceipt(receipt, request, response));
      }

      const enhanced = response as SidecarResponse;
      enhanced.xfuelReceipt = receipt;

      return enhanced;
    } catch {
      return response;
    }
  };
}

/**
 * Wrap an existing fetch function (e.g. from a framework) with sidecar receipts.
 */
export function wrapFetchWithSidecar(
  baseFetch: typeof fetch,
  config: SidecarMiddlewareConfig = {}
): typeof fetch {
  const {
    signingSecret,
    xfuelBaseUrl = 'https://api.xfuel.app',
    onReceipt,
    extractPayment = defaultExtractPayment,
    pricing = {},
  } = config;

  return async function wrappedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<SidecarResponse> {
    const request = new Request(input, init);
    const url = request.url;
    const hub = extractHub(url);

    const response = await baseFetch(request.clone(), init);

    if (!url.includes('/chat/completions')) {
      return response;
    }

    if (!response.ok) {
      return response;
    }

    try {
      const clonedResponse = response.clone();
      const data = (await clonedResponse.json()) as ChatCompletionResponse;

      const model = data.model || 'unknown';
      const output = extractOutput(data);
      const usage = data.usage;

      const paymentInfo = extractPayment(request.headers);
      const isCollected = !!(paymentInfo?.ref && paymentInfo?.payer);

      let amount = paymentInfo?.amount || '0';
      if (!isCollected && usage && pricing[model]) {
        const { promptPrice, completionPrice } = pricing[model];
        const promptCost = Math.floor(((usage.prompt_tokens || 0) / 1_000_000) * promptPrice);
        const completionCost = Math.floor(((usage.completion_tokens || 0) / 1_000_000) * completionPrice);
        amount = String(promptCost + completionCost);
      }

      const receipt = buildSidecarReceipt({
        hub,
        model,
        amount,
        output,
        usage,
        paymentRef: paymentInfo?.ref,
        payer: paymentInfo?.payer,
        payTo: paymentInfo?.payTo,
        signingSecret,
        xfuelBaseUrl,
      });

      if (onReceipt) {
        await Promise.resolve(onReceipt(receipt, request, response));
      }

      const enhanced = response as SidecarResponse;
      enhanced.xfuelReceipt = receipt;

      return enhanced;
    } catch {
      return response;
    }
  };
}

/**
 * Higher-order function to create an OpenAI-compatible client with sidecar receipts.
 * Works with any client that accepts a custom `fetch` option (OpenAI SDK, etc.).
 *
 * @example
 * import OpenAI from 'openai';
 * import { withSidecarReceipts } from 'xfuel-sidecar';
 *
 * const openai = withSidecarReceipts(OpenAI, {
 *   baseURL: 'https://openrouter.ai/api/v1',
 *   apiKey: process.env.OPENROUTER_API_KEY,
 * }, {
 *   signingSecret: process.env.XFUEL_SIGNING_SECRET,
 *   onReceipt: (receipt) => console.log('XFuel receipt:', receipt.task_id),
 * });
 */
export function withSidecarReceipts<T>(
  ClientClass: new (options: { fetch?: typeof fetch; [key: string]: unknown }) => T,
  clientOptions: { fetch?: typeof fetch; [key: string]: unknown },
  sidecarConfig: SidecarMiddlewareConfig = {}
): T {
  const baseFetch = clientOptions.fetch || globalThis.fetch;
  const sidecarFetch = wrapFetchWithSidecar(baseFetch, sidecarConfig);

  return new ClientClass({
    ...clientOptions,
    fetch: sidecarFetch,
  });
}
