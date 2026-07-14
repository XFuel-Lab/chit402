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
  { name: 'submit_inference', description: 'Submit an AI inference task (default/TFUEL rail). Returns task_id + a public verify_url.' },
  { name: 'pay_with_usdc', description: 'Submit + pay for a task in USDC via x402 (needs a payer key). Returns task_id, payment_ref, verify_url.' },
  { name: 'get_task_status', description: 'Poll a task to a terminal status + proof outcome. Returns verify_url.' },
  { name: 'get_proof', description: 'Fetch the SP1 ZK settlement proof + fee/revenue split for a settled task.' },
  { name: 'verify_proof', description: 'Verify proof integrity + payment binding; optional on-chain nullifier (replay) read.' },
  { name: 'quote_task', description: 'Price a task per rail (USDC via x402 / TFUEL) before submitting.' },
  { name: 'get_health', description: 'Server health, fee config, and demo limits.' },
  { name: 'list_models', description: 'List routable inference models.' },
];

/**
 * Build the static server card. `mcpEndpoint` is the absolute URL of the POST /mcp
 * endpoint (streamable HTTP), derived from the request when served.
 */
export function buildServerCard(config: McpConfig, mcpEndpoint: string) {
  return {
    // Match the official MCP Registry namespace so directories can de-dupe/claim.
    name: 'io.github.XFuel-Lab/xfuel-mcp',
    title: 'XFuel',
    description:
      'Verifiable settlement + payments layer for AI compute. Submit AI inference, pay ' +
      'per task (USDC via x402 or TFUEL), fetch/verify ZK settlement proofs — from any ' +
      'MCP client. Every task yields a public, shareable verify_url receipt.',
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
      tags: ['ai', 'inference', 'x402', 'usdc', 'zk-proof', 'payments', 'settlement', 'depin', 'theta'],
    },
  };
}

export default { buildServerCard };
