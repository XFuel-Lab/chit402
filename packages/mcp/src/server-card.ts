/**
 * Static MCP server card (Smithery convention: `/.well-known/mcp/server-card.json`).
 *
 * Aggregators (Smithery, Glama, PulseMCP) index MCP servers by scanning them for
 * tool/resource metadata. When a server sits behind auth or requires configuration,
 * scanning can't complete — so a static server card lets us publish accurate metadata
 * directly. We serve it from the HTTP transport so a listing reflects the real tool
 * surface without any manual re-entry. See docs/DISTRIBUTION.md.
 *
 * The canonical listing remains the official MCP Registry entry (server.json); this
 * card is the belt-and-suspenders path for scan-based directories.
 */
import { SERVER_VERSION, type McpConfig } from './config.js';

/** The tool surface, kept in lockstep with registerTools() in tools.ts. */
const TOOLS: Array<{ name: string; description: string }> = [
  { name: 'chat_completions', description: 'Unmetered OpenAI-compatible chat (POST /v1/chat/completions). Required: messages.' },
  { name: 'list_models', description: 'List routable inference models (hub, pricing, availability).' },
  { name: 'submit_inference', description: 'Paid POST /task-request. 402 without a payer. Not the demo path.' },
  { name: 'register_agent', description: 'POST /v1/agents/register. Bind agentWallet + collected receipt → agent_id.' },
  { name: 'get_task_status', description: 'Poll a task (from chat_completions or submit_inference) to a terminal status.' },
  { name: 'get_proof', description: 'Fetch the SP1 ZK settlement proof + fee/revenue split for a settled task.' },
  { name: 'verify_proof', description: 'Verify proof integrity + payment binding; optional on-chain nullifier (replay) read.' },
  { name: 'quote_task', description: 'Price a paid task per rail before submitting.' },
  { name: 'get_health', description: 'Server health, fee config, and demo limits.' },
  { name: 'get_my_stats', description: 'Usage for the configured API key (demo key is shared).' },
  { name: 'verify_model_commitment', description: 'Check a model against its on-chain authenticity commitment (PoMA).' },
  { name: 'get_verified_quote', description: 'Price a task + the assurance tiers available (signed/settlement).' },
  { name: 'get_validation_status', description: 'Read an ERC-8004 validation record by requestHash.' },
  { name: 'get_provider_stake', description: 'Read a provider stake + slash history.' },
];

/**
 * Build the static server card. `mcpEndpoint` is the absolute URL of the POST /mcp
 * endpoint (streamable HTTP), derived from the request when served.
 */
export function buildServerCard(config: McpConfig, mcpEndpoint: string) {
  return {
    name: 'io.github.XFuel-Lab/xfuel-mcp',
    title: 'XFuel',
    description:
      'Generate text via chat_completions, submit a paid USDC task, or register_agent. ' +
      'Every call yields a public verify_url receipt. Hostname may say testnet; paying is Base mainnet USDC.',
    version: SERVER_VERSION,
    websiteUrl: 'https://github.com/XFuel-Lab/xfuel-protocol/tree/main/xfuel-mcp#readme',
    repository: {
      url: 'https://github.com/XFuel-Lab/xfuel-protocol',
      source: 'github',
      subfolder: 'xfuel-mcp',
    },
    transport: { type: 'streamable-http', url: mcpEndpoint },
    capabilities: { tools: true, resources: false, prompts: false },
    tools: TOOLS,
    metadata: {
      xfuel_api: config.apiUrl,
      registry: 'https://registry.modelcontextprotocol.io',
      npm: 'https://www.npmjs.com/package/xfuel-mcp',
      tags: ['ai', 'inference', 'x402', 'usdc', 'zk-proof', 'payments', 'settlement'],
    },
  };
}

export default { buildServerCard };
