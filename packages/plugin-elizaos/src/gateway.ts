/** Gateway HTTP helpers for agent register + possession-gated book. */

export interface RegisterAgentParams {
  agentWallet: string;
  task_id: string;
  request_hash?: string;
}

export interface RegisterAgentResult {
  agent_id: number;
  agentWallet: string;
  session: string;
  task_id?: string;
  validate_score?: number;
}

export interface FetchAgentBookParams {
  agent_id: number;
  session: string;
  limit?: number;
}

export async function registerAgent(
  apiUrl: string,
  apiKey: string,
  params: RegisterAgentParams,
): Promise<RegisterAgentResult> {
  const url = `${apiUrl.replace(/\/$/, '')}/v1/agents/register`;
  const body: Record<string, unknown> = {
    agentWallet: params.agentWallet,
    task_id: params.task_id,
  };
  if (params.request_hash) body.request_hash = params.request_hash;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const message = String(data.message || data.error || `HTTP ${res.status}`);
    throw new Error(`Chit402 register failed: ${message}`);
  }
  const agentId = Number(data.agent_id);
  const session = String(data.session ?? '');
  if (!Number.isFinite(agentId) || agentId <= 0 || !session) {
    throw new Error('Chit402 register returned incomplete agent_id or session.');
  }
  return {
    agent_id: agentId,
    agentWallet: String(data.agentWallet ?? params.agentWallet),
    session,
    task_id: data.task_id != null ? String(data.task_id) : params.task_id,
    validate_score: data.validate_score != null ? Number(data.validate_score) : undefined,
  };
}

export async function fetchAgentBook(
  apiUrl: string,
  apiKey: string,
  params: FetchAgentBookParams,
): Promise<Record<string, unknown>> {
  const url = `${apiUrl.replace(/\/$/, '')}/v1/agents/${params.agent_id}/book`;
  const body: Record<string, unknown> = {
    session: params.session,
  };
  if (params.limit != null) body.limit = params.limit;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? ' — wrong or missing session (possession proof)'
        : '';
    throw new Error(`Chit402 book HTTP ${res.status}${hint}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}
