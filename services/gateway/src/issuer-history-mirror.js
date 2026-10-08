/**
 * Commit-pinned copy of the issuer-history document in a third-party repo.
 *
 * The gateway never pushes, clones, or fetches that repo. An operator
 * commits the well-known bytes by hand, then sets:
 *   ISSUER_HISTORY_MIRROR_REPO     owner/name, or https://github.com/owner/name
 *   ISSUER_HISTORY_MIRROR_COMMIT   40-hex commit
 *   ISSUER_HISTORY_MIRROR_SHA256   sha256 of those exact bytes
 *   ISSUER_HISTORY_MIRROR_PATH     optional, default issuer-history.json
 *
 * sha256 is the chit402-jcs-v1 hash of the well-known issuer-history
 * document (the same digest as X-Chit-History-Hash). It is not snapshot_hash.
 *
 * GET /.well-known/issuer-history.json is the announcement copy. It is not
 * a second custodian. GET /.well-known/issuer-history-mirror.json only
 * names the pinned location. The mirror block is not inside the hashed
 * history document, so flag-off receipt bytes stay the same.
 */
import { jcsRfc8785 } from './offer-receipt.js';
import { currentIssuerHistory } from './issuer-history.js';

export const ISSUER_HISTORY_MIRROR_SCHEMA = 'chit402.issuer_history_mirror.v1';
export const DEFAULT_MIRROR_PATH = 'issuer-history.json';

const MIRROR_NOTE = 'The gateway does not push this document. /.well-known/issuer-history.json is the announcement copy and is not a second custodian. The pinned copy is the file at this repo, commit, and path. sha256 is SHA-256 of that file, the chit402-jcs-v1 issuer-history document.';

function normalizeRepo(raw) {
  let text = String(raw || '').trim().replace(/\.git$/, '');
  if (!text || text.includes('@') || text.includes('\\')) return null;
  const url = text.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (url) return `${url[1]}/${url[2]}`;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) return text;
  return null;
}

function normalizePath(raw) {
  const text = String(raw || '').trim();
  if (!text) return DEFAULT_MIRROR_PATH;
  if (text.startsWith('/') || text.includes('\\') || text.split('/').includes('..')) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(text)) return null;
  return text;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function readIssuerHistoryMirrorConfig(env = process.env) {
  const repoRaw = String(env.ISSUER_HISTORY_MIRROR_REPO || '').trim();
  const commitRaw = String(env.ISSUER_HISTORY_MIRROR_COMMIT || '').trim().toLowerCase();
  const shaRaw = String(env.ISSUER_HISTORY_MIRROR_SHA256 || '').trim().toLowerCase();
  const pathRaw = String(env.ISSUER_HISTORY_MIRROR_PATH || '').trim();
  const configured = Boolean(repoRaw || commitRaw || shaRaw || pathRaw);
  const repo = normalizeRepo(repoRaw);
  const path = normalizePath(pathRaw);
  const problems = [];
  if (configured) {
    if (!repo) problems.push('ISSUER_HISTORY_MIRROR_REPO');
    if (!/^[0-9a-f]{40}$/.test(commitRaw)) problems.push('ISSUER_HISTORY_MIRROR_COMMIT');
    if (!/^[0-9a-f]{64}$/.test(shaRaw)) problems.push('ISSUER_HISTORY_MIRROR_SHA256');
    if (!path) problems.push('ISSUER_HISTORY_MIRROR_PATH');
  }
  return {
    configured,
    repo,
    commit: configured ? commitRaw : null,
    path: configured ? path : null,
    sha256: configured ? shaRaw : null,
    problems,
  };
}

/**
 * Partial config refuses to boot. An empty config is not a mirror.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertIssuerHistoryMirrorBoot(env = process.env) {
  const cfg = readIssuerHistoryMirrorConfig(env);
  if (!cfg.configured) return null;
  if (cfg.problems.length) {
    throw new Error(`issuer history mirror config is incomplete: ${cfg.problems.join(', ')}`);
  }
  return cfg;
}

/**
 * Signed pin. Throws when the configured sha256 is not the current
 * well-known document hash. Returns null when no mirror is configured.
 * @param {{ hash: string }} record
 * @param {NodeJS.ProcessEnv} [env]
 */
export function issuerHistoryMirrorClaim(record, env = process.env) {
  const cfg = assertIssuerHistoryMirrorBoot(env);
  if (!cfg) return null;
  if (!record || record.hash !== cfg.sha256) {
    const err = new Error('issuer history mirror sha256 does not match the published document');
    err.code = 'issuer_history_mirror_stale';
    throw err;
  }
  return {
    repo: cfg.repo,
    commit: cfg.commit,
    path: cfg.path,
    sha256: cfg.sha256,
  };
}

/**
 * Unsigned announcement. custodian is false. This object is not part of
 * the hashed issuer-history document.
 * @param {{ hash: string }} record
 * @param {NodeJS.ProcessEnv} [env]
 */
export function issuerHistoryMirrorAnnouncement(record, env = process.env) {
  const pin = issuerHistoryMirrorClaim(record, env);
  if (!pin) return null;
  return {
    schema: ISSUER_HISTORY_MIRROR_SCHEMA,
    role: 'announcement',
    custodian: false,
    ...pin,
    note: MIRROR_NOTE,
  };
}

/**
 * Bytes an operator commits. This function does not write them anywhere.
 * @param {{ body: string }} record
 */
export function issuerHistoryMirrorFileBytes(record) {
  return record.body;
}

/**
 * @param {import('express').Response} res
 * @param {{ hash: string, body: string }|null} [record]
 */
export function writeIssuerHistoryMirror(res, record = null) {
  const cfg = readIssuerHistoryMirrorConfig();
  if (!cfg.configured) {
    return res.status(404).json({
      error: 'not_configured',
      message: 'No commit-pinned issuer history mirror is configured. /.well-known/issuer-history.json is only the announcement copy.',
    });
  }
  if (cfg.problems.length) {
    return res.status(500).json({
      error: 'mirror_config',
      message: `issuer history mirror config is incomplete: ${cfg.problems.join(', ')}`,
    });
  }
  const current = record || currentIssuerHistory();
  let doc;
  try {
    doc = issuerHistoryMirrorAnnouncement(current);
  } catch (err) {
    if (err.code === 'issuer_history_mirror_stale') {
      return res.status(409).json({ error: err.code, message: err.message });
    }
    throw err;
  }
  const body = jcsRfc8785(doc);
  res.set('Cache-Control', 'public, max-age=300');
  res.set('X-Chit-Mirror-Custodian', 'false');
  res.type('application/json; charset=utf-8');
  return res.send(Buffer.from(body, 'utf8'));
}
