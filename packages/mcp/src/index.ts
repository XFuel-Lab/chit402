#!/usr/bin/env node
/**
 * xfuel-mcp — Model Context Protocol server for the XFuel Protocol.
 *
 * Exposes XFuel's core capabilities (submit_inference, get_task_status,
 * get_proof, verify_proof, quote_task, get_health) as MCP tools, over either
 * stdio (local clients) or streamable HTTP (remote/shared).
 *
 * IMPORTANT: on stdio, stdout is the JSON-RPC channel — all logging must go to
 * stderr (console.error). Do not console.log on stdio.
 */
import express, { type Request, type Response } from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { parseArgs, helpText, SERVER_VERSION, type McpConfig } from './config.js';
import { buildServer } from './server.js';
import { buildServerCard } from './server-card.js';

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

/** Local, process-spawned integration (Claude Desktop, Cursor, etc.). */
async function runStdio(config: McpConfig): Promise<void> {
  const server = buildServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[xfuel-mcp] stdio transport ready → ${config.apiUrl}`);
}

/** Remote / shared integration over streamable HTTP (stateless per request). */
async function runHttp(config: McpConfig): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const requireAuth = (req: Request, res: Response): boolean => {
    if (!config.httpAuthToken) return true;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token !== config.httpAuthToken) {
      jsonRpcError(res, 401, -32001, 'Unauthorized: missing or invalid bearer token');
      return false;
    }
    return true;
  };

  // Liveness / discovery (not part of the MCP protocol).
  app.get(['/', '/health'], (_req, res) => {
    res.json({
      name: 'xfuel-mcp',
      version: SERVER_VERSION,
      transport: 'streamable-http',
      mcp_endpoint: '/mcp',
      server_card: '/.well-known/mcp/server-card.json',
      xfuel_api: config.apiUrl,
    });
  });

  // Static MCP server card (Smithery convention) — lets scan-based aggregators
  // index accurate metadata without completing a live scan. Public, no auth.
  app.get('/.well-known/mcp/server-card.json', (req: Request, res: Response) => {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const mcpEndpoint = host ? `${proto}://${host}/mcp` : '/mcp';
    res.json(buildServerCard(config, mcpEndpoint));
  });

  // MCP endpoint — a fresh server + transport per request (stateless).
  app.post('/mcp', async (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    const server = buildServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[xfuel-mcp] request error:', err);
      if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
    }
  });

  // Stateless server: no long-lived GET stream or session teardown.
  app.get('/mcp', (_req, res) => jsonRpcError(res, 405, -32000, 'Method not allowed (stateless server; use POST /mcp)'));
  app.delete('/mcp', (_req, res) => jsonRpcError(res, 405, -32000, 'Method not allowed'));

  await new Promise<void>((resolve) => {
    app.listen(config.port, () => {
      console.error(
        `[xfuel-mcp] streamable HTTP ready on http://localhost:${config.port}/mcp → ${config.apiUrl}` +
          (config.httpAuthToken ? ' (bearer auth ON)' : ''),
      );
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const { config, action } = parseArgs(process.argv.slice(2));

  if (action === 'help') {
    process.stdout.write(helpText());
    return;
  }
  if (action === 'version') {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  if (config.transport === 'http') {
    await runHttp(config);
  } else {
    await runStdio(config);
  }
}

main().catch((err) => {
  console.error('[xfuel-mcp] fatal:', err);
  process.exit(1);
});
