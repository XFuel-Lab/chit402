#!/usr/bin/env node
// Builds mutants-kid-history.json (behaviour list, suite "verify") and
// mutants-kid-history.compile.json (same mutants, suite "tsc": a mutant KILLED
// there is a compile kill and does not count; rewrite it).
// usage: node build-mutants-kid-history.mjs   (writes both files beside this script)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const IH = 'packages/verify/src/issuer-history.ts';
const AT = 'packages/verify/src/anchor-trust.ts';
const IX = 'packages/verify/src/index.ts';
const VD = 'packages/verify/src/verdict.ts';
const TESTS = [
  'test/kid-history-window.test.mjs',
  'test/head-signature.test.mjs',
  'test/issuer-history-attacks.test.mjs',
  'test/preimage-history.test.mjs',
  'test/issuer-history-sealed-pin.test.mjs',
  'test/check-input.test.mjs',
  'test/public-attestation-046.test.mjs',
  'test/verdict-040.test.mjs',
];
const m = (id, file, re, replace, note, nth = 1) => ({ id, file, find: re.source, flags: re.flags.replace('g', ''), replace, nth, suite: 'verify', note });
const mutants = [
  // A: shared window rule (exist at main af204858 and must survive the refactor textually)
  m('A1_not_before_exclusive', IH, /if \(issued < notBefore\) return/, 'if (issued <= notBefore) return', 'not_before is inclusive: signed == not_before must verify'),
  m('A2_not_after_exclusive', IH, /if \(notAfter != null && issued > notAfter\)/, 'if (notAfter != null && issued >= notAfter)', 'not_after is inclusive: signed == not_after must verify'),
  m('A3_revoked_at_inclusive', IH, /if \(issued >= revoked\) return/, 'if (issued > revoked) return', 'signed == revoked_at must be refused'),
  m('A4_drop_revoked_check', IH, /(if \(issued >= revoked)\) return/, '$1 && false) return', 'revoked row must refuse signed >= revoked_at'),
  m('A5_revoked_not_sticky', IH, /status: revoked \? 'revoked' : last\.status/, 'status: last.status', 'revocation sticks even if a later row says otherwise'),
  m('A6_latest_not_after_wins', IH, /if \(notAfterMs == null \|\| parsed < notAfterMs\)/, 'if (notAfterMs == null || parsed > notAfterMs)', 'earliest not_after binds; a later row cannot widen'),
  m('A7_latest_revoked_at_wins', IH, /if \(revokedMs == null \|\| parsed < revokedMs\)/, 'if (revokedMs == null || parsed > revokedMs)', 'earliest revoked_at binds'),
  m('A8_earliest_not_before_wins', IH, /if \(notBeforeMs == null \|\| parsed > notBeforeMs\)/, 'if (notBeforeMs == null || parsed < notBeforeMs)', 'latest not_before binds; cannot widen backwards'),
  m('A9_missing_time_reason', IH, /if \(issued == null\) return \{ ok: false, reason: 'issued_at_missing' \};/, "if (issued == null) return { ok: false, reason: 'not_before_missing' };", 'missing/unparseable signed time keeps reason issued_at_missing'),
  m('A10_bad_not_after_ignored', IH, /if \(parsed == null\) return \{ ok: false, reason: 'not_after_invalid' \};/, 'if (parsed == null) continue;', 'unparseable not_after refuses not_after_invalid on both paths'),
  m('A11_receipt_time_field_swap', IX, /const issuedAt = \(verifiedClaims && 'iat' in verifiedClaims \? verifiedClaims\.iat : null\)/, 'const issuedAt = ((receipt as { created_at?: unknown }).created_at ?? null)', 'receipt window uses the signed iat, not the outer created_at'),
  // B: call sites and the shared resolver (B1, B10, B11, B12, B16 exist at main; the rest need the LOCKED shapes)
  m('B1_head_window_dropped', AT, /const window = headHistoryWindow\(issuerHistory, kid, publishedAt\);/, 'const window = { ok: true, reason: null as string | null };', 'production head path must enforce the window'),
  m('B2_head_bypass_pick_first', AT, /return issuerKeyWindow\(doc, kid, publishedAt, \{ allowUntimedOpen: true \}\);/, "{ const first = (doc.entries || []).find((e) => e && e.kid === kid); if (!first) return { ok: false, reason: 'kid_not_in_history' }; return first.status === 'active' && !first.not_after ? { ok: true, reason: null } : issuerKeyWindow(doc, kid, publishedAt, { allowUntimedOpen: true }); }", 'head path must go through the shared resolver, not the first row'),
  m('B3_ambiguity_pick_first', IH, /if \(kidRowsAmbiguous\(matches\)\) return \{ ok: false, reason: 'kid_ambiguous' \};/, 'if (kidRowsAmbiguous(matches)) return issuerEntryWindow(matches[0], issuedAt);', 'ambiguity refuses; never pick-first'),
  m('B7_head_untimed_closed', AT, /allowUntimedOpen: true/, 'allowUntimedOpen: false', 'v1 head without published_at still verifies for an open active kid'),
  m('B8_untimed_closed_window_accepts', IH, /return \{ ok: false, reason: 'published_at_missing' \};/, 'return { ok: true, reason: null };', 'untimed head with not_after/revoked (after fold) refuses published_at_missing'),
  m('B9_untimed_future_not_before', IH, /> Date\.now\(\)\)/, '> Date.now() + 1e15)', 'untimed head with not_before in the future refuses'),
  m('B10_head_time_swapped_to_now', AT, /headHistoryWindow\(issuerHistory, kid, publishedAt\)/, 'headHistoryWindow(issuerHistory, kid, new Date().toISOString())', 'head window keyed on signed published_at, not now'),
  m('B11_receipt_time_swapped_to_now', IH, /const window = issuerKeyWindow\(doc, kid, issuedAt\);/, 'const window = issuerKeyWindow(doc, kid, new Date().toISOString());', 'receipt window keyed on signed iat, not now'),
  m('B12_receipt_last_row_only', IH, /const window = issuerKeyWindow\(doc, kid, issuedAt\);/, 'const window = issuerEntryWindow((doc.entries || []).filter((r) => r.kid === kid).pop(), issuedAt);', 'receipt path must fold all rows (later retired row cannot widen not_after)'),
  m('B14_ambiguity_dropped', IH, /if \(kidRowsAmbiguous\(matches\)\) return \{ ok: false, reason: 'kid_ambiguous' \};/, 'if (kidRowsAmbiguous(matches)) void 0;', 'two labels for one key, or two keys for one label, refuse kid_ambiguous'),
  m('B15_label_only_match', IH, /\.filter\(\(row\) => historyRowMatchesKid\(row, kid\)\)/, '.filter((row) => row.kid === kid)', 'both paths match rows by label OR jwk thumbprint (one matcher)'),
  m('B16_receipt_untimed_open', IH, /const window = issuerKeyWindow\(doc, kid, issuedAt\);/, 'const window = issuerKeyWindow(doc, kid, issuedAt, { allowUntimedOpen: true });', 'receipt with no signed time stays issued_at_missing'),
  m('C1_ambiguous_exit_code', VD, /(const WINDOW_FAIL = new Set\(\[\n)  'kid_ambiguous',\n/, '$1', 'kid_ambiguous on the receipt path maps to key_window fail, exit 1'),
  m('X1_epoch_revoked_not_sticky', IH, /if \(row\.status === 'revoked'\) return false;\n    if \(row\.revoked_at != null && row\.revoked_at !== ''\) return false;/, "if (row.status === 'revoked' && false) return false;", 'epoch: a revoked row or revoked_at stamp refuses every time, including before revoked_at'),
  m('X2_epoch_missing_at_accepts', IH, /if \(parseTime\(at\) == null\) return false;/, 'if (parseTime(at) == null) return true;', 'epoch: a missing or unparseable at returns false'),
  m('X3_epoch_label_only', IH, /\.filter\(\(row\) => row\.kid === kid \|\| row\.jwk\?\.kid === kid\)/, '.filter((row) => row.kid === kid)', 'epoch: rows still match on row.kid or jwk.kid'),
  m('X4_epoch_ambiguity_dropped', IH, /if \(kidRowsAmbiguous\(matches\)\) return false;/, 'if (kidRowsAmbiguous(matches)) void 0;', 'epoch: rows that disagree on key identity return false'),
  m('X5_epoch_retired_refuses', IH, /return issuerKeyWindow\(aligned, kid, at\)\.ok;/, "return issuerKeyWindow(aligned, kid, at).ok && matches[matches.length - 1].status === 'active';", 'epoch: a retired row with not_after does not refuse a time the shared window admits'),
  m('X6_epoch_open_retired_dropped', IH, /if \(openEndedRetired\(matches\)\) return false;/, 'if (openEndedRetired(matches)) void 0;', 'epoch: an open-ended retired row refuses every time'),
  m('X7_epoch_open_retired_all_paths', IH, /return issuerEntryWindow\(\{/, "if (openEndedRetired(matches)) return { ok: false, reason: 'issued_after_not_after' }; return issuerEntryWindow({", 'open-ended retired refusal stays on the epoch path'),
  m('X8_epoch_open_retired_null_allowed', IH, /return retired && !foldedNotAfter;/, 'return retired && foldedNotAfter;', 'epoch: an open end refuses; a not_after still uses the window'),
  m('Y1_missing_not_after_counts_as_set', IH, /row\.not_after != null && row\.not_after !== ''/, "!('not_after' in row) || (row.not_after != null && row.not_after !== '')", 'epoch: a missing not_after is an open end, not a set end'),
  m('Y3_empty_not_after_counts_as_set', IH, /row\.not_after != null && row\.not_after !== ''/, 'row.not_after != null', 'epoch: an empty not_after is an open end, not a set end'),
];
const verifySuite = { cwd: 'packages/verify', argv: ['sh', '-c', `./node_modules/.bin/tsc -p . && node --test --test-concurrency=1 ${TESTS.join(' ')}`], env: { NODE_ENV: 'test' } };
const tscSuite = { cwd: 'packages/verify', argv: ['sh', '-c', './node_modules/.bin/tsc -p . --noEmit'], env: {} };
const about = 'chit402-verify kid-history shared window rule. Regenerate with node build-mutants-kid-history.mjs. After any run, rebuild dist (npm run build) before other tests: the last mutant leaves a mutated dist/.';
writeFileSync(join(HERE, 'mutants-kid-history.json'), JSON.stringify({ about, timeoutSec: 180, suites: { verify: verifySuite }, mutants }, null, 2) + '\n');
writeFileSync(join(HERE, 'mutants-kid-history.compile.json'), JSON.stringify({ about: about + ' Compile list: KILLED here = compile kill (invalid mutant).', timeoutSec: 180, suites: { tsc: tscSuite }, mutants: mutants.map((x) => ({ ...x, suite: 'tsc' })) }, null, 2) + '\n');
console.log(`wrote ${mutants.length} mutants`);
