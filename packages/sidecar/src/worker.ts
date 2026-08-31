/**
 * XFuel Sidecar Cloudflare Worker
 *
 * Edge proxy that sits in front of ANY OpenAI-compatible endpoint.
 * Forwards requests unchanged, hashes outputs, emits XFuel receipts.
 *
 * Deploy with:
 *   wrangler deploy --name xfuel-sidecar
 *
 * Configure via wrangler.toml:
 *   [vars]
 *   UPSTREAM_BASE_URL = "https://openrouter.ai/api"
 *   XFUEL_SIGNING_SECRET = "..."
 *   XFUEL_BASE_URL = "https://api.xfuel.app"
 */

export interface Env {
  /** Upstream provider base URL (e.g. https://openrouter.ai/api) */
  UPSTREAM_BASE_URL: string;
  /** Optional HMAC signing secret for tamper-evident receipts */
  XFUEL_SIGNING_SECRET?: string;
  /** XFuel API base URL for verify_url (default: https://api.xfuel.app) */
  XFUEL_BASE_URL?: string;
  /** Optional: forward the upstream API key from a secret */
  UPSTREAM_API_KEY?: string;
}

interface ChatCompletionChoice {
  message?: { content?: string | null; tool_calls?: unknown[] };
}

interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: ChatCompletionChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface SidecarWorkerReceipt {
  schema: string;
  task_id: string;
  status: string;
  proof_outcome: string;
  verify_url: string | null;
  sidecar: true;
  created_at: string;
  payment: {
    rail: 'uncollected';
    ref: null;
    gross_amount: string;
    net_amount: string;
    fee_amount: string;
    collected: false;
  };
  route: {
    hub: string;
    model: string;
    provider: string;
  };
  output: { hash: string; kind: 'sha256' } | null;
  usage: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
  } | null;
  signature?: {
    alg: string;
    scope: string;
    value: string;
  };
}

function generateTaskId(): string {
  const ts = Date.now().toString(36);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sidecar-${ts}-${rand}`;
}

async function hashOutput(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `0x${hashHex}`;
}

async function signReceipt(receipt: SidecarWorkerReceipt, secret: string): Promise<string> {
  const payload = JSON.stringify([
    receipt.task_id,
    receipt.payment.rail,
    receipt.payment.ref,
    receipt.payment.gross_amount,
    receipt.route.hub,
    receipt.route.model,
    receipt.output?.hash ?? null,
    receipt.sidecar,
  ]);

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const data = encoder.encode(payload);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const sigArray = Array.from(new Uint8Array(signature));
  const sigHex = sigArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return `sha256=${sigHex}`;
}

function extractOutput(data: ChatCompletionResponse): string | null {
  const choices = data.choices;
  if (!choices || choices.length === 0) return null;

  const first = choices[0];
  const message = first.message;

  if (!message) return null;

  if (message.tool_calls && message.tool_calls.length > 0) {
    return JSON.stringify({
      content: message.content || null,
      tool_calls: message.tool_calls,
    });
  }

  return message.content ?? null;
}

async function handleChatCompletions(
  request: Request,
  env: Env
): Promise<Response> {
  const upstreamBase = env.UPSTREAM_BASE_URL.replace(/\/$/, '');
  const upstreamUrl = `${upstreamBase}/v1/chat/completions`;

  const headers = new Headers(request.headers);

  if (env.UPSTREAM_API_KEY) {
    headers.set('Authorization', `Bearer ${env.UPSTREAM_API_KEY}`);
  }

  const upstreamRequest = new Request(upstreamUrl, {
    method: request.method,
    headers,
    body: request.body,
  });

  const response = await fetch(upstreamRequest);

  if (!response.ok) {
    return response;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return response;
  }

  try {
    const data = (await response.json()) as ChatCompletionResponse;
    const hub = new URL(upstreamBase).host;

    const output = extractOutput(data);
    const outputHash = output ? await hashOutput(output) : null;
    const taskId = generateTaskId();

    const xfuelBaseUrl = (env.XFUEL_BASE_URL || 'https://api.xfuel.app').replace(/\/$/, '');

    const receipt: SidecarWorkerReceipt = {
      schema: 'xfuel.receipt.v3',
      task_id: taskId,
      status: 'completed',
      proof_outcome: 'signed',
      verify_url: null,
      sidecar: true,
      created_at: new Date().toISOString(),
      payment: {
        rail: 'uncollected',
        ref: null,
        gross_amount: '0',
        net_amount: '0',
        fee_amount: '0',
        collected: false,
      },
      route: {
        hub,
        model: data.model || 'unknown',
        provider: hub,
      },
      output: outputHash ? { hash: outputHash, kind: 'sha256' } : null,
      usage: data.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens ?? null,
            completion_tokens: data.usage.completion_tokens ?? null,
            total_tokens: data.usage.total_tokens ?? null,
          }
        : null,
    };

    if (env.XFUEL_SIGNING_SECRET) {
      receipt.signature = {
        alg: 'HMAC-SHA256',
        scope: 'sidecar',
        value: await signReceipt(receipt, env.XFUEL_SIGNING_SECRET),
      };
    }

    const enhancedBody = {
      ...data,
      xfuel: receipt,
    };

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-xfuel-task-id', taskId);
    responseHeaders.set('x-xfuel-provider', hub);
    responseHeaders.set('x-xfuel-sidecar', 'true');
    if (outputHash) {
      responseHeaders.set('x-xfuel-output-hash', outputHash);
    }

    return new Response(JSON.stringify(enhancedBody), {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return response;
  }
}

async function handleModels(request: Request, env: Env): Promise<Response> {
  const upstreamBase = env.UPSTREAM_BASE_URL.replace(/\/$/, '');
  const upstreamUrl = `${upstreamBase}/v1/models`;

  const headers = new Headers(request.headers);
  if (env.UPSTREAM_API_KEY) {
    headers.set('Authorization', `Bearer ${env.UPSTREAM_API_KEY}`);
  }

  return fetch(upstreamUrl, { headers });
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.endsWith('/v1/chat/completions') && request.method === 'POST') {
    return handleChatCompletions(request, env);
  }

  if (path.endsWith('/v1/models') && request.method === 'GET') {
    return handleModels(request, env);
  }

  const upstreamBase = env.UPSTREAM_BASE_URL.replace(/\/$/, '');
  const upstreamUrl = `${upstreamBase}${path}${url.search}`;

  const headers = new Headers(request.headers);
  if (env.UPSTREAM_API_KEY) {
    headers.set('Authorization', `Bearer ${env.UPSTREAM_API_KEY}`);
  }

  return fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: request.body,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: 'sidecar_error', message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
