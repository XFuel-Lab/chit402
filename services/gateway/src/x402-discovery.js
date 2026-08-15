import config from './config.js';
import { isX402Enabled, defaultRail } from './x402-adapter.js';
import { defaultFacilitatorUrlForNetwork } from './x402-facilitator.js';
import { describePricing } from './pricing.js';

/**
 * x402 Bazaar discovery manifest.
 *
 * The x402 "Bazaar" (Coinbase CDP + the x402.org reference) is a discovery layer:
 * a facilitator exposes `GET /discovery/resources`, and a resource server becomes
 * discoverable by describing its 402-payable route(s) in the bazaar shape
 * (`accepts`-style payment requirements + human/machine metadata). See
 * https://docs.x402.org/extensions/bazaar.
 *
 * XFuel settles USDC through a standard x402 facilitator (default: the public
 * Base-Sepolia reference), so this manifest self-describes our one paid resource —
 * `POST /task-request` with `payment.rail="usdc"` — in that shape. It is served
 * publicly (no auth) at `GET /.well-known/x402` so agents, crawlers, and Bazaar
 * tooling can find and price XFuel without any XFuel-specific integration.
 *
 * The OpenAI-compatible path (`/v1/chat/completions`) is intentionally NOT listed
 * as an x402 resource: it is unmetered in Phase 1 (see docs/OPENAI_COMPATIBLE_GATEWAY.md).
 */

/** Minimal JSON-schema of the /task-request 202 response (for discovery consumers). */
const TASK_REQUEST_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    status: { type: 'string', enum: ['accepted'] },
    payment_rail: { type: 'string', enum: ['usdc', 'tfuel'] },
    payment_ref: { type: ['string', 'null'], description: 'network:txHash settlement reference' },
    verify_url: { type: 'string', description: 'public, no-auth receipt page' },
    net_amount: { type: 'string' },
    fee_amount: { type: 'string' },
    fee_bps: { type: 'integer' },
  },
  required: ['task_id', 'status', 'verify_url'],
};

/** Minimal JSON-schema of the request body clients POST to /task-request (usdc rail). */
const TASK_REQUEST_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    message_type: { type: 'string', enum: ['inference_request'] },
    chain_id: { type: 'string', example: 'theta' },
    amount: { type: 'string', description: 'gross task value in smallest unit (wei); min 10000' },
    sender: { type: 'string', description: '0x address that owns/pays for the task' },
    model_id: { type: 'string', example: 'xfuel/auto', description: 'live catalog id; list via GET /v1/models' },
    input_hash: { type: 'string', description: 'keccak256 of your input' },
    payment: {
      type: 'object',
      properties: { rail: { type: 'string', enum: ['usdc', 'tfuel'] } },
    },
  },
  required: ['message_type', 'chain_id', 'amount', 'sender'],
};

/**
 * Build the x402 discovery manifest for this node.
 * @param {string} baseUrl  resolved public base URL (absolute links); '' → relative
 */
export function buildX402Manifest(baseUrl = '') {
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  const x = config.x402;
  const facilitatorUrl =
    x.facilitatorProvider === 'x402'
      ? x.facilitatorUrl || defaultFacilitatorUrlForNetwork(x.network)
      : x.gatewayUrl || null;

  return {
    x402Version: 1,
    name: 'XFuel Protocol',
    description:
      'Verifiable settlement + payments layer for AI compute. Submit an AI inference ' +
      'task, pay per task in USDC via x402, and get a signed receipt + public verify_url ' +
      '(optional SP1 on-chain settlement proof). Route any model; prove every dollar.',
    // Whether this node is currently accepting the USDC/x402 rail. When false, the
    // resource is still described (so tooling can plan) but requests settle via TFUEL.
    x402_enabled: isX402Enabled(),
    default_rail: defaultRail(),
    // How a call is priced, before anyone spends anything. `accepts` below can
    // only carry a single `maxAmountRequired`, which for a metered resource is
    // the floor rather than the price — an agent reading only that field would
    // budget $0.01 for a call that meters to more.
    pricing: describePricing(),
    facilitator: {
      protocol: x.facilitatorProvider, // 'x402' (standard) | 'zan'
      url: facilitatorUrl,
      network: x.network,
      asset: x.asset,
    },
    resources: [
      {
        type: 'http',
        resource: `${base}/task-request`,
        method: 'POST',
        description:
          'Submit a verifiable AI inference task. Pay per task in USDC (x402, exact scheme, ' +
          'EIP-3009 on Base). Returns a task_id, a signed receipt, and a public verify_url; ' +
          'poll /task-status and fetch /prove-result for the SP1 settlement proof.',
        // x402 payment requirements (mirrors the 402 challenge `accepts` entry).
        accepts: [
          {
            scheme: 'exact',
            network: x.network,
            asset: x.asset,
            maxAmountRequired: x.usdcPriceDefault,
            payTo: x.payTo,
            mimeType: 'application/json',
            // The `exact` scheme wants one number, but the resource is metered:
            // this is the per-settlement floor, not what a given call costs.
            description:
              'Minimum per settlement. The charged amount is metered per request — '
              + 'see `pricing` on this manifest and POST /task-quote for an exact figure.',
          },
        ],
        input: TASK_REQUEST_INPUT_SCHEMA,
        outputSchema: TASK_REQUEST_OUTPUT_SCHEMA,
        docs: base ? `${base}/llms.txt` : '/llms.txt',
      },
    ],
    // Pointers for agents that discover us here (progressive disclosure).
    links: {
      agent_manifest: base ? `${base}/llms.txt` : '/llms.txt',
      openai_models: base ? `${base}/v1/models` : '/v1/models',
      quote: base ? `${base}/task-quote` : '/task-quote',
      docs: 'https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/M2M_API.md',
    },
  };
}

export default { buildX402Manifest };
