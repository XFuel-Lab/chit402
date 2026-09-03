/**
 * A2A v1.0 Agent Card for GET /.well-known/agent-card.json
 *
 * Shape: name, description, supportedInterfaces, version, capabilities,
 * defaultInputModes, defaultOutputModes, skills (tags required).
 */

import { buildIconUrl } from './xfuel-icon.js';

/**
 * @param {string} [baseUrl]
 */
export function buildAgentCard(baseUrl = '') {
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  const abs = (p) => (base ? `${base}${p}` : p);

  return {
    name: 'Chit',
    description:
      'Chit is the book. This agent spent Y on this job. You hold hub, model, and amount. '
      + 'No account. No API key. A wallet that can pay the 402 is enough. '
      + 'Register is only to hold the book after a collected receipt. '
      + 'POST /v1/chat/completions returns a signed receipt: hub, model, amount, verify_url. '
      + 'Cost-plus, quoted, receipted — USDC on Base (eip155:8453) or Solana. '
      + 'POST /a2a-message is the same paid door (A2A HTTP+JSON URL). '
      + 'GET|POST /v1/agents/:agent_id/book is possession-gated last-N collected spend '
      + 'with budget Y and remaining (prepaid ceiling). POST /v1/agents/register is fail-closed: '
      + 'collected HMAC-valid receipt plus an AAWP official or smart-account agentWallet. '
      + 'Returns integer agent_id for POST /erc8004/validate.',
    supportedInterfaces: [
      {
        url: abs('/a2a-message'),
        protocolBinding: 'HTTP+JSON',
        protocolVersion: '1.0',
      },
    ],
    provider: {
      organization: 'Chit',
      url: 'https://chit402.com',
    },
    version: '1.0.0',
    documentationUrl: abs('/llms.txt'),
    iconUrl: buildIconUrl(base),
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'chat-completions',
        name: 'Paid chat completions',
        description:
          'POST /v1/chat/completions (bot drop-in). Returns a signed receipt: hub, model, '
          + 'amount, verify_url. Cost-plus, quoted, receipted — USDC on Base or Solana. '
          + 'No account. No API key. A wallet that can pay the 402 is enough. '
          + 'Unauthenticated GET or POST {} returns HTTP 402. You hold hub, model, and amount.',
        tags: ['llm', 'openai-compatible', 'x402', 'usdc'],
        examples: ['POST /v1/chat/completions with { model, messages }'],
      },
      {
        id: 'responses',
        name: 'Paid responses API',
        description:
          'POST /v1/responses (bot drop-in). Same x402 + signed receipt as /v1/chat/completions. '
          + 'Accepts input (string or message array), max_output_tokens. '
          + 'Returns Responses-shaped output + Chit receipt with verify_url. '
          + 'Stateless one-shot. Unauthenticated → HTTP 402.',
        tags: ['llm', 'responses-api', 'x402', 'usdc'],
        examples: ['POST /v1/responses with { model, input: "Hello" }'],
      },
      {
        id: 'a2a-message',
        name: 'A2A paid door',
        description:
          'POST /a2a-message is the A2A card URL. Same x402 floor and chat fulfillment as '
          + '/v1/chat/completions. Returns a signed receipt: hub, model, amount, verify_url. '
          + 'No account. No API key. A wallet that can pay the 402 is enough. '
          + 'You hold hub, model, and amount. Unauthenticated POST {} returns HTTP 402. '
          + 'Collected rows are bookable via GET|POST /v1/agents/:agent_id/book.',
        tags: ['a2a', 'x402', 'usdc', 'llm'],
        examples: ['POST /a2a-message with { model, messages } — same body as /v1/chat/completions'],
      },
      {
        id: 'register-agent',
        name: 'Register agent identity',
        description:
          'POST /v1/agents/register is fail-closed: bind an AAWP official or smart-account '
          + 'agentWallet to an integer agent_id using a collected HMAC-valid receipt. '
          + 'Demo receipts do not qualify.',
        tags: ['identity', 'erc8004', 'a2a'],
        examples: ['POST /v1/agents/register with { agentWallet, task_id }'],
      },
      {
        id: 'agent-book',
        name: 'Agent spend book',
        description:
          'GET|POST /v1/agents/:agent_id/book returns last-N collected spend for that agent_id, '
          + 'plus budget Y (cap), spent, and remaining under a prepaid ceiling. '
          + 'Possession-gated (register session or HMAC). Set budget with POST { session, budget }. '
          + 'Not a public index. You hold hub, model, and amount.',
        tags: ['identity', 'spend'],
        examples: [
          'POST /v1/agents/1/book with { session }',
          'POST /v1/agents/1/book with { session, budget: "10000" }',
        ],
      },
      {
        id: 'erc8004-validate',
        name: 'ERC-8004 validate',
        description:
          'POST /erc8004/validate turns a settled receipt into a score (0–100) for a registered agent_id.',
        tags: ['erc8004', 'validation'],
        examples: ['POST /erc8004/validate with { task_id, request_hash, agent_id }'],
      },
      {
        id: 'models',
        name: 'Model catalog',
        description: 'GET /v1/models lists the live catalog. Public, no key.',
        tags: ['catalog', 'openai-compatible'],
        examples: ['GET /v1/models'],
      },
    ],
    securitySchemes: {
      apiKey: {
        apiKeySecurityScheme: {
          location: 'header',
          name: 'X-API-Key',
          description: 'API key. Not a wallet. Demo key xfuel-demo skips payment on chat; it does not qualify register.',
        },
      },
    },
    security: [{ apiKey: [] }],
  };
}
