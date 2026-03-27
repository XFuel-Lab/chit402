#!/usr/bin/env node
/**
 * scripts/register-mcp-tool.cjs
 *
 * Registers XFuel as an MCP tool with a Theta-compatible MCP server.
 *
 * The Theta EdgeCloud MCP server (@thetalabs/on-demand-api-mcp) exposes a
 * /tools registration endpoint. Once registered, any MCP-compatible agent
 * (Claude Desktop, Cursor, Cline, custom agents) can discover and call
 * xfuel_submit_intent, xfuel_poll_status, and xfuel_router_status as native
 * tools — no custom integration code needed.
 *
 * Usage:
 *   # Register with local MCP server (dev)
 *   node scripts/register-mcp-tool.cjs
 *
 *   # Register with a specific endpoint
 *   MCP_ENDPOINT=http://localhost:3001 node scripts/register-mcp-tool.cjs
 *
 *   # Register with Theta's hosted MCP gateway (production)
 *   MCP_ENDPOINT=https://mcp.thetaedgecloud.com \
 *   MCP_API_KEY=<your-key> \
 *   XFUEL_AGENT_API=https://api.xfuel.app \
 *   node scripts/register-mcp-tool.cjs
 *
 * Environment variables:
 *   MCP_ENDPOINT       MCP server base URL (default: http://localhost:3001)
 *   MCP_API_KEY        Bearer token for MCP server auth (optional)
 *   XFUEL_AGENT_API    XFuel agent API base URL (default: http://localhost:3000)
 *
 * Exit codes:
 *   0 — all tools registered successfully
 *   1 — one or more registrations failed
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// Load environment (try .env.local first, then .env)
for (const f of ['.env.local', '.env']) {
  const p = path.resolve(__dirname, '..', f);
  if (fs.existsSync(p)) {
    require('dotenv').config({ path: p });
    break;
  }
}

const MCP_ENDPOINT    = process.env.MCP_ENDPOINT    || 'http://localhost:3001';
const MCP_API_KEY     = process.env.MCP_API_KEY     || '';
const XFUEL_AGENT_API = process.env.XFUEL_AGENT_API || 'http://localhost:3000';
const DRY_RUN         = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');

// Load the tool descriptor
const descriptorPath = path.resolve(__dirname, 'theta-mcp-tool-descriptor.json');
if (!fs.existsSync(descriptorPath)) {
  console.error(`[MCP Register] Descriptor not found: ${descriptorPath}`);
  process.exit(1);
}

const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));

// Rewrite tool endpoints to point to the configured XFUEL_AGENT_API
// This lets the same descriptor work across dev / staging / prod
function buildToolRegistration(tool) {
  const endpoint = tool.endpoint || {};
  return {
    name:         tool.name,
    description:  tool.description,
    inputSchema:  tool.inputSchema,
    outputSchema: tool.outputSchema,
    endpoint: {
      ...endpoint,
      url: `${XFUEL_AGENT_API}${endpoint.path || ''}`,
    },
    examples: tool.examples || [],
    version: '1.0.0',
    provider: 'XFuel Protocol',
    tags: ['depin', 'ai', 'theta', 'inference', 'zk'],
  };
}

async function registerTool(tool) {
  const payload = buildToolRegistration(tool);

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would register: ${tool.name}`);
    console.log(JSON.stringify(payload, null, 2));
    return { ok: true, status: 0, dry: true };
  }

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent':   'XFuel-MCP-Register/1.0',
  };
  if (MCP_API_KEY) {
    headers['Authorization'] = `Bearer ${MCP_API_KEY}`;
  }

  try {
    const res = await fetch(`${MCP_ENDPOINT}/tools`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(15000),
    });

    const body = await res.text().catch(() => '(no body)');
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: -1, error: err.message };
  }
}

async function listTools() {
  if (DRY_RUN) {
    console.log('[DRY RUN] Would list tools at:', `${MCP_ENDPOINT}/tools`);
    return null;
  }

  const headers = { 'User-Agent': 'XFuel-MCP-Register/1.0' };
  if (MCP_API_KEY) headers['Authorization'] = `Bearer ${MCP_API_KEY}`;

  try {
    const res = await fetch(`${MCP_ENDPOINT}/tools`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.tools || data;
  } catch {
    return null;
  }
}

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   XFuel Protocol — MCP Tool Registration              ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  MCP endpoint:    ${MCP_ENDPOINT}`);
  console.log(`  XFuel API base:  ${XFUEL_AGENT_API}`);
  console.log(`  Auth:            ${MCP_API_KEY ? '(bearer token set)' : '(no auth)'}`);
  console.log(`  Dry run:         ${DRY_RUN ? 'YES — no requests will be sent' : 'no'}`);
  console.log('');

  const tools = descriptor.tools || [];
  if (tools.length === 0) {
    console.error('[MCP Register] No tools found in descriptor.');
    process.exit(1);
  }

  console.log(`  Registering ${tools.length} tool(s):\n`);

  let failures = 0;
  for (const tool of tools) {
    process.stdout.write(`  → ${tool.name.padEnd(35)} `);
    const result = await registerTool(tool);

    if (result.dry) {
      console.log('[DRY RUN]');
    } else if (result.ok) {
      console.log(`✓  HTTP ${result.status}`);
    } else if (result.error) {
      console.log(`✗  ERROR: ${result.error.slice(0, 80)}`);
      failures++;
    } else {
      console.log(`✗  HTTP ${result.status}: ${(result.body || '').slice(0, 80)}`);
      // 409 Conflict = tool already registered; treat as success
      if (result.status !== 409) failures++;
      else console.log(`     (409 = already registered — OK)`);
    }
  }

  console.log('');

  // Verify registration by listing tools
  if (!DRY_RUN && failures === 0) {
    console.log('  Verifying registration...');
    const registered = await listTools();
    if (registered) {
      const names = (Array.isArray(registered) ? registered : []).map(t => t.name);
      const allFound = tools.every(t => names.includes(t.name));
      if (allFound) {
        console.log('  ✓ All tools confirmed on MCP server\n');
      } else {
        const missing = tools.map(t => t.name).filter(n => !names.includes(n));
        console.warn(`  ⚠ Some tools not found in listing: ${missing.join(', ')}\n`);
      }
    } else {
      console.log('  (Could not verify — GET /tools returned no data)\n');
    }
  }

  if (failures > 0) {
    console.error(`  ✗ ${failures} registration(s) failed.\n`);
    process.exit(1);
  } else if (DRY_RUN) {
    console.log('  Dry run complete. Re-run without --dry-run to register.\n');
  } else {
    console.log('  ✓ All tools registered. XFuel is now callable from any MCP-compatible agent.\n');
    console.log('  Agents can now call:');
    tools.forEach(t => console.log(`    • ${t.name}`));
    console.log('');
    console.log('  Claude Desktop example:');
    console.log('    xfuel_submit_intent(preset="llm_chat", gpu_tier="h100", prompt="Hello!")');
    console.log('');
  }
}

main().catch(err => {
  console.error('\n[MCP Register] Fatal:', err.message);
  process.exit(1);
});
