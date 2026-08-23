import config from './config.js';
import { isX402Enabled, defaultRail, toCaip2Network, usdcFor } from './x402-adapter.js';
import { defaultFacilitatorUrlForNetwork, PAYAI_FACILITATOR_URL, PAYAI_DEFAULT_FEE_PAYER } from './x402-facilitator.js';
import { describePricing } from './pricing.js';

/**
 * x402 Bazaar discovery manifest.
 *
 * Served at `GET /.well-known/x402`. Describes the paid resources:
 * - `POST /v1/chat/completions` — OpenAI-compatible chat (recommended for agent callers)
 * - `POST /task-request` — M2M task request (lower-level, returns task_id for polling)
 *
 * Dual-network support (2026-08-23): when X402_SOLANA_ENABLED, advertises
 * both Base (CDP facilitator) and Solana (PayAI facilitator) payment options.
 *
 * Cataloging itself happens when CDP settles a payment that carries
 * `paymentPayload.resource` + `extensions.bazaar` — see docs/X402_ADAPTER.md.
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
    chain_id: { type: 'string', example: 'base' },
    amount: { type: 'string', description: 'gross task value in USDC base units (6 decimals); min 10000 ($0.01)' },
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

/** Minimal JSON-schema of the OpenAI chat completions request body. */
const CHAT_COMPLETIONS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    model: { type: 'string', example: 'xfuel/auto', description: 'Model id; xfuel/auto routes to best available' },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['system', 'user', 'assistant'] },
          content: { type: 'string' },
        },
        required: ['role', 'content'],
      },
    },
    max_tokens: { type: 'integer', description: 'Maximum tokens to generate' },
    temperature: { type: 'number', minimum: 0, maximum: 2 },
    stream: { type: 'boolean', default: false },
  },
  required: ['messages'],
};

/** Minimal JSON-schema of the OpenAI chat completions response. */
const CHAT_COMPLETIONS_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'chatcmpl-abc123' },
    object: { type: 'string', enum: ['chat.completion'] },
    created: { type: 'integer', description: 'Unix timestamp' },
    model: { type: 'string' },
    choices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          message: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              content: { type: 'string' },
            },
          },
          finish_reason: { type: 'string' },
        },
      },
    },
    usage: {
      type: 'object',
      properties: {
        prompt_tokens: { type: 'integer' },
        completion_tokens: { type: 'integer' },
        total_tokens: { type: 'integer' },
      },
    },
    xfuel: {
      type: 'object',
      description: 'XFuel receipt with verify_url, payment_ref, task_id',
    },
  },
  required: ['id', 'choices', 'xfuel'],
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
  const wireNetwork = toCaip2Network(x.network);
  const { asset, name, version } = usdcFor(x.network);

  // Dual-network support: when Solana is enabled, advertise both payment rails.
  const solanaEnabled = x.solana?.enabled && x.solana?.payTo;
  const solNetwork = solanaEnabled ? (x.solana.network || 'solana') : null;
  const solWireNetwork = solNetwork ? toCaip2Network(solNetwork) : null;
  const solUsdcInfo = solNetwork ? usdcFor(solNetwork) : null;

  // Description leads with "OpenAI-compatible" for Bazaar search discoverability.
  const description = solanaEnabled
    ? 'OpenAI-compatible paid inference via x402 USDC; accepts Base (primary) and Solana. ' +
      'POST /v1/chat/completions is the recommended surface for agents. ' +
      'Returns signed receipt + verify_url. Paying this host is real mainnet USDC.'
    : 'OpenAI-compatible paid inference on Base (USDC via x402). POST /v1/chat/completions is ' +
      'the recommended surface for agents. Returns a signed receipt + verify_url. ' +
      'Paying this host is real Base mainnet USDC.';

  // Tags for Bazaar search: llm, openai-compatible, chat-completions for discoverability
  const serviceName = 'XFuel';
  const tags = ['llm', 'openai-compatible', 'chat-completions', 'inference', 'receipt', 'verifiable'];
  const iconUrl = 'https://xfuel.app/xfuel-icon.svg';

  // Build accepts array: Base (primary) + Solana (optional)
  const accepts = [
    {
      scheme: 'exact',
      network: wireNetwork,
      amount: x.usdcPriceDefault,
      maxAmountRequired: x.usdcPriceDefault,
      asset,
      payTo: x.payTo,
      maxTimeoutSeconds: 120,
      mimeType: 'application/json',
      extra: { name, version },
      description:
        'Minimum per settlement. The charged amount is metered per request — '
        + 'see `pricing` on this manifest and POST /task-quote for an exact figure.',
    },
  ];

  // Add Solana accepts entry when enabled
  if (solanaEnabled) {
    accepts.push({
      scheme: 'exact',
      network: solWireNetwork,
      amount: x.usdcPriceDefault,
      maxAmountRequired: x.usdcPriceDefault,
      asset: solUsdcInfo.asset,
      payTo: x.solana.payTo,
      maxTimeoutSeconds: 120,
      mimeType: 'application/json',
      extra: { feePayer: solUsdcInfo.feePayer || PAYAI_DEFAULT_FEE_PAYER },
      description:
        'Solana USDC payment via PayAI facilitator. Same metered pricing as Base.',
    });
  }

  // Payment protocols: CDP for Base, PayAI for Solana
  const paymentProtocols = [
    { network: wireNetwork, protocol: 'cdp', facilitator: facilitatorUrl },
  ];
  if (solanaEnabled) {
    paymentProtocols.push({
      network: solWireNetwork,
      protocol: 'payai',
      facilitator: x.solana.facilitatorUrl || PAYAI_FACILITATOR_URL,
    });
  }

  return {
    x402Version: 2,
    name: 'XFuel Protocol',
    serviceName,
    tags: tags.slice(0, 6),
    iconUrl,
    description,
    x402_enabled: isX402Enabled(),
    default_rail: defaultRail(),
    pricing: describePricing(),
    paymentProtocols,
    facilitator: {
      protocol: x.facilitatorProvider, // 'x402' (standard) | 'zan'
      url: facilitatorUrl,
      network: wireNetwork,
      asset,
    },
    resources: [
      {
        type: 'http',
        resource: `${base}/v1/chat/completions`,
        method: 'POST',
        serviceName,
        tags: tags.slice(0, 6),
        iconUrl,
        description:
          'OpenAI-compatible chat completions. Pay per request in USDC (x402, exact scheme). ' +
          'Returns standard OpenAI response + XFuel receipt with verify_url. ' +
          'Demo key (xfuel-demo) bypasses payment for testing.',
        accepts,
        input: CHAT_COMPLETIONS_INPUT_SCHEMA,
        outputSchema: CHAT_COMPLETIONS_OUTPUT_SCHEMA,
        docs: base ? `${base}/llms.txt` : '/llms.txt',
      },
      {
        type: 'http',
        resource: `${base}/task-request`,
        method: 'POST',
        serviceName,
        tags: tags.slice(0, 6),
        iconUrl,
        description:
          'Submit a verifiable AI inference task. Pay per task in USDC (x402, exact scheme). ' +
          'Returns a task_id, a signed receipt, and a public verify_url; ' +
          'poll /task-status and fetch /prove-result for the SP1 settlement proof.',
        accepts,
        input: TASK_REQUEST_INPUT_SCHEMA,
        outputSchema: TASK_REQUEST_OUTPUT_SCHEMA,
        docs: base ? `${base}/llms.txt` : '/llms.txt',
      },
    ],
    links: {
      agent_manifest: base ? `${base}/llms.txt` : '/llms.txt',
      openai_models: base ? `${base}/v1/models` : '/v1/models',
      quote: base ? `${base}/task-quote` : '/task-quote',
      docs: 'https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/M2M_API.md',
    },
  };
}

export default { buildX402Manifest };
