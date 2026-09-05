/**
 * Shared handler for possession-gated agent book reads (GET|POST /v1/agents/:id/book).
 */
import type { McpConfig } from './config.js';
import { ok, fail } from './format.js';

export interface AgentBookArgs {
  agent_id: number;
  session: string;
  limit?: number;
  /** USDC 6dp prepaid ceiling Y. Omit to read; pass null/"" to clear unlimited. */
  budget?: string | null;
}

export async function fetchAgentBook(
  config: McpConfig,
  args: AgentBookArgs,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  const url = `${config.apiUrl.replace(/\/$/, '')}/v1/agents/${args.agent_id}/book`;
  const body: Record<string, unknown> = {
    session: args.session,
  };
  if (args.limit != null) body.limit = args.limit;
  if (Object.prototype.hasOwnProperty.call(args, 'budget')) body.budget = args.budget;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? ' — wrong or missing session (possession proof)'
        : '';
    return fail(`get_agent_book HTTP ${res.status}${hint}`);
  }
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  const totals = data.totals as { count?: number; usdc_sum?: string } | undefined;
  const caps = data.caps as { remaining?: string | null; budget?: string | null } | undefined;
  const budgetLine =
    caps?.budget != null || caps?.remaining != null
      ? ` budget=${String(caps?.budget ?? '—')} remaining=${String(caps?.remaining ?? '—')}`
      : '';
  return ok(
    data,
    `Book agent_id=${args.agent_id} count=${String(totals?.count ?? 0)} usdc_sum=${String(totals?.usdc_sum ?? '0')}${budgetLine}`,
  );
}
