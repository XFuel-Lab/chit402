/**
 * Offline source scans for public copy that must match what is live.
 * Each check is one assert.ok(re.test(src), msg) or assert.ok(!re.test(src), msg).
 * Files are read as text and CR is stripped so a Windows CRLF checkout
 * matches the same patterns as an LF checkout.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BASE = 'af2048581dabd5955a58e24966d535da126084d7';

const TIER_FILES = [
  'README.md',
  'docs/POSITIONING.md',
  'WHITEPAPER.md',
  'api/llms.txt.ts',
  'apps/web/src/pages/Pricing.tsx',
  'apps/web/src/pages/Products.tsx',
  'apps/web/src/pages/Book.tsx',
  'apps/web/src/pages/Docs.tsx',
  'apps/web/src/pages/Security.tsx',
];

const LOCKED_FILES = [
  'README.md',
  'docs/POSITIONING.md',
  'WHITEPAPER.md',
  'api/llms.txt.ts',
  'apps/web/src/pages/Pricing.tsx',
  'apps/web/src/pages/Products.tsx',
];

const PRICE_FILES = [
  'apps/web/src/pages/Pricing.tsx',
  'apps/web/src/pages/Products.tsx',
  'README.md',
  'api/llms.txt.ts',
];

const COPY_FILES = [
  'README.md',
  'docs/POSITIONING.md',
  'WHITEPAPER.md',
  'apps/web/src/pages/Pricing.tsx',
  'apps/web/src/pages/Products.tsx',
  'apps/web/src/pages/Book.tsx',
  'apps/web/src/pages/Docs.tsx',
  'apps/web/src/pages/Security.tsx',
  'apps/web/src/pages/OneF916Link.tsx',
  'docs/doors/README.md',
  'packages/agent-skills/chit402-cite-1f916/SKILL.md',
];

const CITATION_FIELDS = [
  'vendor',
  'task_id',
  'verify_url',
  'payment_ref',
  'network',
  'asset',
  'settled_amount',
  'model',
  'output_hash',
  'receipt_sha256',
];

function read(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function addedHunk(rel) {
  for (const base of [BASE, 'origin/main']) {
    try {
      const diff = execFileSync('git', ['diff', '-U0', '--ignore-cr-at-eol', base, '--', rel], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return diff
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .map((line) => line.slice(1))
        .join('\n')
        .replace(/\r/g, '');
    } catch {
      // Shallow checkouts do not have the base commit.
    }
  }
  return null;
}

function copyScanText(rel) {
  const added = addedHunk(rel);
  if (added != null) return added;
  let src = read(rel);
  if (rel === 'apps/web/src/pages/Pricing.tsx') src = src.replace('not trustless ZK', '');
  if (rel === 'README.md') src = src.replace('$120', '').replace('$0.001', '');
  return src;
}

test('tier-2 copy does not say on demand or coming soon', () => {
  for (const rel of TIER_FILES) {
    const src = read(rel);
    assert.ok(!/(?:proof[\s\S]{0,80}on demand|on demand[\s\S]{0,80}proof)/i.test(src), `${rel}: no "on demand" near proof`);
    assert.ok(!/live, on demand/.test(src), `${rel}: no "live, on demand"`);
    assert.ok(!/settlement proof[^.]*coming soon/i.test(src), `${rel}: no settlement proof coming soon`);
    assert.ok(!/proof add-on is coming soon/i.test(src), `${rel}: no proof add-on is coming soon`);
  }
});

test('locked Tier-2 sentence is on the public surfaces', () => {
  for (const rel of LOCKED_FILES) {
    const src = read(rel);
    assert.ok(
      /Tier-2 settlement proofs are off while we upgrade the proving system; standard \$0\.002 receipts are unaffected\./.test(src),
      `${rel}: locked Tier-2 sentence`,
    );
  }
});

test('Tier-2 price is not shown while proofs are off', () => {
  for (const rel of PRICE_FILES) {
    const src = read(rel);
    assert.ok(!/\+\s*\$0\.10/.test(src), `${rel}: no +$0.10 Tier-2 price`);
  }
});

test('whitepaper parks the Tier-3 zkLLM prover', () => {
  const src = read('WHITEPAPER.md');
  assert.ok(!/active build/.test(src), 'WHITEPAPER: no active build');
  assert.ok(!/finish the Tier-3 zkLLM prover/.test(src), 'WHITEPAPER: no finish the Tier-3 zkLLM prover');
  assert.ok(/Parked:\*\* Tier-3 zkLLM prover/.test(src), 'WHITEPAPER: parked Tier-3 line');
});

test('Docs and Security do not name the deleted doc files', () => {
  for (const rel of ['apps/web/src/pages/Docs.tsx', 'apps/web/src/pages/Security.tsx']) {
    const src = read(rel);
    assert.ok(!/HOSTED_TESTNET_ENDPOINT/.test(src), `${rel}: no HOSTED_TESTNET_ENDPOINT`);
    assert.ok(!/AUDIT_READINESS_CHECKLIST/.test(src), `${rel}: no AUDIT_READINESS_CHECKLIST`);
    assert.ok(!/DEMO_COMMANDS/.test(src), `${rel}: no DEMO_COMMANDS`);
  }
});

test('site and doors doc links resolve in this checkout', () => {
  const docs = read('apps/web/src/pages/Docs.tsx');
  const security = read('apps/web/src/pages/Security.tsx');
  const doors = read('docs/doors/README.md');
  assert.ok(/\$\{GITHUB\}\//.test(docs), 'Docs.tsx has GITHUB doc links');
  assert.ok(/blob\/main\//.test(security), 'Security.tsx has blob/main doc links');
  const docPaths = [...docs.matchAll(/\$\{GITHUB\}\/([A-Za-z0-9_./-]+)/g)].map((m) => m[1]);
  const blobPaths = [...security.matchAll(/blob\/main\/([A-Za-z0-9_./-]+)/g)].map((m) => m[1]);
  assert.ok(docPaths.length > 0, 'Docs.tsx yields doc paths');
  assert.ok(blobPaths.length > 0, 'Security.tsx yields doc paths');
  for (const rel of [...docPaths, ...blobPaths]) {
    assert.ok(existsSync(join(repoRoot, ...rel.split('/'))), `${rel} exists`);
  }
  assert.ok(/\[[^\]]*\]\([^)]+\)/.test(doors), 'doors README has markdown links');
  const relLinks = [...doors.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((m) => m[1].trim())
    .filter((href) => href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#'));
  assert.ok(relLinks.length > 0, 'doors README has relative links');
  const doorsDir = join(repoRoot, 'docs', 'doors');
  for (const href of relLinks) {
    const pathOnly = href.split('#')[0].split('?')[0];
    assert.ok(existsSync(resolve(doorsDir, pathOnly)), `docs/doors/README.md link ${href} exists`);
  }
});

test('cite skill reads the saved receipt, not the public shell', () => {
  const src = read('packages/agent-skills/chit402-cite-1f916/SKILL.md');
  assert.ok(
    !/verify_url\?format=json[^\n]*\n?[^\n]*issuer_signature\.jws/.test(src),
    'cite skill does not pair verify_url?format=json with issuer_signature.jws',
  );
  assert.ok(!/curl -s "\$VERIFY_URL\?format=json"/.test(src), 'cite skill does not curl the public format=json shell');
  assert.ok(/npx chit402-verify receipt\.json/.test(src), 'cite skill verifies receipt.json');
  assert.ok(/npx chit402-verify <verify_url>/.test(src), 'cite skill names npx chit402-verify <verify_url>');
  assert.ok(/npx chit402-verify "\$VERIFY_URL"/.test(src), 'cite skill runs npx chit402-verify on the URL variable');
  assert.ok(/COULD_NOT_CHECK/.test(src), 'cite skill names COULD_NOT_CHECK');
  assert.ok(!/about an hour after issue/.test(src), 'cite skill does not say about an hour after issue');
  assert.ok(/Today it returns COULD_NOT_CHECK/.test(src), 'cite skill says today the public check returns COULD_NOT_CHECK');
  assert.ok(/only after the receipt is anchored/.test(src), 'cite skill: exit 0 only after the receipt is anchored');
  assert.ok(/exit 2 \(PENDING\)/.test(src), 'cite skill: exit 2 (PENDING) before anchor');
  assert.ok(/contacts api\.chit402\.com/.test(src), 'cite skill: verify contacts api.chit402.com');
  assert.ok(!/expects exit 0/.test(src), 'cite skill: old expects exit 0 wording is gone');
  assert.ok(/jq \.xfuel response\.json > receipt\.json/.test(src), 'cite skill saves jq .xfuel response.json > receipt.json');
  assert.ok(
    /if \[ -n "\$JWS" \] && \[ "\$JWS" != null \]; then[\s\S]*?else\s+echo "no issuer_signature\.jws in receipt\.json" >&2\s+false\s+fi/.test(src),
    'cite snippet if/else ends false so failure is nonzero and does not exit the caller',
  );
  for (const field of CITATION_FIELDS) {
    assert.ok(new RegExp(`\\b${field}\\b`).test(src), `cite skill lists ${field}`);
  }
});

test('settlement-proof refusal and historical prove-result are pinned', () => {
  const narrowed = /Requests that ask for a settlement proof \(`proof_tier` settlement or inference, or Private \+ Attest\) get `400 settlement_proof_not_offered` before any quote or payment\./;
  for (const rel of ['WHITEPAPER.md', 'docs/POSITIONING.md', 'api/llms.txt.ts']) {
    const src = read(rel);
    assert.ok(narrowed.test(src), `${rel}: narrowed settlement-proof 400 sentence`);
  }
  const llms = read('api/llms.txt.ts');
  assert.ok(/\/prove-result\s+: historical settlement proofs only/.test(llms), 'llms.txt: prove-result is historical settlement proofs only');
});

test('1F916 page says a third party cannot check the receipt leg today', () => {
  const src = read('apps/web/src/pages/OneF916Link.tsx');
  assert.ok(
    /one offline check covers the instruction and the money\. Today a third party cannot run this check: the public receipts are unsigned shells, so <code>npx chit402-verify<\/code> and <code>scripts\/verify-1f916-link\.mjs<\/code> return COULD_NOT_CHECK \(exit 2\) on the receipt leg\. Exit 2 means not checked, not invalid\. This note stays until signed public receipts ship for these payouts\./.test(src),
    'OneF916Link says a third party cannot run this check today',
  );
  assert.ok(/COULD_NOT_CHECK/.test(src), 'OneF916Link still says COULD_NOT_CHECK');
  assert.ok(/not invalid/.test(src), 'OneF916Link still says not invalid');
});

test('changed copy has no hype words and no new price other than $0.002', () => {
  for (const rel of COPY_FILES) {
    const src = copyScanText(rel);
    assert.ok(!/revolutionary|game-changing|billions|trustless/i.test(src), `${rel}: no hype words in the changed copy`);
    assert.ok(!/\$(?!0\.002\b)\d/.test(src), `${rel}: no new price other than $0.002`);
  }
});
