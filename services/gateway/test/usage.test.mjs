import test from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateTokens,
  messagesToText,
  normalizeUsage,
  aggregateUsage,
} from '../src/usage.js';

test('estimateTokens is ~4 chars/token and never zero for non-empty text', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens('a'), 1);
  assert.equal(estimateTokens('x'.repeat(400)), 100);
});

test('messagesToText tolerates non-string content', () => {
  const text = messagesToText([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: [{ type: 'image' }] },
    { role: 'user', content: 'world' },
  ]);
  assert.equal(text, 'hello\n\nworld');
  assert.equal(messagesToText(null), '');
});

test('prefers the provider usage block over an estimate', () => {
  const u = normalizeUsage(
    { usage: { prompt_tokens: 68000, completion_tokens: 247, total_tokens: 68247 } },
    { messages: [{ role: 'user', content: 'hi' }], output: 'ok' },
  );
  assert.equal(u.source, 'provider');
  assert.equal(u.prompt_tokens, 68000);
  assert.equal(u.completion_tokens, 247);
  assert.equal(u.total_tokens, 68247);
});

test('captures the cached prompt split, which drives real COGS on agent traffic', () => {
  const u = normalizeUsage({
    usage: {
      prompt_tokens: 68000,
      completion_tokens: 247,
      prompt_tokens_details: { cached_tokens: 63000 },
    },
  });
  assert.equal(u.cached_prompt_tokens, 63000);
  assert.equal(u.total_tokens, 68247, 'total is derived when the provider omits it');
});

test('reads the Anthropic-shaped usage block too', () => {
  const u = normalizeUsage({
    usage: { input_tokens: 5000, output_tokens: 120, cache_read_input_tokens: 4500 },
  });
  assert.equal(u.source, 'provider');
  assert.equal(u.prompt_tokens, 5000);
  assert.equal(u.completion_tokens, 120);
  assert.equal(u.cached_prompt_tokens, 4500);
});

test('surfaces hidden reasoning tokens — a 2-word answer can bill 130+', () => {
  const u = normalizeUsage({
    usage: {
      prompt_tokens: 40,
      completion_tokens: 134,
      completion_tokens_details: { reasoning_tokens: 130 },
    },
  });
  assert.equal(u.reasoning_tokens, 130);
  assert.equal(u.completion_tokens, 134, 'billed completion includes the hidden reasoning');
});

test('falls back to an estimate, marked as such, when the provider reports nothing', () => {
  const u = normalizeUsage(
    { choices: [{ message: { content: 'ok' } }] },
    { messages: [{ role: 'user', content: 'x'.repeat(400) }], output: 'y'.repeat(40) },
  );
  assert.equal(u.source, 'estimate');
  assert.equal(u.prompt_tokens, 100);
  assert.equal(u.completion_tokens, 10);
  assert.equal(u.cached_prompt_tokens, null, 'an estimate cannot know the cached split');
});

test('a usage block with neither side counts as no usage, not as zero tokens', () => {
  const u = normalizeUsage({ usage: { total_tokens: 0 } }, { output: 'hello there' });
  assert.equal(u.source, 'estimate', 'total_tokens alone is not a usable report');
});

test('accepts a bare usage object as well as a full response', () => {
  const u = normalizeUsage({ prompt_tokens: 10, completion_tokens: 2 });
  assert.equal(u.source, 'provider');
  assert.equal(u.total_tokens, 12);
});

test('aggregateUsage keeps measured and estimated totals apart', () => {
  const agg = aggregateUsage([
    { usage: { prompt_tokens: 68000, completion_tokens: 247, total_tokens: 68247, cached_prompt_tokens: 63000, source: 'provider' } },
    { usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, cached_prompt_tokens: null, source: 'provider' } },
    { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, cached_prompt_tokens: null, source: 'estimate' } },
    { status: 'pending' },
    null,
  ]);

  assert.equal(agg.provider.tasks, 2);
  assert.equal(agg.provider.prompt_tokens, 69000);
  assert.equal(agg.provider.completion_tokens, 347);
  assert.equal(agg.provider.cached_prompt_tokens, 63000);

  assert.equal(agg.estimate.tasks, 1);
  assert.equal(agg.estimate.prompt_tokens, 100);
});

test('aggregateUsage handles no tasks', () => {
  const agg = aggregateUsage([]);
  assert.equal(agg.provider.tasks, 0);
  assert.equal(agg.estimate.tasks, 0);
  assert.deepEqual(aggregateUsage(undefined), agg);
});
