import config from './config.js';
import { isX402Enabled, defaultRail, toCaip2Network, usdcFor } from './x402-adapter.js';
import { XFUEL_ICON_URL } from './xfuel-icon.js';
import { defaultFacilitatorUrlForNetwork, PAYAI_FACILITATOR_URL, PAYAI_DEFAULT_FEE_PAYER } from './x402-facilitator.js';
import { describePricing } from './pricing.js';

/**
 * x402 discovery documents.
 *
 * - `GET /.well-known/x402` — CDP Bazaar / agent manifest (`buildX402Manifest`).
 * - `GET /openapi.json` — x402scan OpenAPI 3.1 (`buildOpenApiSpec`). x402scan
 *   ignores `/.well-known/x402` and registers from this document.
 *
 * Paid resources (chat first — that is the public door):
 * - `POST /v1/chat/completions` — OpenAI-compatible chat (recommended for agents)
 * - `POST /task-request` — M2M task request (lower-level, returns task_id)
 *
 * Dual-network support (2026-08-23): when X402_SOLANA_ENABLED, the bazaar
 * manifest advertises Base (CDP) and Solana (PayAI). OpenAPI `x-payment-info`
 * stays `{ protocols: [{ x402: {} }] }` + decimal USD; runtime 402 `accepts[].amount`
 * remains USDC base units (`10000` = $0.01).
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
    model: { type: 'string', example: 'xfuel/auto', description: 'Model id; xfuel/auto aliases to a live catalog route (Theta or Akash)' },
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

/** Register body — identity bind, not a paid door. */
const AGENTS_REGISTER_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    agentWallet: {
      type: 'string',
      description: 'AAWP official or smart-account address. Not an API key and not a secret.',
    },
    task_id: {
      type: 'string',
      description: 'Collected HMAC-valid receipt id from POST /v1/chat/completions (or GET /receipt/:id).',
    },
    request_hash: {
      type: 'string',
      description: 'Optional 0x 32-byte hash for POST /erc8004/validate. Derived when omitted.',
    },
  },
  required: ['agentWallet', 'task_id'],
};

const AGENTS_REGISTER_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    agent_id: { type: 'integer', description: 'Integer id for POST /erc8004/validate' },
    agentWallet: { type: 'string' },
    session: {
      type: 'string',
      description: 'Possession secret for GET|POST /v1/agents/{agent_id}/book. Not an API key and not a wallet.',
    },
    task_id: { type: 'string' },
    validate_score: { type: ['integer', 'null'] },
  },
  required: ['agent_id', 'agentWallet'],
};

const AGENTS_BOOK_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    session: {
      type: 'string',
      description: 'Possession secret issued by POST /v1/agents/register. Not an API key.',
    },
    proof: {
      type: 'string',
      description: 'HMAC-SHA256 over agent_id + window using the register session. Format sha256=<hex>.',
    },
    limit: {
      type: 'integer',
      description: 'Last-N rows. Default 50, hard max 200.',
      default: 50,
      maximum: 200,
    },
  },
};

const AGENTS_BOOK_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    agent_id: { type: 'integer' },
    limit: { type: 'integer' },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          payment: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              rail: { type: 'string' },
              amount: { type: ['string', 'null'] },
            },
          },
          collected_at: { type: 'string' },
          route: {
            type: 'object',
            properties: {
              model: { type: 'string' },
              hub: { type: 'string' },
            },
          },
        },
      },
    },
    totals: {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        usdc_sum: { type: 'string' },
        by_rail: { type: 'object' },
      },
    },
  },
  required: ['agent_id', 'limit', 'entries', 'totals'],
};

const AGENTS_BOOK_OP = {
  operationId: 'getAgentBook',
  summary: 'Possession-gated agent spend book',
  description:
    'Last-N collected UsageSettled rows for this agent_id. Possession-gated: '
    + 'present the register session or HMAC over agent_id + window. '
    + 'Unauth or wrong proof returns 401/403 with an empty body. '
    + 'Not a public index. Only collected rows appear. '
    + 'This route is not the $0.01 paid door — that stays POST /v1/chat/completions.',
  tags: ['Agents'],
  parameters: [
    {
      name: 'agent_id',
      in: 'path',
      required: true,
      schema: { type: 'integer' },
    },
    {
      name: 'limit',
      in: 'query',
      required: false,
      schema: { type: 'integer', default: 50, maximum: 200 },
    },
  ],
  requestBody: {
    required: false,
    content: {
      'application/json': { schema: AGENTS_BOOK_INPUT_SCHEMA },
    },
  },
  responses: {
    200: {
      description: 'Last-N collected spend for this agent_id',
      content: {
        'application/json': { schema: AGENTS_BOOK_OUTPUT_SCHEMA },
      },
    },
    401: { description: 'No possession proof. Empty body.' },
    403: { description: 'Wrong proof or unknown agent_id. Empty body.' },
  },
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
    ? 'OpenAI-compatible paid inference via x402 USDC on Base and Solana ($0.01). ' +
      'POST /v1/chat/completions is the recommended surface for agents. ' +
      'Returns signed receipt + public verify_url. Paying this host is real mainnet USDC.'
    : 'OpenAI-compatible paid inference via x402 USDC on Base ($0.01). POST /v1/chat/completions is ' +
      'the recommended surface for agents. Returns signed receipt + public verify_url. ' +
      'Paying this host is real mainnet USDC.';

  // Per CDP Bazaar spec: tags ≤5. Search tags only — no x402/ai/receipt/verifiable extras.
  const serviceName = 'XFuel';
  const tags = ['llm', 'openai-compatible', 'chat-completions', 'inference'];
  const iconUrl = XFUEL_ICON_URL;

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
    tags,
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
        tags,
        iconUrl,
        description:
          'OpenAI-compatible chat completions. Pay per request in USDC on Base and Solana '
          + '($0.01 floor, x402 exact scheme). Returns standard OpenAI response + signed '
          + 'XFuel receipt with public verify_url.',
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
        tags,
        iconUrl,
        description:
          'Submit a verifiable AI inference task. Pay per task in USDC on Base and Solana '
          + '($0.01 floor, x402 exact scheme). Returns a task_id, signed receipt, and public '
          + 'verify_url; poll /task-status and fetch /prove-result for the SP1 settlement proof.',
        accepts,
        input: TASK_REQUEST_INPUT_SCHEMA,
        outputSchema: TASK_REQUEST_OUTPUT_SCHEMA,
        docs: base ? `${base}/llms.txt` : '/llms.txt',
      },
    ],
    links: {
      agent_manifest: base ? `${base}/llms.txt` : '/llms.txt',
      agent_card: base ? `${base}/.well-known/agent-card.json` : '/.well-known/agent-card.json',
      agents_register: base ? `${base}/v1/agents/register` : '/v1/agents/register',
      openai_models: base ? `${base}/v1/models` : '/v1/models',
      quote: base ? `${base}/task-quote` : '/task-quote',
      docs: 'https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/M2M_API.md',
    },
  };
}

/**
 * x402scan / AgentCash discovery document (OpenAPI 3.1).
 *
 * Decimal USD in `x-payment-info.price.amount` (`"0.01"`). Runtime 402
 * `accepts[].amount` stays atomic USDC (`"10000"`). Do not swap those encodings.
 *
 * @param {string} baseUrl  resolved public base URL; '' → omit `servers`
 */
export function buildOpenApiSpec(baseUrl = '') {
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  const x = config.x402;
  const solanaEnabled = x.solana?.enabled && x.solana?.payTo;
  const ownershipProofs = [x.payTo, solanaEnabled ? x.solana.payTo : null].filter(Boolean);

  const paymentInfo = {
    price: { mode: 'fixed', currency: 'USD', amount: '0.01' },
    protocols: [{ x402: {} }],
  };

  const chatPost = {
    operationId: 'chatCompletions',
    summary: 'OpenAI-compatible chat completions (public x402 door)',
    description:
      'Pay per request in USDC on Base and Solana ($0.01 floor, x402 exact scheme). '
      + 'Returns a standard OpenAI chat.completion plus a signed XFuel receipt with public '
      + 'verify_url. Unauthenticated calls receive HTTP 402 before body validation.',
    tags: ['Chat'],
    'x-payment-info': paymentInfo,
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: CHAT_COMPLETIONS_INPUT_SCHEMA },
      },
    },
    responses: {
      200: {
        description: 'Chat completion with XFuel receipt',
        content: {
          'application/json': { schema: CHAT_COMPLETIONS_OUTPUT_SCHEMA },
        },
      },
      402: { description: 'Payment Required' },
    },
  };

  const taskPost = {
    operationId: 'taskRequest',
    summary: 'M2M verifiable inference task (lower-level)',
    description:
      'Submit a verifiable AI inference task. Returns task_id for polling. '
      + 'Agents should prefer POST /v1/chat/completions.',
    tags: ['Tasks'],
    'x-payment-info': paymentInfo,
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: TASK_REQUEST_INPUT_SCHEMA },
      },
    },
    responses: {
      200: {
        description: 'Task accepted',
        content: {
          'application/json': { schema: TASK_REQUEST_OUTPUT_SCHEMA },
        },
      },
      402: { description: 'Payment Required' },
    },
  };

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'XFuel',
      version: '1.0.0',
      description:
        'XFuel is the book. This agent spent Y on this job. You hold hub, model, and amount. '
        + 'Not a smart router. Not a model shop. POST /v1/chat/completions is $0.01 USDC on '
        + 'Base and Solana. GET|POST /v1/agents/{agent_id}/book is possession-gated last-N collected spend.',
      'x-guidance':
        'XFuel is the book: this agent spent Y on this job; you hold hub, model, and amount. '
        + 'Use POST /v1/chat/completions with an OpenAI-compatible JSON body '
        + '({ model, messages }). Unauthenticated callers get HTTP 402 with x402 '
        + 'payment requirements (USDC, $0.01 floor; Base and Solana when enabled). '
        + 'Retry with X-PAYMENT or PAYMENT-SIGNATURE. POST /v1/agents/register is fail-closed: '
        + 'it binds an agentWallet to an integer agent_id using a collected HMAC-valid receipt. '
        + 'GET|POST /v1/agents/{agent_id}/book is a possession-gated last-N collected '
        + 'spend pack for that agent_id — not a public index. '
        + 'POST /task-request is a lower-level M2M alternative that returns task_id for '
        + 'polling — do not treat it as the public door.',
    },
    'x-discovery': {
      ownershipProofs,
    },
    paths: {
      '/v1/chat/completions': { post: chatPost },
      '/task-request': { post: taskPost },
      '/v1/agents/register': {
        post: {
          operationId: 'registerAgent',
          summary: 'Register an agent identity',
          description:
            'Fail-closed. Bind an AAWP official or smart-account agentWallet to an integer agent_id. '
            + 'Requires a collected HMAC-valid receipt (task_id). Demo receipts do not qualify. '
            + 'This route is not the $0.01 paid door — that stays POST /v1/chat/completions.',
          tags: ['Agents'],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: AGENTS_REGISTER_INPUT_SCHEMA },
            },
          },
          responses: {
            200: {
              description: 'Registered identity + validate_score',
              content: {
                'application/json': { schema: AGENTS_REGISTER_OUTPUT_SCHEMA },
              },
            },
            400: { description: 'Invalid wallet, missing task_id, or HMAC failed' },
            403: { description: 'Receipt does not qualify (demo / not collected)' },
            409: { description: 'Duplicate payment.ref or task_id' },
          },
        },
      },
      '/v1/agents/{agent_id}/book': {
        get: { ...AGENTS_BOOK_OP, operationId: 'getAgentBook' },
        post: { ...AGENTS_BOOK_OP, operationId: 'postAgentBook' },
      },
    },
  };

  if (base) spec.servers = [{ url: base }];
  return spec;
}

export default { buildX402Manifest, buildOpenApiSpec };
