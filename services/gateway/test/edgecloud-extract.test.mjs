import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractTextOutput, extractImageUrl } from '../src/edgecloud-infer.js';

// Theta services return several different output envelopes. extractTextOutput
// must always yield the plain assistant string — a JSON-encoded envelope leaking
// into `choices[0].message.content` breaks every OpenAI-client integration.

test('extractTextOutput: plain string passes through', () => {
  assert.equal(extractTextOutput('hello'), 'hello');
});

test('extractTextOutput: { message: "..." } (GLM shape) is unwrapped, not stringified', () => {
  assert.equal(extractTextOutput({ message: 'OK' }), 'OK');
});

test('extractTextOutput: { message: { content } } chat envelope', () => {
  assert.equal(extractTextOutput({ message: { role: 'assistant', content: 'hi' } }), 'hi');
});

test('extractTextOutput: { text } envelope', () => {
  assert.equal(extractTextOutput({ text: 'answer' }), 'answer');
});

test('extractTextOutput: OpenAI-style choices envelope', () => {
  const out = { choices: [{ message: { role: 'assistant', content: 'from choices' } }] };
  assert.equal(extractTextOutput(out), 'from choices');
});

test('extractTextOutput: { response } and { content } envelopes', () => {
  assert.equal(extractTextOutput({ response: 'r' }), 'r');
  assert.equal(extractTextOutput({ content: 'c' }), 'c');
});

test('extractTextOutput: array envelope takes the first element', () => {
  assert.equal(extractTextOutput(['first', 'second']), 'first');
  assert.equal(extractTextOutput([{ message: 'nested' }]), 'nested');
});

test('extractTextOutput: null/undefined → empty string', () => {
  assert.equal(extractTextOutput(null), '');
  assert.equal(extractTextOutput(undefined), '');
});

test('extractTextOutput: never returns a JSON-wrapped known envelope', () => {
  for (const envelope of [{ message: 'x' }, { text: 'x' }, { response: 'x' }, { content: 'x' }]) {
    const got = extractTextOutput(envelope);
    assert.equal(got, 'x');
    assert.doesNotMatch(got, /^\{/, `envelope ${JSON.stringify(envelope)} was stringified`);
  }
});

test('extractImageUrl: common image envelopes', () => {
  assert.equal(extractImageUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png');
  assert.equal(extractImageUrl({ image_url: 'https://x/1.png' }), 'https://x/1.png');
  assert.equal(extractImageUrl({ data: [{ url: 'https://x/2.png' }] }), 'https://x/2.png');
  assert.equal(extractImageUrl(null), null);
});
