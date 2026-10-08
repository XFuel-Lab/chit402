#!/usr/bin/env node
/**
 * Fail the build when a tracked file contains infrastructure identifiers
 * or credential-shaped material.
 *
 * Prints rule, path, and line only. Matched values are never written.
 *
 * IPv4 allowlist: test fixtures, RFC 5737 documentation ranges,
 * 127.0.0.0/8, and 0.0.0.0.
 * Secret and mnemonic allowlist: test fixtures whose line also carries
 * a clearly fake marker (EXAMPLE, FAKE, PLACEHOLDER, NOTAREAL, CHANGEME, DUMMY).
 * Account ids, server home paths, consumer mailboxes, and the retired
 * personal name are never allowlisted — including in test fixtures.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const BIP39_PATH = new URL('./bip39-english.txt', import.meta.url);
const BIP39 = new Set(
  readFileSync(BIP39_PATH, 'utf8')
    .split(/\r?\n/)
    .map((word) => word.trim())
    .filter(Boolean),
);

const SERVER_HOME = ['/home', 'ubuntu'].join('/');
const FAKE_MARKER = /\b(?:EXAMPLE|FAKE|PLACEHOLDER|NOTAREAL|NOT_A_REAL|CHANGEME|DUMMY)\b/;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;
const ACCOUNT_ID = /(?<![A-Fa-f0-9])\d{12}(?![A-Fa-f0-9])/g;
const SECRET_RE = new RegExp(
  'aws_secret_access_key[^A-Za-z0-9]{0,16}[=:][^A-Za-z0-9]{0,8}[\'"]?[A-Za-z0-9+/]{40}(?![A-Za-z0-9+/])',
  'i',
);
const ACCESS_KEY_RE = new RegExp(
  '\\b(?:' + ['AK', 'IA'].join('') + '|' + ['AS', 'IA'].join('') + ')[A-Z0-9]{16}\\b',
);
const RETIRED_MAILBOX = ['founder', 'xfuel'].join('') + '@' + ['gmail', 'com'].join('.');
const GIVEN_NAME = ['Christ', 'opher'].join('');
const GIVEN_NAME_RE = new RegExp('\\b' + GIVEN_NAME + '\\b', 'i');
const CONSUMER_HOSTS = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'aol.com',
  'gmx.com',
];
const PERSONAL_EMAIL_RE = new RegExp(
  '[A-Za-z0-9._%+-]+@(?:' +
    CONSUMER_HOSTS.map((host) => host.replace(/\./g, '\\.')).join('|') +
    ')\\b',
  'i',
);

export function isTestFixture(relPath) {
  const p = relPath.replaceAll('\\', '/');
  return (
    /(^|\/)(test|tests|__tests__|fixtures)(\/|$)/.test(p) ||
    /(^|\/)cypress(\/|$)/.test(p) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) ||
    /fixture/i.test(p)
  );
}

function isDotEnv(relPath) {
  const base = relPath.replaceAll('\\', '/').split('/').pop() || '';
  return base.startsWith('.env');
}

function isAllowedIpv4(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  if (ip === '0.0.0.0') return true;
  if (a === 127) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function hasAccountId(line) {
  ACCOUNT_ID.lastIndex = 0;
  let match = ACCOUNT_ID.exec(line);
  while (match) {
    const start = Math.max(0, match.index - 80);
    const end = Math.min(line.length, match.index + match[0].length + 80);
    const window = line.slice(start, end);
    if (/arn:|account/i.test(window)) return true;
    match = ACCOUNT_ID.exec(line);
  }
  return false;
}

function wordsAreMnemonic(words) {
  if (words.length !== 12 && words.length !== 24) return false;
  return words.every((word) => BIP39.has(word));
}

function lineHasMnemonicAssignment(line) {
  const re = /(?:mnemonic|seed)\b[^\n=:]{0,40}[=:][ \t]*['"]?([a-z]+(?:[ \t]+[a-z]+){11,23})\b/gi;
  let match = re.exec(line);
  while (match) {
    const words = match[1].split(/[ \t]+/);
    if (wordsAreMnemonic(words)) return true;
    match = re.exec(line);
  }
  return false;
}

function lineHasDotEnvMnemonic(line) {
  const tokens = line.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  let run = [];
  const flush = () => {
    if (run.length >= 12 && wordsAreMnemonic(run.slice(0, 12))) return true;
    if (run.length >= 24 && wordsAreMnemonic(run.slice(0, 24))) return true;
    if (run.length > 24) {
      for (let i = 0; i + 12 <= run.length; i += 1) {
        if (wordsAreMnemonic(run.slice(i, i + 12))) return true;
        if (i + 24 <= run.length && wordsAreMnemonic(run.slice(i, i + 24))) return true;
      }
    }
    return false;
  };
  for (const token of tokens) {
    if (BIP39.has(token)) {
      run.push(token);
    } else if (flush()) {
      return true;
    } else {
      run = [];
    }
  }
  return flush();
}

function secretAllowed(relPath, line) {
  return isTestFixture(relPath) && FAKE_MARKER.test(line);
}

/**
 * @param {string} relPath
 * @param {string} text
 * @returns {{ rule: string, path: string, line: number }[]}
 */
export function scanContent(relPath, text) {
  const hits = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  const fixture = isTestFixture(relPath);
  const dotenv = isDotEnv(relPath);

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const add = (rule) => {
      const key = `${rule}\0${lineNo}`;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push({ rule, path: relPath, line: lineNo });
    };

    if (line.includes(SERVER_HOME)) add('server-path');

    IPV4.lastIndex = 0;
    let ip = IPV4.exec(line);
    while (ip) {
      const prev = ip.index > 0 ? line[ip.index - 1] : '';
      const sectionNumber = prev === '§' || prev === 'v' || prev === 'V';
      if (!sectionNumber && !fixture && !isAllowedIpv4(ip[0])) {
        add('ipv4');
        break;
      }
      ip = IPV4.exec(line);
    }

    if (hasAccountId(line)) add('aws-account');

    if (SECRET_RE.test(line) && !secretAllowed(relPath, line)) add('aws-secret');
    SECRET_RE.lastIndex = 0;
    if (ACCESS_KEY_RE.test(line) && !secretAllowed(relPath, line)) add('aws-access-key');
    ACCESS_KEY_RE.lastIndex = 0;

    const mnemonic =
      lineHasMnemonicAssignment(line) || (dotenv && lineHasDotEnvMnemonic(line));
    if (mnemonic && !secretAllowed(relPath, line)) add('mnemonic');

    if (line.toLowerCase().includes(RETIRED_MAILBOX)) add('personal-mailbox');
    if (PERSONAL_EMAIL_RE.test(line)) add('personal-email');
    if (GIVEN_NAME_RE.test(line)) add('personal-name');
  });

  return hits;
}

export function formatHit(hit) {
  return `${hit.rule}\t${hit.path}:${hit.line}`;
}

function trackedFiles(root) {
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

export function scanRepo(root = process.cwd()) {
  const hits = [];
  for (const rel of trackedFiles(root)) {
    const abs = path.join(root, rel);
    let buf;
    try {
      buf = readFileSync(abs);
    } catch {
      hits.push({ rule: 'unreadable', path: rel, line: 1 });
      continue;
    }
    if (buf.includes(0)) continue;
    hits.push(...scanContent(rel, buf.toString('utf8')));
  }
  return hits;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

export function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const hits = scanRepo(root);
  for (const hit of hits) {
    process.stdout.write(`${formatHit(hit)}\n`);
  }
  return hits.length === 0 ? 0 : 1;
}

if (isDirectRun()) {
  process.exit(main());
}
