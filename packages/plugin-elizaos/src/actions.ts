import type { Action, ActionResult, IAgentRuntime, Memory, State } from './eliza-types.js';
import { fetchAgentBook, registerAgent } from './gateway.js';
import { formatCachedBook, formatRemoteBook } from './receipts.js';
import { getRuntimeState, persistRegistration } from './state.js';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function messageText(message: Memory): string {
  const content = message.content as { text?: string } | undefined;
  return typeof content?.text === 'string' ? content.text : '';
}

function extractTaskId(text: string): string | undefined {
  const match = text.match(/\b(task-[a-zA-Z0-9_-]+)\b/);
  return match?.[1];
}

function extractWallet(text: string): string | undefined {
  const match = text.match(/\b(0x[0-9a-fA-F]{40})\b/);
  return match?.[1];
}

function latestQualifyingReceipt(state: Awaited<ReturnType<typeof getRuntimeState>>) {
  return state.receipts.find((r) => {
    const micro = Number(r.gross_amount ?? '0');
    return micro > 0 || r.rail === 'usdc';
  });
}

async function reply(
  runtime: IAgentRuntime,
  text: string,
  data?: Record<string, unknown>,
): Promise<ActionResult> {
  runtime.logger?.info?.(`[chit402] ${text.split('\n')[0]}`);
  return { success: true, text, data };
}

export const registerChitAgentAction: Action = {
  name: 'REGISTER_CHIT_AGENT',
  similes: ['REGISTER_AGENT', 'CHIT_REGISTER', 'BIND_CHIT_AGENT'],
  description:
    'Register this agent with Chit402 via POST /v1/agents/register using a collected paid receipt (task_id) and agent wallet. Stores agent_id + possession session on the runtime for CHIT_BOOK.',
  validate: async (_runtime, message) => {
    const text = messageText(message).toLowerCase();
    return (
      text.includes('register') ||
      text.includes('chit agent') ||
      text.includes('bind agent') ||
      text.includes('register_chit_agent')
    );
  },
  handler: async (runtime, message): Promise<ActionResult> => {
    try {
      const state = await getRuntimeState(runtime);
      const text = messageText(message);
      const taskId = extractTaskId(text) ?? latestQualifyingReceipt(state)?.task_id;
      if (!taskId) {
        return {
          success: false,
          text:
            'Chit402 register needs a collected paid receipt task_id. Run a paid inference first (CHIT_PAYER_PK), or include task_id in your message.',
        };
      }

      const walletFromMessage = extractWallet(text);
      const agentWallet = walletFromMessage ?? state.sender;
      if (!ADDRESS_RE.test(agentWallet)) {
        return {
          success: false,
          text:
            'Chit402 register needs a valid agentWallet (0x…). Set CHIT_PAYER_PK or include the wallet in your message.',
        };
      }

      const result = await registerAgent(state.config.apiUrl, state.config.apiKey, {
        agentWallet,
        task_id: taskId,
      });
      await persistRegistration(runtime, state, result.agent_id, result.session);

      const score =
        result.validate_score != null ? ` validate_score=${result.validate_score}` : '';
      return reply(
        runtime,
        [
          `Registered Chit402 agent_id=${result.agent_id} wallet=${result.agentWallet}${score}.`,
          `Possession session stored on this runtime — CHIT_BOOK and SHOW_CHIT_BOOK will use POST /v1/agents/${result.agent_id}/book.`,
          `Receipt task_id=${taskId}.`,
        ].join('\n'),
        {
          agent_id: result.agent_id,
          session: result.session,
          agentWallet: result.agentWallet,
          task_id: taskId,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, text: message, error: message };
    }
  },
};

export const showChitBookAction: Action = {
  name: 'SHOW_CHIT_BOOK',
  similes: ['CHIT_BOOK', 'SHOW_BOOK', 'SPEND_BOOK', 'SHOW_RECEIPTS'],
  description:
    'Show this agent Chit402 spend book — possession-gated last-N collected rows with verify_url. Falls back to runtime receipt cache when not registered.',
  validate: async (_runtime, message) => {
    const text = messageText(message).toLowerCase();
    return (
      text.includes('book') ||
      text.includes('spend') ||
      text.includes('receipt') ||
      text.includes('verify_url') ||
      text.includes('show_chit_book')
    );
  },
  handler: async (runtime, _message, _state?: State): Promise<ActionResult> => {
    try {
      const state = await getRuntimeState(runtime);
      const limit = state.config.bookLimit;
      const { agentId, bookSession } = state.config;

      if (agentId && bookSession) {
        try {
          const remote = await fetchAgentBook(state.config.apiUrl, state.config.apiKey, {
            agent_id: agentId,
            session: bookSession,
            limit,
          });
          const text = formatRemoteBook(remote, limit, state.config.apiUrl);
          return reply(runtime, text, { source: 'book_api', agent_id: agentId, ...remote });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          runtime.logger?.warn?.(`[chit402] SHOW_CHIT_BOOK remote fetch failed: ${message}`);
        }
      }

      const cached = formatCachedBook(state.receipts, limit);
      const note = agentId
        ? 'Note: possession session missing or invalid — showing runtime receipt cache only.'
        : 'Note: not registered yet — run REGISTER_CHIT_AGENT after a paid receipt, or set CHIT_AGENT_ID + CHIT_BOOK_SESSION.';
      return reply(
        runtime,
        `${cached}\n\n${note}`,
        {
          source: 'runtime_cache',
          receipts: state.receipts.slice(0, limit),
          session_spend_usd: state.sessionSpendUsd,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, text: message, error: message };
    }
  },
};

export const chit402Actions: Action[] = [registerChitAgentAction, showChitBookAction];
