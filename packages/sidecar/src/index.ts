/**
 * XFuel Sidecar — emit XFuel receipts from any OpenAI-compatible upstream
 *
 * System of record, not cheapest hop. The book survives losing the route.
 *
 * @example SDK Middleware
 * ```ts
 * import OpenAI from 'openai';
 * import { createSidecarFetch } from 'xfuel-sidecar';
 *
 * const openai = new OpenAI({
 *   baseURL: 'https://openrouter.ai/api/v1',
 *   apiKey: process.env.OPENROUTER_API_KEY,
 *   fetch: createSidecarFetch({
 *     signingSecret: process.env.XFUEL_SIGNING_SECRET,
 *     onReceipt: (receipt) => console.log('XFuel receipt:', receipt.task_id),
 *   }),
 * });
 * ```
 *
 * @example Import OpenRouter Export
 * ```ts
 * import { importUsageExport } from 'xfuel-sidecar';
 *
 * const { receipts } = importUsageExport(openRouterCSV, { source: 'openrouter' });
 * ```
 */

export {
  buildSidecarReceipt,
  generateSidecarTaskId,
  hashOutput,
  canonicalSidecarPayload,
  verifySidecarSignature,
  estimateAmountFromUsage,
  SIDECAR_RECEIPT_SCHEMA,
  SIDECAR_RECEIPT_SCOPE,
  type SidecarReceipt,
  type SidecarReceiptPayment,
  type SidecarReceiptRoute,
  type SidecarReceiptOutput,
  type SidecarReceiptUsage,
  type SidecarReceiptSignature,
  type BuildReceiptParams,
  type UsageToAmountParams,
} from './receipt.js';

export {
  createSidecarFetch,
  wrapFetchWithSidecar,
  withSidecarReceipts,
  type SidecarMiddlewareConfig,
  type SidecarResponse,
} from './middleware.js';

export {
  ingestToBook,
  receiptToIngestPayload,
  registerAgent,
  type IngestConfig,
  type IngestPayload,
  type IngestResult,
} from './ingest.js';

export {
  importUsageExport,
  parseOpenRouterExport,
  parseGroqExport,
  parseGenericExport,
  openRouterToReceipts,
  groqToReceipts,
  genericToReceipts,
  IMPORT_RECEIPT_SCOPE,
  type OpenRouterUsageRow,
  type GroqUsageRow,
  type GenericUsageRow,
  type ImportConfig,
  type ImportResult,
} from './import.js';
