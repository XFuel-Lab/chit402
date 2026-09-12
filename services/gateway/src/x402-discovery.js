import config from './config.js';
import { isX402Enabled, defaultRail, toCaip2Network, usdcFor } from './x402-adapter.js';
import { buildIconUrl } from './xfuel-icon.js';
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
 * - `POST /v1/chat/completions` — Chat completions (recommended for agents)
 * - `POST /a2a-message` — A2A card URL; same x402 handshake + fulfillment as /v1
 * - `POST /task-request` — M2M task request (lower-level, returns task_id)
 *
 * Dual-network support (2026-08-23): when X402_SOLANA_ENABLED, the bazaar
 * manifest advertises Base (CDP) and Solana (PayAI). OpenAPI `x-payment-info`
 * stays `{ protocols: [{ x402: {} }] }` + decimal USD; runtime 402 `accepts[].amount`
 * remains USDC base units (`2000`).
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
    amount: { type: 'string', description: 'gross task value in USDC base units (6 decimals)' },
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
    intent_id: {
      type: 'string',
      description: 'Groups retries/attempts under one treasury intent bill. Prefer explicit. Header: X-XFuel-Intent.',
    },
    attempt_index: {
      type: 'integer',
      minimum: 0,
      description: 'Zero-based attempt within intent_id. Header: X-XFuel-Attempt.',
    },
  },
  required: ['messages'],
};

/** Minimal JSON-schema of the Responses API request body. */
const RESPONSES_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    model: { type: 'string', example: 'xfuel/auto', description: 'Model id; xfuel/auto aliases to a live catalog route' },
    input: {
      oneOf: [
        { type: 'string', description: 'A single prompt string' },
        {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['system', 'user', 'assistant'] },
              content: { type: 'string' },
            },
            required: ['role', 'content'],
          },
          description: 'Array of message objects',
        },
      ],
      description: 'Prompt string or array of messages',
    },
    max_output_tokens: { type: 'integer', description: 'Maximum tokens to generate' },
    temperature: { type: 'number', minimum: 0, maximum: 2 },
  },
  required: ['input'],
};

/** Minimal JSON-schema of the Responses API response. */
const RESPONSES_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'resp_abc123' },
    object: { type: 'string', enum: ['response'] },
    created_at: { type: 'integer', description: 'Unix timestamp' },
    model: { type: 'string' },
    status: { type: 'string', enum: ['completed', 'failed'] },
    output: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['message', 'function_call'] },
          role: { type: 'string' },
          content: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                text: { type: 'string' },
              },
            },
          },
        },
      },
      description: 'Array of output items (message, function_call)',
    },
    output_text: { type: 'string', description: 'Convenience field: plain text of the response' },
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
      description: 'Chit receipt with verify_url, payment_ref, task_id',
    },
  },
  required: ['id', 'object', 'output', 'xfuel'],
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

const SETTLEMENT_REPLAY_FIELDS = {
  settlement_status: {
    type: 'string',
    enum: ['settled', 'idempotent_replay'],
    description:
      'Treasury settlement outcome. idempotent_replay = same payment.ref / receipt resubmitted; '
      + 'one canonical row, no second USDC charge.',
  },
  idempotent_replay: {
    type: 'boolean',
    description: 'True when this request matched an existing settled row (replay, not a new collect).',
  },
  replay_of: {
    type: ['string', 'null'],
    description: 'task_id of the canonical settled row when settlement_status=idempotent_replay.',
  },
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
    ...SETTLEMENT_REPLAY_FIELDS,
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
    budget: {
      type: ['string', 'null'],
      description:
        'Prepaid budget Y in USDC atomic units (6 decimals). Null clears (unlimited). '
        + 'Possession-gated set. Absent = read only.',
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
          evidence: {
            type: 'string',
            enum: ['collected', 'RECORDED_BY_SETTLE', 'ARRIVAL_UNVERIFIED', 'inflow_claimed', 'UNVERIFIED', 'policy_blocked'],
            description:
              'Possession/settlement evidence. RECORDED_BY_SETTLE = recorder accepted at settle cutoff; '
              + 'ARRIVAL_UNVERIFIED = explicit omission when ingress_receipt missing at cutoff; '
              + 'inflow_claimed = signed bucket/allocation without payment.ref; '
              + 'UNVERIFIED when payer/payment.ref/amount cannot be proven — never treated as zero payment.',
          },
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
          intent_id: {
            type: 'string',
            description: 'Groups retries/attempts under one treasury intent bill.',
          },
          attempt_index: {
            type: 'integer',
            description: 'Zero-based attempt index within intent_id.',
          },
          payer_wallet: {
            type: ['string', 'null'],
            description: 'On-chain payer bound at settle (↔ payment.ref). Survives session rotate.',
          },
          replay_count: {
            type: 'integer',
            description: 'Count of idempotent replay submissions for this canonical row.',
          },
          replay_events: {
            type: 'array',
            description: 'Audit trail of idempotent replays (each links replay_of → task_id).',
            items: {
              type: 'object',
              properties: {
                at: { type: 'string' },
                settlement_status: { type: 'string', enum: ['idempotent_replay'] },
                replay_of: { type: 'string' },
              },
            },
          },
          parent_ref: { type: 'string' },
          event: {
            type: 'string',
            enum: ['policy_blocked'],
            description: 'Present on non-charge policy blocks (collected=false).',
          },
          policy_code: {
            type: 'string',
            description: 'Which policy rule blocked the hop (e.g. hourly_cap_exceeded, kill_switch).',
          },
          reason: { type: 'string' },
          policy_key: {
            type: 'string',
            description: 'Cap policy type when blocked by hourly_cap or daily_cap (e.g. hourly_cap).',
          },
          spent_atomic: {
            type: 'string',
            description: 'USDC atomic spent in the cap period at block time (collected rows only).',
          },
          cap_atomic: {
            type: 'string',
            description: 'USDC atomic cap limit for policy_key at block time.',
          },
          period_start: {
            type: 'string',
            description: 'UTC period start (ISO8601) joinable across policy_blocked rows.',
          },
          collected: { type: 'boolean' },
          recorded_by: {
            type: 'string',
            enum: ['settle'],
            description: 'Present on RECORDED_BY_SETTLE rows.',
          },
          arrival_status: {
            type: 'string',
            enum: ['pending', 'confirmed', 'unverified'],
            description: 'Arrival sub-state on settle-time rows.',
          },
          omission_rule: {
            type: 'string',
            description: 'Explicit omission when evidence=ARRIVAL_UNVERIFIED (e.g. no_ingress_receipt_at_cutoff).',
          },
          ingress_receipt: {
            type: 'object',
            description: 'Ingress / arrival evidence promoting RECORDED_BY_SETTLE → collected.',
            properties: {
              ref: { type: 'string' },
              confirmed_at: { type: 'string' },
            },
          },
          bucket: { type: 'string', description: 'Revenue bucket on inflow_claimed rows.' },
          inflow_claim: {
            type: 'object',
            description: 'Signed bucket/allocation claim for unaffiliated inflows (no payment.ref).',
          },
          inflow_corrections: {
            type: 'array',
            description: 'Append-only corrections to inflow_claim — never scrape-later.',
          },
        },
      },
    },
    intents: {
      type: 'object',
      description: 'Rows grouped by intent_id when present (treasury view).',
      additionalProperties: {
        type: 'object',
        properties: {
          intent_id: { type: 'string' },
          attempts: { type: 'array' },
          collected_count: { type: 'integer' },
          blocked_count: { type: 'integer' },
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
    window: {
      type: 'string',
      description: 'Cap window. prepaid_ceiling = sum of collected until Y is raised.',
      enum: ['prepaid_ceiling'],
    },
    cap: {
      type: ['string', 'null'],
      description: 'Budget Y in USDC atomic units. Null = unlimited.',
    },
    spent: {
      type: 'string',
      description: 'Sum of collected amounts for this agent_id under prepaid_ceiling.',
    },
    remaining: {
      type: ['string', 'null'],
      description: 'max(0, Y − spent). Null when unlimited.',
    },
    allowance: {
      type: 'object',
      description: 'Signed remaining-allowance (HMAC over agent_id + remaining + as_of). Verify only.',
      properties: {
        agent_id: { type: 'integer' },
        remaining: { type: ['string', 'null'] },
        as_of: { type: 'string' },
        signature: {
          type: 'object',
          properties: {
            alg: { type: 'string' },
            value: { type: 'string' },
          },
        },
      },
    },
  },
  required: ['agent_id', 'limit', 'entries', 'totals', 'window', 'cap', 'spent', 'remaining'],
};

/** Foreign x402 book ingest input schema. */
const AGENTS_BOOK_INGEST_INPUT_SCHEMA = {
  type: 'object',
  required: ['payment_required', 'payment_response', 'session'],
  properties: {
    session: {
      type: 'string',
      description: 'Possession secret issued by POST /v1/agents/register. Required.',
    },
    payment_required: {
      type: 'object',
      required: ['resource', 'amount', 'payTo'],
      description: 'The 402 PAYMENT-REQUIRED (or equivalent) from the foreign endpoint.',
      properties: {
        resource: { type: 'string', description: 'The foreign 402 resource URL paid.' },
        amount: { type: 'string', description: 'Amount in atomic USDC (6 decimals).' },
        payTo: { type: 'string', description: 'The payTo address from the 402 challenge.' },
        network: { type: 'string', description: 'Network (e.g. base, solana). Defaults to base.' },
        asset: { type: 'string', description: 'Asset type (e.g. USDC).' },
      },
    },
    payment_response: {
      type: 'object',
      required: ['tx', 'payer'],
      description: 'The PAYMENT-RESPONSE (or equivalent) proving the payment.',
      properties: {
        tx: { type: 'string', description: 'Transaction hash / settlement ref.' },
        payer: { type: 'string', description: 'Payer address.' },
        network: { type: 'string', description: 'Network the payment was made on.' },
      },
    },
  },
};

/** Foreign x402 book ingest output schema. */
const AGENTS_BOOK_INGEST_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string', description: 'Synthetic task_id for this ingest.' },
    agent_id: { type: 'integer' },
    payment: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Payment reference (network:tx).' },
        rail: { type: 'string' },
        amount: { type: 'string' },
        collected: { type: 'boolean' },
      },
    },
    route: {
      type: 'object',
      properties: {
        hub: { type: 'string', description: 'Extracted host from resource URL.' },
        model: { type: 'string', description: 'Extracted path from resource URL.' },
        resource: { type: 'string', description: 'Original foreign 402 resource URL.' },
      },
    },
    foreign_x402: { type: 'boolean', description: 'Always true for ingest.' },
    recorded_at: { type: 'string' },
    signature: {
      type: 'object',
      nullable: true,
      description: 'HMAC means "Chit recorded this" — not merchant attestation.',
      properties: {
        alg: { type: 'string' },
        scope: { type: 'string', enum: ['recorded'] },
        value: { type: 'string' },
      },
    },
  },
};

const AGENTS_BOOK_WEBHOOK_INPUT_SCHEMA = {
  type: 'object',
  required: ['url'],
  properties: {
    url: {
      type: 'string',
      format: 'uri',
      description: 'HTTPS treasury desk endpoint. localhost/http allowed only in NODE_ENV=test.',
    },
    secret: {
      type: 'string',
      description: 'Optional shared HMAC secret. Omitted → server generates one (returned once as secret_once).',
    },
    events: {
      type: 'array',
      items: { type: 'string', enum: ['settle', 'inflow', 'policy_blocked', 'collected'] },
      description: 'Subset of book events to push. Default: all.',
    },
  },
};

const AGENTS_BOOK_WEBHOOK_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    agent_id: { type: 'integer' },
    enabled: { type: 'boolean' },
    url_host: { type: 'string', description: 'Registered URL host (full URL never echoed on GET).' },
    url_path: { type: 'string', description: 'Registered URL path + query.' },
    events: {
      type: 'array',
      items: { type: 'string', enum: ['settle', 'inflow', 'policy_blocked', 'collected'] },
    },
    has_secret: { type: 'boolean' },
    deliveries: { type: 'integer' },
    failures: { type: 'integer' },
    lastStatus: { type: ['integer', 'null'] },
    lastError: { type: ['string', 'null'] },
  },
};

const PUBLIC_PULL_EXPORT_ENVELOPE_SCHEMA = {
  type: 'object',
  description:
    'Signed pull-export envelope (schema chit402.book_pull_export.v1). ES256 JWS over canonical claims; verify via /.well-known/jwks.json.',
  properties: {
    schema: { type: 'string', enum: ['chit402.book_pull_export.v1'] },
    slug: { type: 'string', description: 'Stable pull-export slug (e.g. hemei-treasury).' },
    agent_id: { type: 'integer', description: 'Scoped agent id for treasury desk row (house-published).' },
    format: { type: 'string', enum: ['json', 'csv'] },
    exported_at: { type: 'string', format: 'date-time' },
    specimen: { type: 'boolean', description: 'True when document is a redacted house specimen, not a live private book.' },
    verify_jwks: { type: 'string', description: 'JWKS URL for issuer_signature verification.' },
    document_sha256_rule: {
      type: 'string',
      description:
        'How to recompute document_sha256 from envelope.document for this format (matches signed JWS claim).',
    },
    document_media_type: { type: 'string' },
    document: {
      description: 'chit402.book_audit.v1 object (format=json) or CSV string (format=csv).',
    },
    issuer_signature: {
      type: 'object',
      properties: {
        alg: { type: 'string', enum: ['ES256'] },
        typ: { type: 'string', enum: ['chit402-pull-export+jwt'] },
        kid: { type: 'string' },
        jws: { type: 'string' },
        issuer_jwk: { type: 'object', description: 'Pinned public key (offline verify).' },
      },
    },
    pull_note: { type: ['string', 'null'] },
  },
};

const BOOK_WEBHOOK_ENVELOPE_SCHEMA = {
  type: 'object',
  description: 'Signed push envelope (schema chit402.book_webhook.v1). HMAC-SHA256 over raw JSON body.',
  properties: {
    schema: { type: 'string', enum: ['chit402.book_webhook.v1'] },
    delivery_id: { type: 'string', description: 'Idempotency key for treasury desk dedupe.' },
    event: { type: 'string', enum: ['settle', 'inflow', 'policy_blocked', 'collected'] },
    agent_id: { type: 'integer' },
    task_id: { type: 'string' },
    receipt_id: { type: 'string', description: 'Same as task_id.' },
    evidence: { type: 'string' },
    collected_at: { type: ['string', 'null'] },
    hub: { type: ['string', 'null'] },
    model: { type: ['string', 'null'] },
    amount: { type: ['string', 'null'] },
    payment_ref: { type: ['string', 'null'] },
    rail: { type: ['string', 'null'] },
    bucket: { type: ['string', 'null'] },
    payer_wallet: { type: ['string', 'null'] },
    intent_id: { type: ['string', 'null'] },
    attempt_index: { type: ['integer', 'null'] },
    replay_count: { type: ['integer', 'null'] },
    verify_url: { type: 'string' },
    explorer_url: { type: ['string', 'null'] },
    policy_code: { type: ['string', 'null'] },
    reason: { type: ['string', 'null'] },
    policy_key: { type: ['string', 'null'] },
    spent_atomic: { type: ['string', 'null'] },
    cap_atomic: { type: ['string', 'null'] },
    period_start: { type: ['string', 'null'] },
    emitted_at: { type: 'string' },
  },
};

const AGENTS_BOOK_OP = {
  operationId: 'getAgentBook',
  summary: 'Possession-gated agent spend book',
  description:
    'Last-N collected UsageSettled rows for this agent_id, plus budget Y (cap), spent, '
    + 'and remaining under a prepaid ceiling. Possession-gated: '
    + 'present the register session or HMAC over agent_id + window. '
    + 'POST with { session, budget } sets Y (null = unlimited). '
    + 'Unauth or wrong proof returns 401/403 with an empty body. '
    + 'Not a public index. Only collected rows appear. '
    + 'This route is not the paid door — that stays POST /v1/chat/completions.',
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
      description: 'Last-N collected spend + cap / spent / remaining for this agent_id',
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
      description: 'Chit receipt with verify_url, payment_ref, task_id',
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

  // Description for Bazaar search discoverability.
  const description = solanaEnabled
    ? 'Treasury desk and possession book for agent spend. Who paid which call — export, policy, evidence. '
      + 'POST /v1/chat/completions is the x402 USDC door on Base and Solana. Each call returns a signed receipt: '
      + 'hub, model, amount, verify_url. Cost-plus, quoted, receipted. Real mainnet USDC.'
    : 'Treasury desk and possession book for agent spend. Who paid which call — export, policy, evidence. '
      + 'POST /v1/chat/completions is the x402 USDC door on Base. Each call returns a signed receipt: '
      + 'hub, model, amount, verify_url. Cost-plus, quoted, receipted. Real mainnet USDC.';

  // Per CDP Bazaar spec: tags ≤5. Search tags only — no x402/ai/receipt/verifiable extras.
  // Per naming law: Chit402 is the public/searchable name; Chit is spoken shorthand only.
  const serviceName = 'Chit402';
  const tags = ['llm', 'openai-compatible', 'chat-completions', 'inference'];
  const iconUrl = buildIconUrl(base);

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
        'Solana USDC payment via PayAI facilitator. Same cost-plus pricing as Base.',
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
    name: 'Chit402',
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
          'Chat completions (bot drop-in). Cost-plus, quoted, receipted — pay USDC on Base or '
          + 'Solana (x402 exact scheme). Returns standard chat completion response + signed Chit receipt '
          + 'with public verify_url. You hold hub, model, and amount.',
        accepts,
        input: CHAT_COMPLETIONS_INPUT_SCHEMA,
        outputSchema: CHAT_COMPLETIONS_OUTPUT_SCHEMA,
        docs: base ? `${base}/llms.txt` : '/llms.txt',
      },
      {
        type: 'http',
        resource: `${base}/v1/responses`,
        method: 'POST',
        serviceName,
        tags,
        iconUrl,
        description:
          'Responses API (bot drop-in). Same x402 + signed receipt as /v1/chat/completions. '
          + 'Accepts input (string or message array), max_output_tokens. '
          + 'Returns Responses-shaped output + Chit receipt with verify_url. Stateless one-shot.',
        accepts,
        input: RESPONSES_INPUT_SCHEMA,
        outputSchema: RESPONSES_OUTPUT_SCHEMA,
        docs: base ? `${base}/llms.txt` : '/llms.txt',
      },
      {
        type: 'http',
        resource: `${base}/a2a-message`,
        method: 'POST',
        serviceName,
        tags,
        iconUrl,
        description:
          'A2A card URL. Same x402 floor and chat fulfillment as /v1/chat/completions. '
          + 'Returns signed receipt: hub, model, amount, verify_url. Unauthenticated POST {} returns HTTP 402.',
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
          'Submit a verifiable AI inference task. Cost-plus, quoted, receipted — pay USDC on Base or '
          + 'Solana (x402 exact scheme). Returns a task_id, signed receipt, and public verify_url; '
          + 'poll /task-status and fetch /prove-result for the SP1 settlement proof.',
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
      docs: 'https://github.com/XFuel-Lab/chit402/blob/main/docs/M2M_API.md',
    },
  };
}

/**
 * x402scan / AgentCash discovery document (OpenAPI 3.1).
 *
 * Decimal USD in `x-payment-info.price.amount` (`"0.002"`). Runtime 402
 * `accepts[].amount` stays atomic USDC (`"2000"`). Do not swap those encodings.
 *
 * @param {string} baseUrl  resolved public base URL; '' → omit `servers`
 */
export function buildOpenApiSpec(baseUrl = '') {
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  const x = config.x402;
  const solanaEnabled = x.solana?.enabled && x.solana?.payTo;
  const ownershipProofs = [x.payTo, solanaEnabled ? x.solana.payTo : null].filter(Boolean);

  const paymentInfo = {
    price: { mode: 'fixed', currency: 'USD', amount: '0.002' },
    protocols: [{ x402: {} }],
  };

  const chatPost = {
    operationId: 'chatCompletions',
    summary: 'Chat completions (public x402 door)',
    description:
      'No account. No API key. A wallet that can pay the 402 is enough. '
        + 'Pay per request in USDC on Base or Solana (x402 exact scheme). '
      + 'Returns a standard OpenAI chat.completion plus a signed Chit receipt with public '
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
        description: 'Chat completion with Chit receipt',
        content: {
          'application/json': { schema: CHAT_COMPLETIONS_OUTPUT_SCHEMA },
        },
      },
      402: { description: 'Payment Required' },
    },
  };

  const a2aPost = {
    operationId: 'a2aMessage',
    summary: 'A2A paid door (same x402 as /v1)',
    description:
      'A2A card URL. Same x402 floor and chat fulfillment as POST /v1/chat/completions. '
      + 'No account. No API key. A wallet that can pay the 402 is enough. '
      + 'You hold hub, model, and amount. Unauthenticated POST {} returns HTTP 402. '
      + 'Collected rows are bookable via GET|POST /v1/agents/{agent_id}/book.',
    tags: ['A2A'],
    'x-payment-info': paymentInfo,
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: CHAT_COMPLETIONS_INPUT_SCHEMA },
      },
    },
    responses: {
      200: {
        description: 'Chat completion with Chit receipt (same shape as /v1)',
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

  const responsesPost = {
    operationId: 'responses',
    summary: 'Responses API (public x402 door)',
    description:
      'Responses API drop-in. Same x402 + signed receipt as /v1/chat/completions. '
        + 'No account. No API key. A wallet that can pay the 402 is enough. '
        + 'Accepts input (string or message array), max_output_tokens. '
        + 'Returns Responses-shaped output + Chit receipt with verify_url. Stateless one-shot.',
    tags: ['Chat'],
    'x-payment-info': paymentInfo,
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: RESPONSES_INPUT_SCHEMA },
      },
    },
    responses: {
      200: {
        description: 'Responses output with Chit receipt',
        content: {
          'application/json': { schema: RESPONSES_OUTPUT_SCHEMA },
        },
      },
      402: { description: 'Payment Required' },
    },
  };

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Chit402',
      version: '1.0.0',
      description:
      'Treasury desk for agent spend — who paid which call; export, policy, evidence. '
      + 'Possession book for principals. POST /v1/chat/completions returns a signed receipt: '
      + 'hub, model, amount, verify_url. USDC on Base or Solana. POST /a2a-message is the same paid door. '
      + 'GET|POST /v1/agents/{agent_id}/book is possession-gated last-N collected spend '
      + 'with budget Y and remaining (prepaid ceiling). '
      + 'Private Spend: registered sessions get vendor_blind by default. '
      + 'Replaceable Signer: receipts carry dual signatures (primary + co_signature); '
      + 'verify offline via docs/VERIFY_ALGORITHM.md.',
      'x-guidance':
        'Treasury desk for agent spend — who paid which call; export, policy, evidence. '
        + 'Possession book for principals. No account. No API key. A wallet that can pay the 402 is enough. '
        + 'Register is only to hold the possession book after a collected receipt. '
        + 'Use POST /v1/chat/completions with a standard chat-completions JSON body '
        + '({ model, messages }). POST /a2a-message is the A2A card URL with the same x402 floor. '
        + 'Unauthenticated callers get HTTP 402 with x402 '
        + 'payment requirements (USDC; Base and Solana when enabled). '
        + 'Retry with X-PAYMENT or PAYMENT-SIGNATURE. POST /v1/agents/register is fail-closed: '
        + 'it binds an agentWallet to an integer agent_id using a collected HMAC-valid receipt. '
        + 'GET|POST /v1/agents/{agent_id}/book is a possession-gated last-N collected '
        + 'spend pack with budget Y / remaining for that agent_id — not a public index. '
        + 'Private Spend is default for registered sessions (X-XFuel-Session header). '
        + 'Receipts carry dual signatures; co_signature enables verify if Chit disappears. '
        + 'POST /task-request is a lower-level M2M alternative that returns task_id for '
        + 'polling — do not treat it as the public door.',
    },
    'x-discovery': {
      ownershipProofs,
    },
    paths: {
      '/v1/chat/completions': { post: chatPost },
      '/v1/responses': { post: responsesPost },
      '/a2a-message': { post: a2aPost },
      '/task-request': { post: taskPost },
      '/v1/agents/register': {
        post: {
          operationId: 'registerAgent',
          summary: 'Register an agent identity',
          description:
            'Fail-closed. Bind an AAWP official or smart-account agentWallet to an integer agent_id. '
            + 'Requires a collected HMAC-valid receipt (task_id). Demo receipts do not qualify. '
            + 'This route is not the paid door — that stays POST /v1/chat/completions.',
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
      '/v1/agents/{agent_id}/book/inflow': {
        post: {
          operationId: 'recordBookInflow',
          summary: 'Record unaffiliated inflow (no payment.ref)',
          description:
            'Patron-style inflow without a payment object. Writes a settle-time signed bucket/allocation '
            + 'claim on the book row. Possession-gated. Demo keys never write. '
            + 'Corrections via POST /book/inflow/correct (append-only).',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['allocation'],
                  properties: {
                    session: { type: 'string' },
                    bucket: { type: 'string', default: 'patron' },
                    allocation: { type: 'string', description: 'USDC atomic units' },
                    task_id: { type: 'string' },
                    model: { type: 'string' },
                    hub: { type: 'string' },
                    inflow_claim: { type: 'object', description: 'Pre-signed claim (optional)' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Inflow row recorded.' },
            400: { description: 'Invalid allocation.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Demo key or invalid inflow_claim signature.' },
            409: { description: 'Duplicate task_id.' },
          },
        },
      },
      '/v1/agents/{agent_id}/book/inflow/correct': {
        post: {
          operationId: 'correctBookInflow',
          summary: 'Append-only correction to an inflow row',
          description:
            'Revise bucket/allocation on an inflow_claimed row via append-only correction. '
            + 'Never scrape-later. Possession-gated.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['task_id', 'reason'],
                  properties: {
                    session: { type: 'string' },
                    task_id: { type: 'string' },
                    bucket: { type: 'string' },
                    allocation: { type: 'string' },
                    reason: { type: 'string' },
                    correction: { type: 'object' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Correction appended.' },
            400: { description: 'Missing reason or invalid correction.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Demo key or invalid correction signature.' },
            404: { description: 'Inflow row not found.' },
          },
        },
      },
      '/v1/agents/{agent_id}/book/ingest': {
        post: {
          operationId: 'ingestForeignX402',
          summary: 'Ingest a foreign x402 payment into the book',
          description:
            'Record an agent\'s arbitrary x402 spend to a foreign endpoint. Requires possession (session), '
            + 'the 402 payment required (resource, amount, payTo), and payment response (tx, payer, network). '
            + 'Naked tx hash is rejected — must have 402 context. Demo keys never write. '
            + 'HMAC on a foreign row means "Chit recorded this" — not merchant attestation. '
            + 'Per whitepaper §2: Chit does NOT settle foreign payments (CDP/PayAI stay verify+settle).',
          tags: ['Agents'],
          parameters: [
            {
              name: 'agent_id',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: AGENTS_BOOK_INGEST_INPUT_SCHEMA },
            },
          },
          responses: {
            201: {
              description: 'Foreign x402 payment recorded in the book.',
              content: {
                'application/json': { schema: AGENTS_BOOK_INGEST_OUTPUT_SCHEMA },
              },
            },
            400: { description: 'Invalid input, missing required fields, or naked tx hash rejected.' },
            401: { description: 'No possession proof (session required).' },
            403: { description: 'Demo key or session does not match agent_id.' },
            409: { description: 'Duplicate transaction (replay protection).' },
          },
        },
      },
      '/v1/agents/{agent_id}/book/lineage/{task_id}': {
        get: {
          operationId: 'getBookLineage',
          summary: 'Query lineage for a task',
          description:
            'Walk A→B→inference row-chain. A2A disputes need this. Returns ancestors (via parent_ref), '
            + 'descendants, root, and self. Possession-gated.',
          tags: ['Agents'],
          parameters: [
            { name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'task_id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Lineage for the task.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Wrong proof, unknown agent_id, or task not owned.' },
          },
        },
      },
      '/v1/agents/{agent_id}/book/policy': {
        get: {
          operationId: 'getBookPolicy',
          summary: 'Get current policy for agent',
          description: 'Returns daily_cap, hourly_cap, model_allowlist, kill_switch, require_payment_ref, tier2_above, approval_ttl, risk_tiers. Possession-gated.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'Current policy.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Wrong proof or unknown agent_id.' },
          },
        },
        post: {
          operationId: 'setBookPolicy',
          summary: 'Set policy for agent',
          description:
            'Caps as rows beside the book (not the router). Set daily_cap, hourly_cap (clock hour UTC), '
            + 'model_allowlist, kill_switch, require_payment_ref, tier2_above (USDC atomic), '
            + 'approval_ttl (seconds — high-blast SessionAct re-challenge window), or risk_tiers '
            + '({ high: string[], low: string[] }). Demo keys cannot write policy rows.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    policy_type: {
                      type: 'string',
                      enum: ['daily_cap', 'hourly_cap', 'model_allowlist', 'kill_switch', 'require_payment_ref', 'tier2_above', 'approval_ttl', 'risk_tiers'],
                    },
                    value: { description: 'Policy value (null to clear)' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Policy updated.' },
            400: { description: 'Invalid policy type or value.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Demo key or wrong proof.' },
          },
        },
      },
      '/v1/agents/{agent_id}/book/export': {
        get: {
          operationId: 'exportBookGet',
          summary: 'Export book for accounting / audit',
          description:
            'Possession-gated export of ledger rows (not live wallet scrape). '
            + 'format=csv (default), json (audit pack), or html (print to PDF). '
            + 'Each row includes evidence: collected | RECORDED_BY_SETTLE | ARRIVAL_UNVERIFIED | inflow_claimed | UNVERIFIED | policy_blocked.',
          tags: ['Agents'],
          parameters: [
            { name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json', 'html'], default: 'csv' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } },
          ],
          responses: {
            200: { description: 'CSV, JSON audit pack, or print HTML.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Wrong proof or unknown agent_id.' },
          },
        },
        post: {
          operationId: 'exportBookPost',
          summary: 'Export book for accounting / audit (POST)',
          description: 'Same as GET; session in body or X-XFuel-Session header.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    session: { type: 'string' },
                    format: { type: 'string', enum: ['csv', 'json', 'html'], default: 'csv' },
                    limit: { type: 'integer', maximum: 200 },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'CSV, JSON audit pack, or print HTML.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Wrong proof or unknown agent_id.' },
          },
        },
      },
      '/v1/agents/{agent_id}/book/assign': {
        get: {
          operationId: 'listBookAssignments',
          summary: 'List assignments for agent',
          description: 'List all slice assignments created by this agent. Possession-gated.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'List of assignments.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Wrong proof or unknown agent_id.' },
          },
        },
        post: {
          operationId: 'createBookAssignment',
          summary: 'Create a slice assignment',
          description:
            'Grant read or collect access to a slice of the book to another party. '
            + 'Slice defined by from_date, to_date, task_ids, or limit. Demo keys cannot create.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    grant_type: { type: 'string', enum: ['read', 'collect'], default: 'read' },
                    grantee: { type: 'string', nullable: true },
                    slice: {
                      type: 'object',
                      properties: {
                        from_date: { type: 'string', format: 'date-time' },
                        to_date: { type: 'string', format: 'date-time' },
                        task_ids: { type: 'array', items: { type: 'string' } },
                        limit: { type: 'integer' },
                      },
                    },
                    expires_at: { type: 'string', format: 'date-time', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Assignment created. Contains token for grantee access.' },
            400: { description: 'Invalid slice or grant_type.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Demo key or wrong proof.' },
          },
        },
      },
      '/v1/agents/{agent_id}/book/assign/{assignment_id}': {
        delete: {
          operationId: 'revokeBookAssignment',
          summary: 'Revoke an assignment',
          description: 'Revoke a previously created assignment. Possession-gated.',
          tags: ['Agents'],
          parameters: [
            { name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'assignment_id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Assignment revoked.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Wrong proof or unknown agent_id.' },
            404: { description: 'Assignment not found.' },
          },
        },
      },
      '/v1/book/slice': {
        get: {
          operationId: 'readBookSlice',
          summary: 'Read a slice by assignment token',
          description:
            'Read entries from a slice using an assignment token. Token IS the access credential. '
            + 'Does not require possession — the token was issued by the possession holder.',
          tags: ['Agents'],
          parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Slice entries.' },
            401: { description: 'Token required.' },
            403: { description: 'Invalid or expired token.' },
          },
        },
      },
      '/v1/agents/{agent_id}/book/dispute': {
        get: {
          operationId: 'listBookDisputes',
          summary: 'List disputes for agent',
          description: 'List all disputes filed by this agent. Possession-gated.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'List of disputes.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Wrong proof or unknown agent_id.' },
          },
        },
        post: {
          operationId: 'fileBookDispute',
          summary: 'File a dispute',
          description:
            'File a dispute for a task. claim_type: output_missing, wrong_model, double_charge. '
            + 'Rechecks payment binding + output hash. Outcome: refund, partial, or stand. '
            + 'For A2A, lineage is the evidence pack. Demo keys cannot file disputes.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['task_id', 'claim_type'],
                  properties: {
                    task_id: { type: 'string' },
                    claim_type: { type: 'string', enum: ['output_missing', 'wrong_model', 'double_charge'] },
                    evidence: { type: 'object', description: 'e.g. { requested_model: "..." } for wrong_model' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Dispute filed and auto-adjudicated if possible.' },
            400: { description: 'Invalid claim_type or missing task_id.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Demo key or wrong proof.' },
          },
        },
      },
      '/v1/agents/{agent_id}/book/escrow': {
        post: {
          operationId: 'bookEscrowHelper',
          summary: 'Ledger escrow helper (high-value jobs)',
          description:
            'Possession-gated ledger escrow beside the book. Hold signal = collected x402 receipt '
            + 'already on the book (not an on-chain escrow contract in v1). '
            + 'Actions: open (record intent + required output hash and/or proof tier), '
            + 'release (principal satisfied — verifies settlement metadata, not closed-weight model), '
            + 'clawback (ties into dispute claim_types — stand vs refund instruction), '
            + 'status. Demo keys rejected.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['action'],
                  properties: {
                    action: { type: 'string', enum: ['open', 'release', 'clawback', 'status'] },
                    task_id: { type: 'string', description: 'Required for open; optional lookup for status/release/clawback' },
                    escrow_id: { type: 'string' },
                    amount: { type: 'string', description: 'USDC atomic units — optional validation against ledger' },
                    expires_at: { type: 'string', format: 'date-time' },
                    required: {
                      type: 'object',
                      properties: {
                        output_hash: { type: 'string' },
                        proof_tier: { type: 'string', enum: ['settlement', 'inference'] },
                      },
                    },
                    claim_type: { type: 'string', enum: ['output_missing', 'wrong_model', 'double_charge'] },
                    evidence: { type: 'object' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Escrow action completed (release/clawback/status).' },
            201: { description: 'Escrow opened.' },
            400: { description: 'Invalid action or release checks failed.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Demo key or wrong proof.' },
            404: { description: 'Escrow not found.' },
          },
        },
      },
      '/v1/agents/{agent_id}/book/webhook': {
        get: {
          operationId: 'getBookWebhook',
          summary: 'Get treasury webhook config (redacted)',
          description:
            'Possession-gated read of the per-agent book webhook. Returns url_host, enabled, events, '
            + 'and delivery stats — never the full URL or secret after create. '
            + 'Register once; rows push automatically (not request-per-row).',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: {
              description: 'Webhook config or null if unset.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      agent_id: { type: 'integer' },
                      webhook: { ...AGENTS_BOOK_WEBHOOK_CONFIG_SCHEMA, nullable: true },
                      supported_events: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
            401: { description: 'No possession proof.' },
            403: { description: 'Wrong proof or unknown agent_id.' },
          },
        },
        put: {
          operationId: 'putBookWebhook',
          summary: 'Register or update treasury webhook',
          description:
            'Possession-gated PUT of HTTPS webhook URL + optional secret/events filter. '
            + 'When a book row lands (settle, inflow, policy_blocked, collected), the gateway POSTs '
            + 'a signed chit402.book_webhook.v1 envelope. Headers: X-Chit-Signature (alias X-XFuel-Signature).',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: AGENTS_BOOK_WEBHOOK_INPUT_SCHEMA } },
          },
          responses: {
            200: {
              description: 'Webhook registered. secret_once present only when server generated the secret.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      agent_id: { type: 'integer' },
                      webhook: AGENTS_BOOK_WEBHOOK_CONFIG_SCHEMA,
                      secret_once: { type: 'string', description: 'Shown once when auto-generated.' },
                      supported_events: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
            400: { description: 'Invalid URL, event, or non-HTTPS.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Wrong proof or unknown agent_id.' },
          },
        },
        post: {
          operationId: 'postBookWebhook',
          summary: 'Register or update treasury webhook (POST)',
          description: 'Same as PUT; session in body or X-XFuel-Session header.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: AGENTS_BOOK_WEBHOOK_INPUT_SCHEMA } },
          },
          responses: {
            200: { description: 'Webhook registered.' },
            400: { description: 'Invalid URL or events.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Wrong proof or unknown agent_id.' },
          },
        },
        delete: {
          operationId: 'deleteBookWebhook',
          summary: 'Clear treasury webhook',
          description: 'Possession-gated DELETE — stops push delivery for this agent_id.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'Webhook removed.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Wrong proof or unknown agent_id.' },
          },
        },
      },
      '/v1/agents/{agent_id}/book/rotate': {
        post: {
          operationId: 'rotateBookSession',
          summary: 'Rotate session',
          description:
            'Rotate the possession session. Old session becomes invalid. Book (entries) stays — '
            + 'tied to agent_id, not session. payer_wallet ↔ payment.ref bindings on ledger rows '
            + 'and public /receipt/:taskId survive rotate without dashboard trust.',
          tags: ['Agents'],
          parameters: [{ name: 'agent_id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'New session issued.' },
            400: { description: 'Session mismatch.' },
            401: { description: 'No possession proof.' },
            403: { description: 'Demo key or wrong proof.' },
          },
        },
      },
      '/receipt/{taskId}': {
        get: {
          operationId: 'getReceipt',
          summary: 'Public receipt (no auth)',
          description:
            'Public, no-auth verifiable receipt. Returns HTML by default (shareable link), '
            + 'JSON via ?format=json or Accept: application/json (for agents), or auditor '
            + 'selective disclosure via ?format=auditor. Anyone can independently verify "paid + proven" '
            + 'using the verify_url. No secrets exposed (no proof bytes, no raw output, no keys).',
          tags: ['Receipts'],
          parameters: [
            { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['json', 'auditor'] },
              description: 'Response format: json (machine), auditor (policy + totals), or HTML (default)',
            },
          ],
          responses: {
            200: { description: 'Receipt (HTML or JSON based on Accept or ?format)' },
            404: { description: 'Task not found' },
          },
        },
      },
      '/receipt/by-tx': {
        get: {
          operationId: 'getReceiptByTx',
          summary: 'Lookup receipt by transaction signature',
          description:
            'Redirect to the canonical /receipt/{taskId} URL given a payment transaction signature. '
            + 'Supports Solana tx signatures and Base transaction hashes. Enables receipt lookup '
            + 'when the caller has the tx but not the task ID.',
          tags: ['Receipts'],
          parameters: [
            {
              name: 'tx',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Transaction signature (Solana) or transaction hash (Base)',
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['json', 'auditor'] },
              description: 'Format to pass through to the redirect target',
            },
          ],
          responses: {
            302: { description: 'Redirect to /receipt/{taskId}' },
            400: { description: 'Missing tx query parameter' },
            404: { description: 'No task found for this transaction' },
          },
        },
      },
      '/public/specimens/hemei-stranger-export.csv': {
        get: {
          operationId: 'getHemeiStrangerExportCsv',
          summary: 'Redacted book export CSV specimen (stranger-auditable)',
          description:
            'Public, unauthenticated redacted CSV matching /v1/agents/{agent_id}/book/export shape. '
            + 'No live session tokens. See docs/product/hemei-stranger-specimens.md.',
          tags: ['Specimens'],
          responses: {
            200: { description: 'Redacted CSV export specimen.' },
            404: { description: 'Unknown specimen.' },
          },
        },
      },
      '/public/specimens/hemei-stranger-export.json': {
        get: {
          operationId: 'getHemeiStrangerExportJson',
          summary: 'Redacted book audit pack JSON specimen (stranger-auditable)',
          description:
            'Public chit402.book_audit.v1 specimen with evidence, inflow_claim, and payment_ref fields. '
            + 'No live session tokens. See docs/product/hemei-stranger-specimens.md.',
          tags: ['Specimens'],
          responses: {
            200: { description: 'Redacted JSON audit pack specimen.' },
            404: { description: 'Unknown specimen.' },
          },
        },
      },
      '/public/specimens/hemei-path-rotate-observe.json': {
        get: {
          operationId: 'getHemeiPathRotateObserve',
          summary: 'Path-rotate observation fixture',
          description:
            'Observation-only JSON proving payer_wallet ↔ payment.ref survive session rotate. '
            + 'POST /book/rotate remains possession-gated. See docs/product/hemei-stranger-specimens.md.',
          tags: ['Specimens'],
          responses: {
            200: { description: 'Path-rotate observe fixture.' },
            404: { description: 'Unknown specimen.' },
          },
        },
      },
      '/public/export/{slug}': {
        get: {
          operationId: 'getPublicPullExport',
          summary: 'Signed public pull-export for treasury desks',
          description:
            'Stranger-GET signed envelope for next-wake treasury pull (hemei test3). '
            + 'Document matches /v1/agents/{agent_id}/book/export columns. '
            + 'Verify issuer_signature.jws against GET /.well-known/jwks.json (re-fetch ~2h). '
            + 'Possession-gated /book/export unchanged. See docs/product/public-pull-export.md.',
          tags: ['Specimens'],
          parameters: [
            {
              name: 'slug',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['hemei-treasury'] },
              description: 'Stable pull-export slug.',
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['json', 'csv'], default: 'json' },
              description: 'Document shape inside the signed envelope.',
            },
          ],
          responses: {
            200: {
              description: 'Signed pull-export envelope (chit402.book_pull_export.v1).',
              content: {
                'application/json': { schema: PUBLIC_PULL_EXPORT_ENVELOPE_SCHEMA },
              },
            },
            404: { description: 'Unknown pull-export slug.' },
          },
        },
      },
    },
  };

  if (base) spec.servers = [{ url: base }];
  return spec;
}

export default { buildX402Manifest, buildOpenApiSpec };
