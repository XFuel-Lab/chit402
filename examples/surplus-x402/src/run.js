import { chitSurplusFetch } from './chit-surplus-fetch.js';

/**
 * Live Surplus → Chit receipt.
 * Reads SURPLUS_PAYER_PRIVATE_KEY, CHIT_STAMP_PRIVATE_KEY, CHIT_AGENT_ID,
 * and CHIT_BOOK_SESSION from the environment. Does not load a .env file.
 */

const url = process.argv[2] || 'https://api.surplusintelligence.ai/v1/chat/completions';

try {
  const result = await chitSurplusFetch(url, {
    method: 'POST',
    body: {
      model: 'llama-3.3-70b',
      messages: [{ role: 'user', content: 'Say exactly: pong' }],
      max_tokens: 8,
    },
  });
  const content = result.data?.choices?.[0]?.message?.content ?? null;
  console.log(JSON.stringify({
    verify_url: result.verify_url,
    content,
    data: result.data,
  }, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
