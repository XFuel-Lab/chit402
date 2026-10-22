/**
 * Frozen receipt version registry (verifier redesign step 2, rule #1).
 *
 * One table: every receipt version the verifier accepts, the rule set it
 * shipped with, the layers it supports, a draft assurance label, and the
 * version where each version-gated feature starts. Entries are append-only.
 * A rule set is never edited: `rule_set_digest` covers every rule field and
 * the frozen copy in test/fixtures/version-registry.frozen.json pins it.
 * Only `status`, `weakened_at` and `weakened_reason` may change, through the
 * recorded "marking a version weaker" path.
 *
 * Layers: A signature (offline, pinned issuer history), B payment (on
 * chain), C log inclusion and anchor.
 *
 * This step moves the scattered version gates here without changing a
 * result. Validity windows (step 3) and the assurance label key (step 7)
 * read from this table later.
 */
import { createHash } from 'node:crypto';

export type VersionForm = 'signed' | 'inferred' | 'detached' | 'v';
export type Layer = 'A' | 'B' | 'C';
export type VersionStatus = 'active' | 'weakened';

export interface VersionRule {
  /** Stable id, e.g. `pv10`, `legacy-v4`, `detached`, `v11`. */
  id: string;
  /** Payload or `v` version number. Null for the detached form. */
  version: number | null;
  form: VersionForm;
  /** Rule set id. Never reused. */
  rule_set: string;
  /** Layers the version supports. `C?` means only when the receipt has a leaf. */
  layers: readonly ('A' | 'B' | 'C' | 'C?')[];
  /** Draft label for the step 7 assurance key. Not emitted yet. */
  label: string;
  /** True for the L1 closed allowlist classes (v4/v5 without a signed version, and detached). */
  l1_allowlist: boolean;
  /** Version-gated features this rule set checks. */
  features: {
    /** v8 field list for the canonical issuer payload and settled amount. */
    v8_fields: boolean;
    /** Signed (tree_head_hash, tolerance) pair. */
    head_binding: boolean;
    /** Signed issuer history pin and canonical preimage. */
    canonical_preimage: boolean;
  };
  status: VersionStatus;
  weakened_at: string | null;
  weakened_reason: string | null;
}

export interface RegisteredVersion extends VersionRule {
  rule_set_digest: string;
}

/** First payload version of each version-gated feature. */
export const FEATURE_FIRST_VERSION = Object.freeze({
  v8_fields: 8,
  head_binding: 9,
  canonical_preimage: 10,
} as const);

export type VersionFeature = keyof typeof FEATURE_FIRST_VERSION;

function features(version: number) {
  return {
    v8_fields: version >= FEATURE_FIRST_VERSION.v8_fields,
    head_binding: version >= FEATURE_FIRST_VERSION.head_binding,
    canonical_preimage: version >= FEATURE_FIRST_VERSION.canonical_preimage,
  };
}

function pvLabel(version: number): string {
  if (version <= 5) return `v${version}: signature + payment`;
  if (version <= 8) return `v${version}: signature + payment; log only if in log`;
  if (version === 9) return 'v9: signature + payment + log; signed covering head';
  return 'v10: signature + payment + log; signed history pin and preimage';
}

const RULES: VersionRule[] = [
  ...Array.from({ length: 10 }, (_, i) => i + 1).map((version): VersionRule => ({
    id: `pv${version}`,
    version,
    form: 'signed',
    rule_set: `rs-pv${version}-1`,
    layers: version >= 9 ? ['A', 'B', 'C'] : ['A', 'B', 'C?'],
    label: pvLabel(version),
    l1_allowlist: false,
    features: features(version),
    status: 'active',
    weakened_at: null,
    weakened_reason: null,
  })),
  {
    id: 'pv11-issuer-root',
    version: 11,
    form: 'signed',
    rule_set: 'rs-pv11-issuer-root-1',
    layers: ['A', 'B', 'C'],
    label: 'v11: signature + payment + log; issuer root',
    l1_allowlist: false,
    features: features(11),
    status: 'active',
    weakened_at: null,
    weakened_reason: null,
  },
  {
    id: 'v11',
    version: 11,
    form: 'v',
    rule_set: 'rs-v11-1',
    layers: ['A', 'B', 'C?'],
    label: 'v11: signature + payment; log support unconfirmed',
    l1_allowlist: false,
    features: { v8_fields: true, head_binding: false, canonical_preimage: false },
    status: 'active',
    weakened_at: null,
    weakened_reason: null,
  },
  ...[4, 5].map((version): VersionRule => ({
    id: `legacy-v${version}`,
    version,
    form: 'inferred',
    rule_set: `rs-legacy-v${version}-1`,
    layers: ['A', 'B'],
    label: `v${version}: signature + payment; version inferred, not signed; no leaf version`,
    l1_allowlist: true,
    features: features(version),
    status: 'active',
    weakened_at: null,
    weakened_reason: null,
  })),
  {
    id: 'detached',
    version: null,
    form: 'detached',
    rule_set: 'rs-detached-1',
    layers: ['A', 'B'],
    label: 'legacy detached: signature + payment; version not signed',
    l1_allowlist: true,
    features: { v8_fields: false, head_binding: false, canonical_preimage: false },
    status: 'active',
    weakened_at: null,
    weakened_reason: null,
  },
];

/** JSON with sorted keys, for the rule-set digest. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Fields outside the digest: the weakened path, and the digest itself. */
const MUTABLE_FIELDS = new Set(['status', 'weakened_at', 'weakened_reason', 'rule_set_digest']);

/** SHA-256 over every rule field except the weakened-path fields. */
export function ruleSetDigest(rule: VersionRule): string {
  const frozen: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rule)) if (!MUTABLE_FIELDS.has(k)) frozen[k] = v;
  return createHash('sha256').update(canonical(frozen)).digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

export const VERSION_REGISTRY: readonly RegisteredVersion[] = deepFreeze(
  RULES.map((rule) => ({ ...rule, rule_set_digest: ruleSetDigest(rule) })),
);

/** Registry entry for a signed payload version, or null. */
export function registeredPayloadVersion(version: number): RegisteredVersion | null {
  return VERSION_REGISTRY.find((r) => r.form === 'signed' && r.version === version && r.id === `pv${version}`) ?? null;
}

/** Registry entry by id, or null. */
export function registeredVersion(id: string): RegisteredVersion | null {
  return VERSION_REGISTRY.find((r) => r.id === id) ?? null;
}

/**
 * True when a payload version number is at or past the first version of a
 * feature. Same comparison the gates used before the registry; the
 * threshold comes from the table.
 */
export function versionHasFeature(version: number, feature: VersionFeature): boolean {
  return version >= FEATURE_FIRST_VERSION[feature];
}
