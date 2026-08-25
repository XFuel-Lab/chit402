/**
 * Configuration resolution for xfuel-mcp.
 *
 * Precedence (highest first): CLI flags → environment variables → sensible
 * defaults (XFuel hosted public beta + public demo key). Nothing is required.
 */
import { DEFAULT_BASE_URL, PUBLIC_DEMO_API_KEY } from 'xfuel-sdk';

export const SERVER_NAME = 'xfuel-mcp-server';
// Keep in lockstep with package.json / server.json (registry listing) so the
// version reported over MCP, on /health, and in the static server card matches
// the published npm package.
export const SERVER_VERSION = '0.3.1';

/** Handshake text so a first-hour client does not need GitHub. */
export const SERVER_INSTRUCTIONS = `XFuel first-hour: call list_models, then chat_completions to generate text (POST /v1/chat/completions). Default model xfuel/auto. The demo key xfuel-demo is shared and rate-limited (15/min, 150/day).

submit_inference is the paid M2M door (POST /task-request). It requires model + sender + amount, forwards messages/input when provided, and returns HTTP 402 without a payer.

register_agent is POST /v1/agents/register. It binds an AAWP official or smart-account agentWallet to an integer agent_id using a collected HMAC-valid receipt. Demo receipts do not qualify. Do not paste a human private key.

get_agent_book is GET|POST /v1/agents/:agent_id/book. Possession-gated last-N collected spend for that agent_id. Not a public index. Do not paste a human private key.

Amounts are USDC 6 decimals (10000 = $0.01), not wei. api.xfuel.app is the public beta; paying it moves mainnet USDC.`;

export type TransportKind = 'stdio' | 'http';

export interface McpConfig {
  /** XFuel API base URL the tools call. */
  apiUrl: string;
  /** API key sent as X-API-Key. */
  apiKey: string;
  /** Transport to serve. */
  transport: TransportKind;
  /** HTTP port (http transport only). */
  port: number;
  /** Optional bearer token required on the HTTP endpoint. */
  httpAuthToken?: string;
  /** Optional RPC URL for the verify_proof on-chain nullifier read. */
  rpcUrl?: string;
  /** Optional ZKVerifierSP1 address (paired with rpcUrl). */
  zkVerifierAddress?: string;
  /** Optional ModelRegistry address (paired with rpcUrl) for PoMA model-authenticity reads. */
  modelRegistryAddress?: string;
  /** Optional ERC-8004 Validation Registry address (paired with rpcUrl) for validation reads. */
  erc8004RegistryAddress?: string;
  /** Optional ProviderStaking address (paired with rpcUrl) for provider stake/slash reads. */
  providerStakingAddress?: string;
}

export interface ParsedArgs {
  config: McpConfig;
  /** Set when --help / --version short-circuited normal startup. */
  action?: 'help' | 'version';
}

const HELP = `xfuel-mcp — Model Context Protocol server for the XFuel Protocol

USAGE
  xfuel-mcp [options]

TRANSPORT
  --stdio                 Serve over stdio (default; for Claude Desktop / Cursor)
  --http                  Serve over streamable HTTP (for remote / shared use)
  --port <n>              HTTP port (default 3033; http only)

XFUEL API
  --api-url <url>         XFuel API base URL (default: hosted public beta)
  --api-key <key>         API key / X-API-Key (default: public demo key "xfuel-demo")

MISC
  -h, --help              Show this help
  -v, --version           Print version

ENVIRONMENT (CLI flags take precedence)
  XFUEL_API_URL, XFUEL_API_KEY, XFUEL_MCP_TRANSPORT, XFUEL_MCP_PORT,
  XFUEL_MCP_AUTH_TOKEN, XFUEL_RPC_URL, ZK_VERIFIER_ADDRESS, MODEL_REGISTRY_ADDRESS

EXAMPLES
  npx xfuel-mcp                         # stdio, hosted public beta
  npx xfuel-mcp --http --port 3033      # streamable HTTP on :3033
  XFUEL_API_KEY=sk_live... npx xfuel-mcp
`;

export function helpText(): string {
  return HELP;
}

function envTransport(): TransportKind | undefined {
  const t = process.env.XFUEL_MCP_TRANSPORT?.toLowerCase();
  return t === 'http' || t === 'stdio' ? t : undefined;
}

/**
 * Parse argv + env into a resolved config. Pure (except reading process.env),
 * so it is unit-testable. `argv` should exclude the node/script prefix.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let transport: TransportKind = envTransport() ?? 'stdio';
  let port = Number(process.env.XFUEL_MCP_PORT) || 3033;
  let apiUrl = process.env.XFUEL_API_URL || DEFAULT_BASE_URL;
  let apiKey = process.env.XFUEL_API_KEY || PUBLIC_DEMO_API_KEY;
  let action: 'help' | 'version' | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--stdio':
        transport = 'stdio';
        break;
      case '--http':
        transport = 'http';
        break;
      case '--port':
        port = Number(argv[++i]) || port;
        break;
      case '--api-url':
        apiUrl = argv[++i] ?? apiUrl;
        break;
      case '--api-key':
        apiKey = argv[++i] ?? apiKey;
        break;
      case '-h':
      case '--help':
        action = 'help';
        break;
      case '-v':
      case '--version':
        action = 'version';
        break;
      default:
        // Ignore unknown flags rather than crash a long-lived server.
        break;
    }
  }

  return {
    action,
    config: {
      apiUrl,
      apiKey,
      transport,
      port,
      httpAuthToken: process.env.XFUEL_MCP_AUTH_TOKEN || undefined,
      rpcUrl: process.env.XFUEL_RPC_URL || undefined,
      zkVerifierAddress: process.env.ZK_VERIFIER_ADDRESS || undefined,
      modelRegistryAddress: process.env.MODEL_REGISTRY_ADDRESS || undefined,
      erc8004RegistryAddress: process.env.ERC8004_VALIDATION_REGISTRY || undefined,
      providerStakingAddress: process.env.PROVIDER_STAKING_ADDRESS || undefined,
    },
  };
}
