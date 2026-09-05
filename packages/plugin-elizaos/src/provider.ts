import type { IAgentRuntime, Memory, Provider, State } from './eliza-types.js';
import { fetchAgentBook } from './gateway.js';
import { formatCachedBook, formatRemoteBook } from './receipts.js';
import { getRuntimeState } from './state.js';

export const chitBookProvider: Provider = {
  name: 'CHIT_BOOK',
  description:
    'Chit402 collected spend — last-N receipts with verify_url (possession-gated book API or runtime cache).',
  get: async (runtime: IAgentRuntime, _message: Memory, _state: State) => {
    const state = await getRuntimeState(runtime);
    const { config, receipts } = state;
    const limit = config.bookLimit;

    if (config.agentId && config.bookSession) {
      try {
        const remote = await fetchAgentBook(config.apiUrl, config.apiKey, {
          agent_id: config.agentId,
          session: config.bookSession,
          limit,
        });
        const text = formatRemoteBook(remote, limit, config.apiUrl);
        return {
          text,
          data: { source: 'book_api', agent_id: config.agentId, ...remote },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        runtime.logger?.warn?.(`[chit402] CHIT_BOOK remote fetch failed: ${message}`);
      }
    }

    const text = formatCachedBook(receipts, limit);
    return {
      text,
      data: {
        source: 'runtime_cache',
        receipts: receipts.slice(0, limit),
        session_spend_usd: state.sessionSpendUsd,
      },
    };
  },
};
