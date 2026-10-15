/**
 * Receipt-check feedback. The pasted receipt is filed only when asked.
 * A contact address is not published.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';

process.env.LOG_LEVEL = 'error';
process.env.NODE_ENV = 'test';

const {
  mountReceiptCheck,
  FEEDBACK_PER_IP_PER_HOUR,
  FEEDBACK_GLOBAL_PER_HOUR,
} = await import('../src/receipt-check.js');
const {
  prepareFeedback,
  buildFeedbackIssue,
  feedbackEnabled,
  FEEDBACK_TOKEN_ENV,
  createCheckReports,
  withStoredReport,
  UNVERIFIED_REPORT,
  REPORT_TTL_MS,
  gatewayCommit,
} = await import('../src/receipt-feedback.js');
const { buildVerifyVerdict, humanVerdictLines } = await import('../../../packages/verify/dist/verdict.js');

const MARKER = 'paste-marker-9f3c2a-do-not-store';
const NOW = Date.parse('2026-10-14T18:40:00.000Z');
const CHECKS = {
  signature: 'fail',
  key_window: 'pass',
  payment_binding: 'fail',
  log_inclusion: 'could_not_check',
  anchor: 'pass',
  shape: 'pass',
};

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function feedbackBody(extra = {}) {
  return {
    expected: 'verified',
    intent: 'Check a pasted receipt',
    note: 'See owner@example.com at https://example.com/secret and www.example.com/x',
    result_code: 'INVALID',
    reason: 'signature_invalid',
    checks: CHECKS,
    input_kind: 'json',
    input_bytes: 128,
    receipt_id: 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96',
    receipt_version: 10,
    issuer: 'test-kid',
    chain: 'base',
    page: '/check',
    request_id: 'chk_abc123',
    client: 'web',
    contact: 'owner@example.com',
    receipt: MARKER,
    ...extra,
  };
}

test('feedback is off when the token is unset, including an explicit empty override', () => {
  const previous = process.env[FEEDBACK_TOKEN_ENV];
  process.env[FEEDBACK_TOKEN_ENV] = 'should-not-be-read';
  try {
    assert.equal(feedbackEnabled({ feedbackToken: '' }), false);
    assert.equal(feedbackEnabled({}), true);
  } finally {
    if (previous == null) delete process.env[FEEDBACK_TOKEN_ENV];
    else process.env[FEEDBACK_TOKEN_ENV] = previous;
  }
});

test('the issue lists every reviewer field, and omits the receipt and the contact', () => {
  const prepared = prepareFeedback(feedbackBody(), {
    verifierVersion: '0.4.1',
    buildDigest: 'a'.repeat(64),
    gatewayCommit: 'abcdef1234567890',
    timestamp: '2026-10-14T18:40:00.000Z',
  });
  assert.equal(prepared.ok, true);
  const issue = buildFeedbackIssue(prepared.record);
  const body = issue.body;
  const headings = [
    '## Result',
    '## Checks',
    '## Lines',
    '## Input',
    '## Expected',
    '## Trying to do',
    '## Note',
    '## Client',
    '## Verifier',
    '## Gateway',
    '## Pasted receipt',
  ];
  let cursor = -1;
  for (const heading of headings) {
    const at = body.indexOf(heading);
    assert.ok(at > cursor, heading);
    cursor = at;
  }
  assert.match(body, /result_code: INVALID/);
  assert.match(body, /reason: signature_invalid/);
  const reasonText = { pass: 'passed', fail: 'failed', could_not_check: 'could not check' };
  for (const [name, state] of Object.entries(CHECKS)) {
    assert.match(body, new RegExp(`- ${name}: ${state} — ${reasonText[state]}`));
  }
  assert.match(body, /kind: json/);
  assert.match(body, /bytes: 128/);
  assert.match(body, /receipt_id: chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96/);
  assert.match(body, /receipt_version: 10/);
  assert.match(body, /issuer: test-kid/);
  assert.match(body, /chain: base/);
  assert.match(body, /^verified$/m);
  assert.match(body, /Check a pasted receipt/);
  assert.match(body, /client: web/);
  assert.match(body, /page: \/check/);
  assert.match(body, /request_id: chk_abc123/);
  assert.match(body, /package: chit402-verify/);
  assert.match(body, /version: 0\.4\.1/);
  assert.match(body, new RegExp(`build_digest: ${'a'.repeat(64)}`));
  assert.match(body, /commit: abcdef1234567890/);
  assert.match(body, /timestamp: 2026-10-14T18:40:00\.000Z/);
  assert.match(body, /\[redacted\]/);
  assert.equal(body.includes('owner@example.com'), false);
  assert.equal(body.includes('https://example.com/secret'), false);
  assert.equal(body.includes('www.example.com/x'), false);
  assert.match(body, /omitted/);
  assert.equal(body.includes(MARKER), false);
  assert.equal(issue.labels[0], 'check-feedback');

  const attached = prepareFeedback(feedbackBody({ attach_receipt: true }), {
    timestamp: '2026-10-14T18:40:00.000Z',
  });
  assert.match(buildFeedbackIssue(attached.record).body, new RegExp(MARKER));
  const quoted = prepareFeedback(feedbackBody({ attach_receipt: true, receipt: '```secret```' }), {
    timestamp: '2026-10-14T18:40:00.000Z',
  });
  assert.equal(buildFeedbackIssue(quoted.record).body.includes('```'), false);
});

test('a string attach flag does not publish the receipt', () => {
  const prepared = prepareFeedback(feedbackBody({ attach_receipt: 'true' }), {
    timestamp: '2026-10-14T18:40:00.000Z',
  });
  assert.equal(prepared.record.attach, false);
  assert.equal(buildFeedbackIssue(prepared.record).body.includes(MARKER), false);
});

test('expected and intent are required', () => {
  const missingExpected = prepareFeedback(feedbackBody({ expected: '' }));
  assert.equal(missingExpected.ok, false);
  assert.equal(missingExpected.error, 'expected_required');
  const missingIntent = prepareFeedback(feedbackBody({ intent: '   ' }));
  assert.equal(missingIntent.ok, false);
  assert.equal(missingIntent.error, 'intent_required');
  const longNote = prepareFeedback(feedbackBody({ note: 'x'.repeat(1001) }));
  assert.equal(longNote.ok, false);
  assert.equal(longNote.error, 'note_too_long');
});

test('POST /v1/receipts/feedback is off without a token and does not call GitHub', async () => {
  const previous = process.env[FEEDBACK_TOKEN_ENV];
  process.env[FEEDBACK_TOKEN_ENV] = 'should-not-be-read';
  let called = false;
  const seen = [];
  const app = express();
  app.use(express.json());
  mountReceiptCheck(app, {
    feedbackToken: '',
    now: () => NOW,
    log(record) { seen.push(record); },
    githubFetch: async () => {
      called = true;
      return new Response('{}', { status: 201 });
    },
  });
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/v1/receipts/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(feedbackBody()),
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.error, 'feedback_unavailable');
    assert.equal(called, false);
    assert.equal(JSON.stringify(seen).includes(MARKER), false);
    assert.equal(JSON.stringify(seen).includes('should-not-be-read'), false);
    assert.equal(JSON.stringify(body).includes(MARKER), false);
  } finally {
    if (previous == null) delete process.env[FEEDBACK_TOKEN_ENV];
    else process.env[FEEDBACK_TOKEN_ENV] = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a stored report replaces client fields, and an unknown id is unverified', () => {
  const stored = {
    result_code: 'INVALID',
    reason: 'signature_invalid',
    checks: {
      signature: { state: 'fail', reason: 'The receipt does not match what the issuer signed.' },
      key_window: { state: 'pass', reason: 'passed' },
      payment_binding: { state: 'could_not_check', reason: 'could not check' },
      log_inclusion: { state: 'pass', reason: 'passed' },
      anchor: { state: 'pass', reason: 'passed' },
      shape: { state: 'pass', reason: 'passed' },
    },
    lines: ['INVALID', 'The receipt does not match what the issuer signed.'],
    input_kind: 'json',
    input_bytes: 40,
    receipt_id: 'chit-server',
    receipt_version: 10,
    issuer: 'server-kid',
    chain: 'base',
    client: 'web',
    verifier_version: '0.4.1',
    build_digest: 'abc',
  };
  const prepared = prepareFeedback(feedbackBody({
    result_code: 'VERIFIED',
    reason: 'client-lied',
    receipt_id: 'chit-client-lied',
    issuer: 'client-issuer',
    client: 'api',
  }), { timestamp: '2026-10-14T18:40:00.000Z', gatewayCommit: 'abcdef1234567890', verifierVersion: '9.9.9', buildDigest: 'clientdigest' });
  const issue = buildFeedbackIssue(withStoredReport(prepared.record, stored));
  assert.match(issue.body, /- signature: fail — The receipt does not match what the issuer signed\./);
  assert.match(issue.body, /- key_window: pass — passed/);
  assert.match(issue.body, /- payment_binding: could_not_check — could not check/);
  assert.match(issue.body, /receipt_id: chit-server/);
  assert.match(issue.body, /issuer: server-kid/);
  assert.match(issue.body, /client: web/);
  assert.match(issue.body, /version: 0\.4\.1/);
  assert.match(issue.body, /commit: abcdef1234567890/);
  assert.equal(issue.body.includes('chit-client-lied'), false);
  assert.equal(issue.body.includes('client-lied'), false);
  assert.equal(issue.body.includes('client-issuer'), false);
  assert.equal(issue.body.includes('9.9.9'), false);
  const missing = buildFeedbackIssue(withStoredReport(prepared.record, null));
  assert.match(missing.body, /unverified report/);
  assert.match(missing.title, /unverified report/);
  assert.equal(missing.body.includes('chit-client-lied'), false);
  assert.equal(missing.body.includes('client-issuer'), false);
});

test('the report map expires and stays bounded, and it does not keep input', () => {
  const reports = createCheckReports({ ttlMs: REPORT_TTL_MS, max: 2 });
  reports.put('a', { result_code: 'VERIFIED', input: MARKER, receipt: MARKER }, 0);
  reports.put('b', { result_code: 'INVALID' }, 1);
  reports.put('c', { result_code: 'COULD_NOT_CHECK' }, 2);
  assert.equal(reports.get('a', 2), null);
  assert.equal(reports.get('c', 2).result_code, 'COULD_NOT_CHECK');
  assert.equal(reports.json().includes(MARKER), false);
  assert.equal(reports.get('b', REPORT_TTL_MS + 2), null);
  assert.equal(gatewayCommit({ GATEWAY_COMMIT: '' }), 'GATEWAY_COMMIT unset');
  assert.equal(UNVERIFIED_REPORT, 'unverified report');
});

test('a filed issue has every field, and the log does not keep the receipt', async () => {
  const previous = process.env.GATEWAY_COMMIT;
  process.env.GATEWAY_COMMIT = 'abcdef1234567890';
  const calls = [];
  const seen = [];
  const reports = createCheckReports();
  const digest = readFileSync(new URL('../../../packages/verify/BUILD_DIGEST.txt', import.meta.url), 'utf8').trim();
  const verdict = buildVerifyVerdict({
    version: '0.4.1',
    receiptId: 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96',
    payloadVersion: 10,
    signatureChecked: true,
    signatureValid: false,
    historyChecked: true,
    historyOk: true,
    logInclusion: 'pass',
    anchor: 'pass',
  });
  const lines = humanVerdictLines(verdict);
  const pasted = JSON.stringify({
    task_id: 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96',
    payload_version: 10,
    issuer_signature: { kid: 'test-kid' },
    chain: 'base',
    note: MARKER,
  });
  const app = express();
  app.use(express.json());
  mountReceiptCheck(app, {
    feedbackToken: 'gh-test-token',
    now: () => NOW,
    reports,
    log(record) { seen.push(record); },
    check: async () => ({ verdict, lines, report: 'lines' }),
    githubFetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
      const issues = calls.filter((call) => String(call.url).endsWith('/issues'));
      if (String(url).endsWith('/issues') && issues.length === 1) {
        return new Response(JSON.stringify({ message: 'label missing' }), { status: 422 });
      }
      return new Response(JSON.stringify({ number: 9 }), { status: 201 });
    },
  });
  const { server, base } = await listen(app);
  try {
    const checked = await fetch(`${base}/v1/receipts/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: pasted, client: 'web' }),
    });
    const checkedBody = await checked.json();
    assert.equal(checked.status, 200);
    assert.equal(reports.json().includes(MARKER), false);
    const hidden = await fetch(`${base}/v1/receipts/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(feedbackBody({
        request_id: checkedBody.request_id,
        result_code: 'VERIFIED',
        reason: 'client-lied',
        receipt_id: 'chit-client-lied',
        issuer: 'client-issuer',
        client: 'api',
        checks: { signature: 'pass', payment_binding: 'fail' },
      })),
    });
    const hiddenBody = await hidden.json();
    assert.equal(hidden.status, 202);
    assert.equal(hiddenBody.ok, true);
    assert.equal(hiddenBody.request_id, checkedBody.request_id);
    assert.equal(JSON.stringify(hiddenBody).includes(MARKER), false);
    const issueCall = calls.find((call) => String(call.url).endsWith('/issues') && call.body.title);
    assert.equal(issueCall.auth, 'Bearer gh-test-token');
    assert.equal(issueCall.body.labels[0], 'check-feedback');
    assert.match(issueCall.body.body, /result_code: INVALID/);
    assert.match(issueCall.body.body, /reason: signature_invalid/);
    assert.match(issueCall.body.body, /- signature: fail — The receipt does not match what the issuer signed\./);
    assert.match(issueCall.body.body, /- key_window: pass — passed/);
    assert.match(issueCall.body.body, /- payment_binding: could_not_check — could not check/);
    assert.match(issueCall.body.body, /- log_inclusion: pass — passed/);
    assert.match(issueCall.body.body, /- anchor: pass — passed/);
    assert.match(issueCall.body.body, /- shape: pass — passed/);
    assert.match(issueCall.body.body, /kind: json/);
    assert.match(issueCall.body.body, new RegExp(`bytes: ${Buffer.byteLength(pasted)}`));
    assert.match(issueCall.body.body, /receipt_id: chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96/);
    assert.match(issueCall.body.body, /receipt_version: 10/);
    assert.match(issueCall.body.body, /issuer: test-kid/);
    assert.match(issueCall.body.body, /chain: base/);
    assert.match(issueCall.body.body, /client: web/);
    assert.match(issueCall.body.body, new RegExp(`request_id: ${checkedBody.request_id}`));
    assert.match(issueCall.body.body, /package: chit402-verify/);
    assert.match(issueCall.body.body, /version: 0\.4\.1/);
    assert.match(issueCall.body.body, new RegExp(`build_digest: ${digest}`));
    assert.match(issueCall.body.body, /commit: abcdef1234567890/);
    assert.match(issueCall.body.body, /timestamp: 2026-10-14T18:40:00\.000Z/);
    assert.equal(issueCall.body.body.includes(MARKER), false);
    assert.equal(issueCall.body.body.includes('client-lied'), false);
    assert.equal(issueCall.body.body.includes('chit-client-lied'), false);
    assert.equal(issueCall.body.body.includes('client-issuer'), false);
    assert.equal(issueCall.body.body.includes('owner@example.com'), false);
    assert.equal(issueCall.body.body.includes('https://example.com/secret'), false);
    assert.match(issueCall.body.body, /omitted/);
    assert.equal(calls.some((call) => String(call.url).endsWith('/labels')), true);
    assert.equal(JSON.stringify(seen).includes(MARKER), false);
    assert.equal(seen.some((record) => record.request_id === checkedBody.request_id), true);

    calls.length = 0;
    const shown = await fetch(`${base}/v1/receipts/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(feedbackBody({ attach_receipt: true, request_id: 'chk_missing' })),
    });
    assert.equal(shown.status, 202);
    const shownIssue = calls.find((call) => String(call.url).endsWith('/issues'));
    assert.match(shownIssue.body.body, /unverified report/);
    assert.match(shownIssue.body.body, /receipt_id: none/);
    assert.match(shownIssue.body.body, new RegExp(MARKER));
    assert.equal(JSON.stringify(seen).includes(MARKER), false);
  } finally {
    if (previous == null) delete process.env.GATEWAY_COMMIT;
    else process.env.GATEWAY_COMMIT = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a GitHub failure does not echo the upstream body', async () => {
  const app = express();
  app.use(express.json());
  mountReceiptCheck(app, {
    feedbackToken: 'gh-test-token',
    githubFetch: async () => new Response(`nope ${MARKER}`, { status: 500 }),
  });
  const { server, base } = await listen(app);
  try {
    const res = await fetch(`${base}/v1/receipts/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(feedbackBody({ attach_receipt: true })),
    });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.error, 'feedback_failed');
    assert.equal(JSON.stringify(body).includes(MARKER), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('feedback is 3 per hour per IP, and the 429 does not call GitHub', async () => {
  assert.equal(FEEDBACK_PER_IP_PER_HOUR, 3);
  let githubCalls = 0;
  const app = express();
  app.use(express.json());
  mountReceiptCheck(app, {
    maxHits: 100,
    feedbackToken: 'gh-test-token',
    githubFetch: async () => {
      githubCalls += 1;
      return new Response('{}', { status: 201 });
    },
  });
  const { server, base } = await listen(app);
  try {
    for (let i = 0; i < FEEDBACK_PER_IP_PER_HOUR; i += 1) {
      const res = await fetch(`${base}/v1/receipts/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(feedbackBody({ request_id: `chk_ip_${i}` })),
      });
      assert.equal(res.status, 202);
    }
    const blocked = await fetch(`${base}/v1/receipts/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(feedbackBody({ request_id: 'chk_ip_blocked', attach_receipt: true })),
    });
    const body = await blocked.json();
    assert.equal(blocked.status, 429);
    assert.equal(body.error, 'rate_limit_exceeded');
    assert.match(blocked.headers.get('retry-after') || '', /^[1-9]/);
    assert.equal(JSON.stringify(body).includes(MARKER), false);
    assert.equal(githubCalls, FEEDBACK_PER_IP_PER_HOUR);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('feedback is 30 per hour globally, and the 429 does not call GitHub', async () => {
  assert.equal(FEEDBACK_GLOBAL_PER_HOUR, 30);
  let githubCalls = 0;
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  mountReceiptCheck(app, {
    maxHits: 100,
    feedbackToken: 'gh-test-token',
    githubFetch: async () => {
      githubCalls += 1;
      return new Response('{}', { status: 201 });
    },
  });
  const { server, base } = await listen(app);
  try {
    for (let i = 1; i <= FEEDBACK_GLOBAL_PER_HOUR; i += 1) {
      const res = await fetch(`${base}/v1/receipts/feedback`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `203.0.113.${i}`,
        },
        body: JSON.stringify(feedbackBody({ request_id: `chk_global_${i}` })),
      });
      assert.equal(res.status, 202, `ip ${i}`);
    }
    const blocked = await fetch(`${base}/v1/receipts/feedback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.200',
      },
      body: JSON.stringify(feedbackBody({ request_id: 'chk_global_blocked', attach_receipt: true })),
    });
    const body = await blocked.json();
    assert.equal(blocked.status, 429);
    assert.equal(body.error, 'rate_limit_exceeded');
    assert.equal(JSON.stringify(body).includes(MARKER), false);
    assert.equal(githubCalls, FEEDBACK_GLOBAL_PER_HOUR);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an expired request_id is filed as an unverified report and ignores client fields', async () => {
  const previousCommit = process.env.GATEWAY_COMMIT;
  delete process.env.GATEWAY_COMMIT;
  let clock = 0;
  const calls = [];
  const reports = createCheckReports();
  const verdict = buildVerifyVerdict({
    version: '0.4.1',
    receiptId: 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96',
    payloadVersion: 10,
    signatureChecked: true,
    signatureValid: false,
    historyChecked: true,
    historyOk: true,
    logInclusion: 'pass',
    anchor: 'pass',
  });
  const pasted = JSON.stringify({ note: MARKER, task_id: 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96' });
  const app = express();
  app.use(express.json());
  mountReceiptCheck(app, {
    feedbackToken: 'gh-test-token',
    now: () => clock,
    reports,
    check: async () => ({ verdict, lines: humanVerdictLines(verdict), report: 'lines' }),
    githubFetch: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return new Response('{}', { status: 201 });
    },
  });
  const { server, base } = await listen(app);
  try {
    const checked = await fetch(`${base}/v1/receipts/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: pasted, client: 'web' }),
    });
    const checkedBody = await checked.json();
    assert.equal(checked.status, 200);
    assert.equal(reports.get(checkedBody.request_id, clock).result_code, 'INVALID');
    assert.equal(reports.json().includes(MARKER), false);
    clock = REPORT_TTL_MS + 1;
    assert.equal(reports.get(checkedBody.request_id, clock), null);
    const filed = await fetch(`${base}/v1/receipts/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(feedbackBody({
        attach_receipt: true,
        request_id: checkedBody.request_id,
        result_code: 'VERIFIED',
        reason: 'client-lied',
        receipt_id: 'chit-client-lied',
        issuer: 'client-issuer',
        chain: 'solana',
        client: 'api',
        gateway_commit: 'ffffffffffffffff',
      })),
    });
    assert.equal(filed.status, 202);
    const issue = calls[0];
    assert.match(issue.title, /unverified report/);
    assert.match(issue.body, /## Report\nunverified report/);
    assert.match(issue.body, /- signature: unknown — unverified report/);
    assert.match(issue.body, /receipt_id: none/);
    assert.match(issue.body, /client: unverified/);
    assert.match(issue.body, /commit: GATEWAY_COMMIT unset/);
    assert.match(issue.body, new RegExp(MARKER));
    assert.equal(issue.body.includes('client-lied'), false);
    assert.equal(issue.body.includes('chit-client-lied'), false);
    assert.equal(issue.body.includes('client-issuer'), false);
    assert.equal(issue.body.includes('ffffffffffffffff'), false);
    assert.equal(issue.body.includes('chit-1ebc5616'), false);
    assert.equal(reports.json().includes(MARKER), false);
  } finally {
    if (previousCommit == null) delete process.env.GATEWAY_COMMIT;
    else process.env.GATEWAY_COMMIT = previousCommit;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('feedback shares the check limiter', async () => {
  const verdict = buildVerifyVerdict({ version: '0.4.1', absentReason: 'receipt_unavailable' });
  const app = express();
  app.use(express.json());
  mountReceiptCheck(app, {
    maxHits: 1,
    windowMs: 60_000,
    feedbackToken: 'gh-test-token',
    check: async () => ({ verdict, lines: humanVerdictLines(verdict), report: 'lines' }),
    githubFetch: async () => new Response('{}', { status: 201 }),
  });
  const { server, base } = await listen(app);
  try {
    const check = await fetch(`${base}/v1/receipts/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96' }),
    });
    const feedback = await fetch(`${base}/v1/receipts/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(feedbackBody()),
    });
    assert.equal(check.status, 200);
    assert.equal(feedback.status, 429);
    assert.equal((await feedback.json()).error, 'rate_limit_exceeded');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
