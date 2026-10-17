#!/usr/bin/env node
/**
 * chit402-verify — receipt verdict.
 *
 * Usage:
 *   chit402-verify <id|url|file|-> [--issuer-history <file>] [--json]
 *
 * Exit codes:
 *   0 = VERIFIED (every check passed, including the on-chain payer check)
 *   1 = INVALID
 *   2 = COULD_NOT_CHECK
 */

import { readFileSync } from 'node:fs';
import { checkReceiptInput, packageVersion } from './check-input.js';
import { buildVerifyVerdict, humanVerdictLines, type VerifyVerdict } from './verdict.js';
import { formatSupportedReceiptVersions } from './receipt-version.js';

const HELP = `
chit402-verify — verify a Chit402 receipt

Usage:
  chit402-verify <id|url|receipt.json>
  chit402-verify - < receipt.json
  chit402-verify <receipt.json> --issuer-history <history.json>
  chit402-verify <receipt.json> --json

The on-chain payer check runs by default. Exit 0 is VERIFIED only when that
check ran and passed, with the signature, the key window, the log, and the
anchor. A payer, payee, or amount mismatch is exit 1 INVALID. An RPC that
does not answer, returns null, or errors, a missing payer field, an unsigned
public shell, or an unsupported rail is exit 2 COULD_NOT_CHECK.

Exit codes:
  0  VERIFIED           every check passed, including the payer
  1  INVALID            tamper, bad signature, revoked key, payer mismatch, NOT_IN_LOG
  2  COULD_NOT_CHECK    the log, the anchor, or the payer was not checked

Flags:
  --issuer-history <file>   History that prefix-extends the bundled snapshot
  --json                    Print the verdict JSON
  -h, --help
  -V, --version

${formatSupportedReceiptVersions()}
`;

const REMOVED_040: Record<string, string> = {
  '--strict': 'removed in 0.4: a skipped key window is no longer a separate result',
  '--no-issuer-history': 'removed in 0.4: the history check is always on',
  '--accept-no-key-window': 'removed in 0.4: VERIFIED_NO_KEY_WINDOW is retired',
  '--accept-shell': 'removed in 0.4: a shell is not a verified payment',
};

function removedFlagMessage(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      const rest = argv.slice(i + 1);
      if (rest.length === 0) return 'removed in 0.4: -- is not a verifier flag';
      return `removed in 0.4: arguments after -- are not accepted: ${rest.join(' ')}`;
    }
    if (!arg.startsWith('-') || arg === '-') continue;
    if (REMOVED_040[arg]) return REMOVED_040[arg];
    if (arg === '--issuer-history') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) return 'removed in 0.4: --issuer-history needs a file';
      i += 1;
      continue;
    }
    if (arg === '--json' || arg === '--help' || arg === '-h' || arg === '--version' || arg === '-V') continue;
    const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    return `removed in 0.4: ${name} is not a verifier flag`;
  }
  return null;
}

function parseLocked(argv: string[]): {
  json: boolean;
  help: boolean;
  version: boolean;
  issuerHistoryFile: string | null;
  positionals: string[];
} {
  const parsed = {
    json: false,
    help: false,
    version: false,
    issuerHistoryFile: null as string | null,
    positionals: [] as string[],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') break;
    if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--version' || arg === '-V') parsed.version = true;
    else if (arg === '--issuer-history' && argv[i + 1]) {
      parsed.issuerHistoryFile = argv[++i];
    } else if (!arg.startsWith('-') || arg === '-') {
      parsed.positionals.push(arg);
    }
  }
  return parsed;
}

function printLocked(verdict: VerifyVerdict, json: boolean): number {
  if (json) {
    console.log(JSON.stringify(verdict, null, 2));
    return verdict.exit_code;
  }
  for (const line of humanVerdictLines(verdict)) console.log(line);
  return verdict.exit_code;
}

function lockedError(json: boolean, status: 1 | 2, message: string, reason: string): number {
  if (!json) {
    console.error(message);
    return status;
  }
  const failed = status === 1;
  const verdict = buildVerifyVerdict({
    version: packageVersion(),
    errors: failed ? [reason] : [],
    signatureChecked: failed,
    signatureValid: failed ? false : null,
    logInclusion: 'could_not_check',
    anchor: 'could_not_check',
  });
  console.log(JSON.stringify({
    ...verdict,
    result: failed ? 'invalid' : 'could_not_check',
    exit_code: status,
    reason,
    message,
    next_step: failed ? null : verdict.next_step,
  }, null, 2));
  return status;
}

/**
 * Node's fetch keeps its undici agent on this symbol after the first request.
 * There is no public handle for that pool. Closing it lets the loop drain.
 */
const UNDICI_GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1');

type FetchDispatcher = {
  close?: () => Promise<void> | void;
  destroy?: () => Promise<void> | void;
};

function fetchDispatcher(): FetchDispatcher | undefined {
  const bag = globalThis as unknown as Record<symbol, FetchDispatcher | undefined>;
  return bag[UNDICI_GLOBAL_DISPATCHER];
}

/**
 * process.exit() while a fetch keep-alive socket is already CLOSING aborts
 * on Windows: Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
 * (src/win/async.c). Set the code and close the pool so the loop can drain.
 */
async function finish(code: number): Promise<void> {
  process.exitCode = code;
  const dispatcher = fetchDispatcher();
  if (!dispatcher) return;
  try {
    const closing = dispatcher.close?.();
    if (closing) await closing;
  } catch {
    try {
      await dispatcher.destroy?.();
    } catch {
      // The verification result is already the exit code.
    }
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const jsonEarly = argv.includes('--json');
  const removed = removedFlagMessage(argv);
  if (removed) return lockedError(jsonEarly, 1, removed, 'removed_flag');

  const args = parseLocked(argv);
  if (args.version) {
    console.log(`chit402-verify ${packageVersion()}`);
    console.log(formatSupportedReceiptVersions());
    return 0;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (args.positionals.length === 0) {
    console.log(HELP);
    return 1;
  }
  if (args.positionals.length !== 1) {
    return lockedError(args.json, 1, 'removed in 0.4: pass one receipt id, url, or file', 'removed_flag');
  }

  let issuerHistoryBytes: string | null = null;
  if (args.issuerHistoryFile) {
    try {
      issuerHistoryBytes = readFileSync(args.issuerHistoryFile, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return lockedError(args.json, 1, `Error reading issuer history: ${message}`, 'unreadable');
    }
  }

  const outcome = await checkReceiptInput(args.positionals[0], {
    issuerHistoryBytes,
  });
  if (outcome.report === 'stderr') {
    return lockedError(args.json, 1, outcome.message || 'Error reading receipt', outcome.reason || 'unreadable');
  }
  return printLocked(outcome.verdict, args.json);
}

main()
  .then((code) => finish(code))
  .catch((err) => {
    console.error('Unexpected error:', err);
    return finish(1);
  });
