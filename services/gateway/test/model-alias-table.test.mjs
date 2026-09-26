/**
 * MODEL_ALIAS_TABLE — longest match, vendor-prefix strip, gpt-oss targets.
 * Small names prefer gpt-oss-20b (else 120b). Larger names prefer 120b.
 * Bare gpt / openai follow xfuel/auto. Unserved names stay model_not_found.
 * No alias points at OpenRouter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_ALIAS_TABLE,
  SUBSTITUTION_POLICY,
  matchModelAlias,
  modelSubstitution,
  resolveCatalogModel,
  toOpenAIList,
} from '../src/hub-catalog.js';

const LIVE = [
  { id: 'xfuel/auto', hub: 'xfuel', alias: 'auto', modality: 'chat' },
  { id: 'akash/openai/gpt-oss-120b', hub: 'akash', alias: 'openai/gpt-oss-120b', modality: 'chat' },
  { id: 'akash/openai/gpt-oss-20b', hub: 'akash', alias: 'openai/gpt-oss-20b', modality: 'chat' },
  { id: 'akash/meta-llama/Llama-3.3-70B-Instruct', hub: 'akash', alias: 'meta-llama/Llama-3.3-70B-Instruct', modality: 'chat' },
  { id: 'akash/zai-org/GLM-5.3', hub: 'akash', alias: 'zai-org/GLM-5.3', modality: 'chat' },
];

const SMALL = 'akash/openai/gpt-oss-20b';
const LARGE = 'akash/openai/gpt-oss-120b';

function resolvedId(name, models = LIVE) {
  const r = resolveCatalogModel(name, models, { modality: 'chat' });
  assert.equal(r.ok, true, name);
  return r.model.id;
}

test('the alias table never points at OpenRouter', () => {
  for (const entry of MODEL_ALIAS_TABLE) {
    assert.equal(/openrouter/i.test(entry.target), false, entry.id);
    assert.equal(/openrouter/i.test(entry.id), false, entry.id);
  }
});

test('longest match wins, including dated snapshots and vendor prefixes', () => {
  assert.equal(matchModelAlias('gpt-4.1-mini').id, 'gpt-4.1-mini');
  assert.equal(matchModelAlias('gpt-4o-mini-2024-07-18').id, 'gpt-4o-mini');
  assert.equal(matchModelAlias('gpt-4-turbo-2024-04-09').id, 'gpt-4-turbo');
  assert.equal(matchModelAlias('gpt-4-0125-preview').id, 'gpt-4');
  assert.equal(matchModelAlias('OpenAI/gpt-4o').id, 'gpt-4o');
  assert.equal(matchModelAlias('anthropic/claude-3-5-haiku-20241022').id, 'claude-3-5-haiku');
  assert.equal(matchModelAlias('anthropic/claude-sonnet-4-20250514').id, 'claude-sonnet');
  assert.equal(matchModelAlias('claude-haiku-4-5').id, 'claude-haiku');
  assert.equal(matchModelAlias('gpt').id, 'gpt');
  assert.equal(matchModelAlias('openai').id, 'openai');
  assert.equal(matchModelAlias('claude-sonnet'), null);
  assert.equal(matchModelAlias('claude-haiku'), null);
  assert.equal(matchModelAlias('gpt-5'), null);
  assert.equal(matchModelAlias('openai/gpt-5'), null);
});

test('small names land on gpt-oss-20b and fall back to 120b', () => {
  const small = [
    'gpt-4o-mini',
    'gpt-4o-mini-2024-07-18',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4.1-nano-2025-04-14',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-0125',
    'gpt-3.5-turbo-16k',
    'claude-3-5-haiku',
    'claude-3-5-haiku-20241022',
    'claude-haiku-4-5',
    'openai/gpt-4o-mini',
    'anthropic/claude-3-5-haiku',
  ];
  for (const name of small) {
    assert.equal(resolvedId(name), SMALL, name);
    assert.notEqual(resolvedId(name), 'akash/meta-llama/Llama-3.3-70B-Instruct', name);
  }

  const no20 = LIVE.filter((m) => m.id !== SMALL);
  for (const name of ['gpt-4o-mini', 'gpt-4.1-mini', 'claude-haiku-3-5', 'openai/gpt-3.5-turbo']) {
    assert.equal(resolvedId(name, no20), LARGE, name);
  }
});

test('larger names land on gpt-oss-120b', () => {
  const large = [
    'gpt-4o',
    'gpt-4o-2024-08-06',
    'gpt-4.1',
    'gpt-4.1-2025-04-14',
    'gpt-4-turbo',
    'gpt-4-turbo-preview',
    'gpt-4',
    'gpt-4-1106-preview',
    'chatgpt-4o-latest',
    'claude-3-5-sonnet',
    'claude-3-5-sonnet-20241022',
    'claude-sonnet-4',
    'claude-sonnet-4-20250514',
    'openai/gpt-4o',
    'anthropic/claude-3-5-sonnet',
    'ANTHROPIC/claude-sonnet-3-7',
  ];
  for (const name of large) {
    assert.equal(resolvedId(name), LARGE, name);
    assert.notEqual(resolvedId(name), SMALL, name);
  }
});

test('bare gpt and openai follow xfuel/auto and keep the requested name', () => {
  for (const shape of ['simple', 'agent']) {
    const auto = resolveCatalogModel('xfuel/auto', LIVE, { modality: 'chat', shape });
    for (const name of ['gpt', 'openai', 'GPT', 'OpenAI']) {
      const r = resolveCatalogModel(name, LIVE, { modality: 'chat', shape });
      assert.equal(r.ok, true, name);
      assert.equal(r.model.id, auto.model.id, name);
      assert.equal(r.requested, name.trim(), `${name} requested`);
      assert.notEqual(r.model.id, 'xfuel/auto', name);
    }
  }
});

test('a real gpt-oss id is not rewritten by the alias table', () => {
  assert.equal(resolvedId('akash/openai/gpt-oss-120b'), LARGE);
  assert.equal(resolvedId('openai/gpt-oss-20b'), SMALL);
  assert.equal(resolvedId('gpt-oss-120b'), LARGE);
});

test('unserved specific models stay model_not_found and are not Llama', () => {
  const refused = [
    'gpt-5',
    'gpt-5-mini',
    'o1',
    'o1-mini',
    'o1-2024-12-17',
    'o3',
    'o3-mini',
    'claude-opus-4',
    'claude-opus-4-20250514',
    'claude',
    'claude-sonnet',
    'grok-4',
    'grok',
    'kimi-k2',
    'kimi-k2.6',
    'openai/gpt-5',
    'openai/o1',
    'anthropic/claude-opus-4',
    'gpt-4o-realtime-preview',
  ];
  for (const name of refused) {
    const r = resolveCatalogModel(name, LIVE, { modality: 'chat' });
    assert.equal(r.ok, false, name);
    assert.equal(r.reason, 'model_not_found', name);
    assert.ok(r.available.includes(LARGE), name);
    assert.ok(r.available.includes(SMALL), name);
    assert.equal(r.model, undefined, name);
  }

  const noOss = LIVE.filter((m) => !/gpt-oss/i.test(m.id));
  for (const name of ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'claude-haiku-4-5']) {
    const r = resolveCatalogModel(name, noOss, { modality: 'chat' });
    assert.equal(r.ok, false, name);
    assert.equal(r.reason, 'model_not_found', name);
  }
});

test('GET /v1/models shape exposes aliases, patterns, and per-model arrays', () => {
  const list = toOpenAIList(LIVE, { modality: 'chat' });
  assert.equal(list.aliases['gpt-4o-mini'], SMALL);
  assert.equal(list.aliases['gpt-4.1-nano'], SMALL);
  assert.equal(list.aliases['claude-3-5-haiku'], SMALL);
  assert.equal(list.aliases['gpt-4o'], LARGE);
  assert.equal(list.aliases['gpt-4.1'], LARGE);
  assert.equal(list.aliases['gpt-4-turbo'], LARGE);
  assert.equal(list.aliases['gpt-4'], LARGE);
  assert.equal(list.aliases['claude-3-5-sonnet'], LARGE);
  assert.equal(list.aliases.gpt, 'xfuel/auto');
  assert.equal(list.aliases.openai, 'xfuel/auto');
  assert.equal(list.aliases['claude-haiku'], undefined);
  assert.equal(list.aliases['claude-sonnet'], undefined);

  assert.ok(list.alias_patterns.some((p) => p.pattern === 'claude-haiku-*' && p.target === SMALL));
  assert.ok(list.alias_patterns.some((p) => p.pattern === 'claude-sonnet-*' && p.target === LARGE));
  assert.ok(list.alias_patterns.some((p) => p.pattern === 'gpt-4o-mini-<dated-snapshot>' && p.target === SMALL));
  assert.ok(list.alias_patterns.some((p) => p.pattern === 'gpt-4o-<dated-snapshot>' && p.target === LARGE));

  const row = (id) => list.data.find((m) => m.id === id);
  assert.ok(row(SMALL).aliases.includes('gpt-4o-mini'));
  assert.ok(row(SMALL).aliases.includes('gpt-4.1-mini'));
  assert.ok(row(SMALL).aliases.includes('gpt-4.1-nano'));
  assert.ok(row(SMALL).aliases.includes('gpt-3.5-turbo'));
  assert.ok(row(SMALL).aliases.includes('claude-3-5-haiku'));
  assert.ok(row(SMALL).aliases.includes('claude-haiku-*'));
  assert.ok(row(LARGE).aliases.includes('gpt-4o'));
  assert.ok(row(LARGE).aliases.includes('gpt-4.1'));
  assert.ok(row(LARGE).aliases.includes('gpt-4-turbo'));
  assert.ok(row(LARGE).aliases.includes('gpt-4'));
  assert.ok(row(LARGE).aliases.includes('claude-3-5-sonnet'));
  assert.ok(row(LARGE).aliases.includes('claude-sonnet-*'));
  assert.deepEqual(row('xfuel/auto').aliases, ['gpt', 'openai']);
  assert.deepEqual(row('akash/meta-llama/Llama-3.3-70B-Instruct').aliases, []);

  const targets = [
    ...Object.values(list.aliases),
    ...list.alias_patterns.map((p) => p.target),
  ];
  assert.ok(targets.every((t) => !/openrouter/i.test(t)));

  assert.equal(list.substitution_policy.default, 'alias');
  assert.equal(list.substitution_policy.strict_header, 'X-Chit-Strict-Model');
  assert.equal(list.substitution_policy.strict_body, 'chit_strict_model');
  assert.equal(list.substitution_policy.body_field, 'chit');
  assert.deepEqual(
    list.substitution_policy.disclosure_headers,
    [...SUBSTITUTION_POLICY.disclosure_headers],
  );
  assert.match(list.substitution_policy.note, /model_not_routable/);
  assert.match(list.substitution_policy.note, /No charge is made|no charge is made/);
});

test('modelSubstitution is true only when a table hit serves a different id', () => {
  const hit = modelSubstitution('gpt-4o-mini', SMALL);
  assert.equal(hit.substituted, true);
  assert.equal(hit.requested_model, 'gpt-4o-mini');
  assert.equal(hit.served_model, SMALL);

  assert.equal(modelSubstitution('openai/gpt-4o', LARGE).substituted, true);
  assert.equal(modelSubstitution('gpt', LARGE).substituted, true);
  assert.equal(modelSubstitution('GPT-4o', LARGE).substituted, true);

  assert.equal(modelSubstitution(LARGE, LARGE).substituted, false);
  assert.equal(modelSubstitution('xfuel/auto', LARGE).substituted, false);
  assert.equal(modelSubstitution('deepseek', 'akash/deepseek-ai/DeepSeek-V4-Flash').substituted, false);
  assert.equal(modelSubstitution('gpt-5', LARGE).substituted, false);
});

test('strict mode disables the alias table and keeps exact ids', () => {
  const refused = [
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4o-2024-08-06',
    'claude-sonnet-4',
    'claude-3-5-haiku',
    'openai/gpt-4o-mini',
    'anthropic/claude-3-5-sonnet',
    'gpt',
    'openai',
    'chatgpt-4o-latest',
  ];
  for (const name of refused) {
    const r = resolveCatalogModel(name, LIVE, { modality: 'chat', strict: true });
    assert.equal(r.ok, false, name);
    assert.equal(r.reason, 'model_not_found', name);
    assert.ok(r.available.includes(LARGE), name);
    assert.ok(r.available.includes(SMALL), name);
  }

  assert.equal(resolvedId(LARGE, LIVE), LARGE);
  const strictExact = resolveCatalogModel(LARGE, LIVE, { modality: 'chat', strict: true });
  assert.equal(strictExact.ok, true);
  assert.equal(strictExact.model.id, LARGE);

  const strictAuto = resolveCatalogModel('xfuel/auto', LIVE, { modality: 'chat', strict: true });
  assert.equal(strictAuto.ok, true);
  assert.notEqual(strictAuto.model.id, 'xfuel/auto');

  const typed = resolveCatalogModel('llama-3.3', LIVE, { modality: 'chat', strict: true });
  assert.equal(typed.ok, true);
  assert.equal(typed.model.id, 'akash/meta-llama/Llama-3.3-70B-Instruct');
});
