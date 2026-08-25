/**
 * A2A v1.0 Agent Card for GET /.well-known/agent-card.json
 *
 * Shape: name, description, supportedInterfaces, version, capabilities,
 * defaultInputModes, defaultOutputModes, skills (tags required).
 */

import { XFUEL_ICON_URL } from './xfuel-icon.js';

/**
 * @param {string} [baseUrl]
 */
export function buildAgentCard(baseUrl = '') {
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  const abs = (p) => (base ? `${base}${p}` : p);

  return {
    name: 'XFuel',
    description:
      'Crypto control plane for AI compute. Paid door is POST /v1/chat/completions '
      + 'at $0.01 USDC on Base (eip155:8453) and Solana. Register an agent identity '
      + 'at POST /v1/agents/register with a collected HMAC-valid receipt and an '
      + 'AAWP official or smart-account agentWallet. Returns integer agent_id for '
      + 'POST /erc8004/validate. POST /a2a-message is the HTTP+JSON A2A surface.',
    supportedInterfaces: [
      {
        url: abs('/a2a-message'),
        protocolBinding: 'HTTP+JSON',
        protocolVersion: '1.0',
      },
    ],
    provider: {
      organization: 'XFuel',
      url: 'https://xfuel.app',
    },
    version: '1.0.0',
    documentationUrl: abs('/llms.txt'),
    iconUrl: XFUEL_ICON_URL,
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
          'OpenAI-compatible POST /v1/chat/completions. $0.01 USDC on Base and Solana. '
          + 'Unauthenticated GET or POST {} returns HTTP 402.',
        tags: ['llm', 'openai-compatible', 'x402', 'usdc'],
        examples: ['POST /v1/chat/completions with { model, messages }'],
      },
      {
        id: 'register-agent',
        name: 'Register agent identity',
        description:
          'POST /v1/agents/register binds an AAWP official or smart-account agentWallet '
          + 'to an integer agent_id using a collected HMAC-valid receipt.',
        tags: ['identity', 'erc8004', 'a2a'],
        examples: ['POST /v1/agents/register with { agentWallet, task_id }'],
      },
      {
        id: 'agent-book',
        name: 'Agent spend book',
        description:
          'GET|POST /v1/agents/:agent_id/book returns last-N collected spend for that agent_id. '
          + 'Possession-gated (register session or HMAC). Not a public index.',
        tags: ['identity', 'spend'],
        examples: ['POST /v1/agents/1/book with { session }'],
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
        id: 'a2a-message',
        name: 'A2A message',
        description:
          'POST /a2a-message sends an agent-to-agent message (message_type, chains, payload_hash, ttl, sender_address, sender_identity).',
        tags: ['a2a'],
        examples: ['POST /a2a-message with capability_query and zero escrow'],
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
