/**
 * Three copies of the issuer key window. Any disagreement fails by name.
 * A history document served from a chit402 origin is self_asserted.
 * One copy is never independent.
 *
 * Credit: moth-lamp (1F916 #7404 c95705/c96118), ellie-v2 (#6941 c95838),
 * dash-agent (#7404 c95336).
 */
import type { IssuerHistoryDocument, IssuerHistoryEntry } from './issuer-history.js';
import { jwkThumbprint, type Es256Jwk } from './jws.js';

export type IndependenceVerdict = 'independent' | 'self_asserted' | 'not_independent' | 'disagree';

export interface KidWindow {
  kid: string;
  notBefore: number | null;
  notAfter: number | null;
  revokedAt: number | null;
  thumbprint: string | null;
  status: string | null;
}

export interface IndependenceResult {
  verdict: IndependenceVerdict;
  reason: string | null;
  /** Sources that count. A chit402-hosted history is listed as self_asserted, not as a peer. */
  sources: Array<'commit' | 'snapshot' | 'registry'>;
  selfAsserted: boolean;
}

function timeOf(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function isChit402Origin(value: string | null | undefined): boolean {
  if (!value) return false;
  let host = value.trim().toLowerCase();
  try {
    if (host.includes('://')) host = new URL(value).hostname.toLowerCase();
  } catch {
    host = host.split('/')[0];
  }
  return host === 'chit402.com' || host.endsWith('.chit402.com');
}

export function windowFromEntry(entry: IssuerHistoryEntry | null | undefined): KidWindow | null {
  if (!entry || typeof entry.kid !== 'string' || entry.kid.length === 0) return null;
  let thumbprint: string | null = null;
  if (entry.jwk && entry.jwk.x && entry.jwk.y) {
    try {
      thumbprint = jwkThumbprint(entry.jwk as Es256Jwk);
    } catch {
      thumbprint = null;
    }
  }
  return {
    kid: entry.kid,
    notBefore: timeOf(entry.not_before),
    notAfter: timeOf(entry.not_after),
    revokedAt: timeOf(entry.revoked_at),
    thumbprint,
    status: typeof entry.status === 'string' ? entry.status : null,
  };
}

export function windowForKid(doc: IssuerHistoryDocument | null | undefined, kid: string | null): KidWindow | null {
  if (!doc || !kid || !Array.isArray(doc.entries)) return null;
  const entry = doc.entries.find((row) => row.kid === kid);
  return windowFromEntry(entry);
}

function fieldDiff(left: KidWindow, right: KidWindow): boolean {
  if (left.kid !== right.kid) return true;
  const pairs: Array<[number | null, number | null]> = [
    [left.notBefore, right.notBefore],
    [left.notAfter, right.notAfter],
    [left.revokedAt, right.revokedAt],
  ];
  for (const [a, b] of pairs) {
    if (a != null && b != null && a !== b) return true;
  }
  if (left.thumbprint && right.thumbprint && left.thumbprint !== right.thumbprint) return true;
  if (left.status && right.status && left.status !== right.status) return true;
  return false;
}

export function assessIndependence(input: {
  kid: string | null;
  commit?: IssuerHistoryDocument | null;
  snapshot?: IssuerHistoryDocument | null;
  /** True when the snapshot or fetched history was served from a chit402 host. */
  snapshotFromChit402?: boolean;
  registry?: KidWindow | null;
}): IndependenceResult {
  const commit = windowForKid(input.commit, input.kid);
  const snapshot = windowForKid(input.snapshot, input.kid);
  const registry = input.registry && input.registry.kid === input.kid ? input.registry : (input.registry ?? null);
  const selfAsserted = input.snapshotFromChit402 === true && snapshot != null;

  if (commit && snapshot && fieldDiff(commit, snapshot)) {
    return { verdict: 'disagree', reason: 'commit_snapshot_disagree', sources: ['commit', 'snapshot'], selfAsserted };
  }
  if (commit && registry && fieldDiff(commit, registry)) {
    return { verdict: 'disagree', reason: 'commit_registry_disagree', sources: ['commit', 'registry'], selfAsserted };
  }
  if (snapshot && registry && fieldDiff(snapshot, registry)) {
    return { verdict: 'disagree', reason: 'snapshot_registry_disagree', sources: ['snapshot', 'registry'], selfAsserted };
  }

  const independentSources = [commit ? 'commit' as const : null, registry ? 'registry' as const : null].filter(
    (row): row is 'commit' | 'registry' => row != null,
  );
  const listed: IndependenceResult['sources'] = [
    ...independentSources,
    ...(snapshot && !selfAsserted ? ['snapshot' as const] : []),
  ];
  if (selfAsserted && independentSources.length === 0) {
    return { verdict: 'self_asserted', reason: null, sources: [], selfAsserted: true };
  }
  if (independentSources.length >= 2 || (independentSources.length >= 1 && snapshot != null && !selfAsserted)) {
    return { verdict: 'independent', reason: null, sources: listed, selfAsserted };
  }
  return { verdict: 'not_independent', reason: null, sources: listed, selfAsserted };
}
