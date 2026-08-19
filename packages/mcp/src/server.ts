/**
 * Builds a fully-configured McpServer instance with all XFuel tools registered.
 *
 * A factory (not a singleton) so the HTTP transport can create a fresh server
 * per request — the recommended stateless pattern that avoids request-id
 * collisions and cross-request state bleed.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XFuelClient } from 'xfuel-sdk';
import { SERVER_NAME, SERVER_VERSION, SERVER_INSTRUCTIONS, type McpConfig } from './config.js';
import { registerTools } from './tools.js';

export function buildServer(config: McpConfig): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const client = new XFuelClient({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
  });

  registerTools(server, { client, config });
  return server;
}
