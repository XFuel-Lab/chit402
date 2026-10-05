/**
 * Issuer-root verification for @xfuel/verify 0.4.0.
 *
 * Root checks are opt-in until a mainnet registry exists. With no pin
 * configured, callers keep the 0.3.0 result. A pin is a chain id
 * (`eip155:8453` or `eip155:84532`) plus a real registry address. This
 * package does not ship a placeholder mainnet address.
 *
 * Chain reads use two independent RPCs at `finalized`, compared at the
 * minimum of their finalized heads. The log cache is caller-supplied and
 * unsigned: it never upgrades a verdict to pass.
 */

import { createHash } from 'node:crypto';
import { Contract, JsonRpcProvider, Interface, getAddress, isAddress, type Log } from 'ethers';
import { DEFAULT_TRUSTED_ISSUER_KIDS } from './jws.js';
import {
  DNS_GRACE_EXTRA_SECONDS,
  parseIssuerTxt,
  resolveIssuerTxt,
  sameKidSet,
  type DnsLookupResult,
  type IssuerTxt,
} from './issuer-dns.js';

export type { DnsLookupResult } from './issuer-dns.js';
import {
  decodePayloadHash,
  legacyMerkleRootHex,
  verifyLegacyInclusion,
  type LegacyProofStep,
} from './legacy-merkle.js';

export const PINNED_ROOT_CHAINS = ['eip155:8453', 'eip155:84532'] as const;
export type PinnedRootChain = (typeof PINNED_ROOT_CHAINS)[number];

export const BASE_SEPOLIA_REGISTRY_RPC = 'https://sepolia.base.org';
/** Read-only default. Not a write endpoint and not a trusted registry. */
export const BASE_MAINNET_REGISTRY_RPC = 'https://mainnet.base.org';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * No trusted mainnet registry is shipped. `registry` stays empty so a
 * missing pin cannot fall through to a placeholder address.
 */
export const PINNED_ROOT: {
  chain: PinnedRootChain | null;
  registry: null;
  genesis_kid: string;
} = {
  chain: null,
  registry: null,
  genesis_kid: DEFAULT_TRUSTED_ISSUER_KIDS[0],
};

export interface PinnedRoot {
  chain: string;
  registry: string;
  genesis_kid?: string;
}

export interface ResolvedPin {
  chain: PinnedRootChain;
  registry: string;
  genesis_kid: string;
}

export const REGISTRY_ABI = [
  'function rootSeq() view returns (uint64)',
  'function rootHash() view returns (bytes32)',
  'function historyVersion() view returns (uint64)',
  'function historySnapshot() view returns (bytes32)',
  'function supersededBy() view returns (address)',
  'function keys(bytes32 kid) view returns (uint8 status, uint64 notBefore, uint64 notAfter, uint64 revokedAt)',
  'function keyValidAt(bytes32 kid, uint64 t) view returns (bool ok, uint8 status)',
  'event RootCommitted(uint64 indexed rootSeq, bytes32 rootHash, uint64 historyVersion, bytes32 historySnapshot)',
  'event KeyStandby(bytes32 indexed kid, uint64 notBefore, uint64 indexed rootSeq)',
  'event KeyActivated(bytes32 indexed kid, uint64 indexed rootSeq)',
  'event KeyRetired(bytes32 indexed kid, uint64 notAfter, uint64 indexed rootSeq)',
  'event KeyRevoked(bytes32 indexed kid, uint64 revokedAt, uint8 reasonCode, uint64 indexed rootSeq)',
  'event Frozen(bytes32 indexed universeId, bytes32 universeHash, uint64 enumeratedCount, uint64 frozenBlock, uint64 indexed rootSeq)',
  'event Superseded(address next)',
] as const;

const REGISTRY_INTERFACE = new Interface(REGISTRY_ABI);

export type RegistryEventName =
  | 'RootCommitted'
  | 'KeyStandby'
  | 'KeyActivated'
  | 'KeyRetired'
  | 'KeyRevoked'
  | 'Frozen'
  | 'Superseded';

export interface RegistryLog {
  blockNumber: number;
  blockTimestamp: number;
  logIndex: number;
  event: RegistryEventName;
  rootSeq?: number;
  rootHash?: string;
  historyVersion?: number;
  historySnapshot?: string;
  kid?: string;
  notBefore?: number;
  notAfter?: number;
  revokedAt?: number;
  reasonCode?: number;
  universeId?: string;
  universeHash?: string;
  enumeratedCount?: number;
  frozenBlock?: number;
  next?: string;
}

export interface KeyStorage {
  status: number;
  notBefore: number;
  notAfter: number;
  revokedAt: number;
}

/** One RPC's view of the registry at a single block. */
export interface ChainView {
  blockNumber: number;
  blockTimestamp: number;
  rootSeq: number;
  rootHash: string;
  historyVersion: number;
  historySnapshot: string;
  supersededBy: string;
  keys: Record<string, KeyStorage>;
  logs: RegistryLog[];
}

export interface IssuerRootRpc {
  read(tag: number | 'finalized' | 'latest'): Promise<ChainView>;
}

/**
 * Caller-supplied log cache. Unsigned. The signature field is ignored.
 * A cache never upgrades a verdict to `pass`.
 */
export interface CallerLogCache {
  asOfBlock?: number;
  signature?: string;
  signed?: boolean;
}

export interface IssuerRootClaim {
  v?: number;
  chain_id?: string;
  registry?: string;
  root_seq?: number;
  root_hash?: string;
  kid?: string;
}

export interface HistoryWindow {
  found: boolean;
  notBefore?: number | null;
  notAfter?: number | null;
  revokedAt?: number | null;
  status?: string | null;
}

export interface LegacyProofInput {
  universeId: string;
  index: number;
  leafCount: number;
  proof: LegacyProofStep[];
}

export type IssuerRootVerdictName =
  | 'pass'
  | 'pass_dns_unavailable'
  | 'unverified_root'
  | 'pin_only'
  | 'pass_legacy_root'
  | 'unpinned'
  | `fail_${string}`;

export interface IssuerRootVerdict {
  verdict: IssuerRootVerdictName;
  reason: string | null;
  warnings: string[];
  /** `yellow` is the pass_dns_unavailable display. It is still a pass. */
  display: 'yellow' | 'normal';
  /** "as of block N, caller cache" or "package trust only". */
  note: string | null;
  compared_block: number | null;
  dnssec: 'validated' | 'unsigned' | 'unchecked';
}

export interface IssuerRootInput {
  signatureValid: boolean;
  signatureReason?: string | null;
  jwsKid: string | null;
  thumbprint: string | null;
  issuerRoot: IssuerRootClaim | null;
  payloadVersion: number | null;
  iat: number | null;
  payloadHash: string | null;
  /** `null` leaves checks off. An invalid object is rejected by resolvePinnedRoot. */
  pin: ResolvedPin | null;
  offline?: boolean;
  requireDns?: boolean;
  requireDnssec?: boolean;
  rpcs?: IssuerRootRpc[];
  dns?: DnsLookupResult | (() => Promise<DnsLookupResult>);
  domain?: string;
  cache?: CallerLogCache | null;
  /** Unix seconds. Defaults to the wall clock. */
  now?: number;
  history?: HistoryWindow | null;
  legacyProof?: LegacyProofInput | null;
}

export type PinResolution =
  | { mode: 'off' }
  | { mode: 'reject' }
  | { mode: 'on'; pin: ResolvedPin };

const KEY_NONE = 0;
const KEY_STANDBY = 1;
const KEY_ACTIVE = 2;
const KEY_RETIRED = 3;
const KEY_REVOKED = 4;

function fail(
  reason: string,
  extra: Partial<IssuerRootVerdict> = {},
): IssuerRootVerdict {
  return {
    verdict: `fail_${reason}`,
    reason,
    warnings: extra.warnings ?? [],
    display: 'normal',
    note: extra.note ?? null,
    compared_block: extra.compared_block ?? null,
    dnssec: extra.dnssec ?? 'unchecked',
  };
}

function okVerdict(
  verdict: IssuerRootVerdictName,
  extra: Partial<IssuerRootVerdict> = {},
): IssuerRootVerdict {
  return {
    verdict,
    reason: extra.reason ?? null,
    warnings: extra.warnings ?? [],
    display: extra.display ?? 'normal',
    note: extra.note ?? null,
    compared_block: extra.compared_block ?? null,
    dnssec: extra.dnssec ?? 'unchecked',
  };
}

export function kidToBytes32(kid: string): string | null {
  try {
    const buf = Buffer.from(kid, 'base64url');
    if (buf.length !== 32) return null;
    return `0x${buf.toString('hex')}`;
  } catch {
    return null;
  }
}

export function bytes32ToKid(hex: string): string | null {
  const raw = hex.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, 'hex').toString('base64url');
}

function normHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.toLowerCase();
  if (/^0x[0-9a-f]{64}$/.test(hex)) return hex;
  if (/^[0-9a-f]{64}$/.test(hex)) return `0x${hex}`;
  return null;
}

function sameAddr(left: string, right: string): boolean {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

/**
 * A pin is trusted only when the chain is Base mainnet or Base Sepolia and
 * the registry is a real address. The zero address is not trusted. An empty
 * configuration is off, not rejected.
 */
export function resolvePinnedRoot(
  pin: PinnedRoot | null | undefined,
  env: NodeJS.ProcessEnv = {},
): PinResolution {
  if (pin === null) return { mode: 'off' };
  const source: PinnedRoot | null = pin ?? pinFromEnv(env);
  if (!source) return { mode: 'off' };
  const chain = source.chain;
  if (chain !== 'eip155:8453' && chain !== 'eip155:84532') return { mode: 'reject' };
  if (!source.registry || !isAddress(source.registry)) return { mode: 'reject' };
  const registry = getAddress(source.registry);
  if (registry === getAddress(ZERO_ADDRESS)) return { mode: 'reject' };
  const genesis = source.genesis_kid || DEFAULT_TRUSTED_ISSUER_KIDS[0];
  if (!kidToBytes32(genesis)) return { mode: 'reject' };
  return { mode: 'on', pin: { chain, registry, genesis_kid: genesis } };
}

function pinFromEnv(env: NodeJS.ProcessEnv): PinnedRoot | null {
  const chain = env.CHIT_PINNED_CHAIN || '';
  const registry = env.CHIT_PINNED_REGISTRY || '';
  const genesis = env.CHIT_GENESIS_KID || '';
  if (!chain && !registry && !genesis) return null;
  return { chain, registry, genesis_kid: genesis || undefined };
}

export function cacheNote(cache: CallerLogCache | null | undefined): string | null {
  if (!cache || cache.asOfBlock == null || !Number.isInteger(cache.asOfBlock)) return null;
  return `as of block ${cache.asOfBlock}, caller cache`;
}

function unavailable(
  cache: CallerLogCache | null | undefined,
  dnssec: IssuerRootVerdict['dnssec'] = 'unchecked',
): IssuerRootVerdict {
  return okVerdict('unverified_root', {
    reason: 'rpc_unavailable',
    note: cacheNote(cache),
    dnssec,
  });
}

/**
 * Active kids at `seq`, rebuilt from events.
 * The pinned genesis kid starts active (constructor seed, no event).
 * Later events with rootSeq <= seq overwrite that status.
 */
export function activeKidsAtSeq(logs: RegistryLog[], seq: number, genesisKid: string): string[] {
  const status = new Map<string, number>();
  if (genesisKid) status.set(genesisKid, KEY_ACTIVE);
  const ordered = [...logs].sort((a, b) => (
    (a.rootSeq ?? 0) - (b.rootSeq ?? 0)
    || a.blockNumber - b.blockNumber
    || a.logIndex - b.logIndex
  ));
  for (const log of ordered) {
    if (log.rootSeq == null || log.rootSeq > seq || !log.kid) continue;
    if (log.event === 'KeyStandby') status.set(log.kid, KEY_STANDBY);
    else if (log.event === 'KeyActivated') status.set(log.kid, KEY_ACTIVE);
    else if (log.event === 'KeyRetired') status.set(log.kid, KEY_RETIRED);
    else if (log.event === 'KeyRevoked') status.set(log.kid, KEY_REVOKED);
  }
  return [...status.entries()].filter(([, value]) => value === KEY_ACTIVE).map(([kid]) => kid).sort();
}

export function wasEverActive(kid: string, view: ChainView, genesisKid: string): boolean {
  const current = view.keys[kid];
  if (current && (current.status === KEY_ACTIVE || current.status === KEY_RETIRED)) return true;
  if (kid === genesisKid) return true;
  return view.logs.some((log) => log.event === 'KeyActivated' && log.kid === kid);
}

/**
 * Local keyValidAt. A revoked key still passes when it was ever active and
 * `iat` is strictly before `revokedAt`. The contract helper returns false for
 * every revoked status, so the verifier does not use that boolean alone.
 */
export function keyVerdictAt(
  kid: string,
  iat: number | null,
  view: ChainView,
  genesisKid: string,
): 'ok' | 'key_unknown' | 'key_outside_window' | 'key_revoked_at_iat' {
  const state = view.keys[kid];
  const seen = !!state && state.status !== KEY_NONE
    || view.logs.some((log) => log.kid === kid)
    || kid === genesisKid && !!state;
  if (!state || state.status === KEY_NONE) return 'key_unknown';
  if (!seen) return 'key_unknown';
  if (iat == null) return 'key_outside_window';
  if (iat < state.notBefore) return 'key_outside_window';
  if (state.notAfter !== 0 && iat > state.notAfter) return 'key_outside_window';
  const ever = wasEverActive(kid, view, genesisKid);
  if (state.status === KEY_REVOKED && (state.revokedAt === 0 || iat >= state.revokedAt)) {
    return 'key_revoked_at_iat';
  }
  if (state.revokedAt !== 0 && iat >= state.revokedAt) return 'key_revoked_at_iat';
  if (state.status === KEY_ACTIVE || state.status === KEY_RETIRED) return 'ok';
  if (state.status === KEY_REVOKED && ever && state.revokedAt !== 0 && iat < state.revokedAt) return 'ok';
  return 'key_outside_window';
}

function findCommit(logs: RegistryLog[], seq: number): RegistryLog | null {
  const hits = logs.filter((log) => log.event === 'RootCommitted' && log.rootSeq === seq);
  if (hits.length === 0) return null;
  return hits.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)[0];
}

function findFreeze(logs: RegistryLog[], universeId: string): RegistryLog | null {
  let id = universeId.toLowerCase();
  if (!id.startsWith('0x')) id = `0x${id}`;
  return logs.find((log) => log.event === 'Frozen' && (log.universeId || '').toLowerCase() === id) ?? null;
}

export function chainViewDigest(view: ChainView): string {
  const norm = {
    blockNumber: view.blockNumber,
    blockTimestamp: view.blockTimestamp,
    rootSeq: view.rootSeq,
    rootHash: (view.rootHash || '').toLowerCase(),
    historyVersion: view.historyVersion,
    historySnapshot: (view.historySnapshot || '').toLowerCase(),
    supersededBy: (view.supersededBy || '').toLowerCase(),
    keys: Object.entries(view.keys).sort(([a], [b]) => a.localeCompare(b)).map(([kid, key]) => ({
      kid,
      status: key.status,
      notBefore: key.notBefore,
      notAfter: key.notAfter,
      revokedAt: key.revokedAt,
    })),
    logs: [...view.logs]
      .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
      .map((log) => ({
        event: log.event,
        rootSeq: log.rootSeq ?? null,
        rootHash: (log.rootHash || '').toLowerCase(),
        kid: log.kid ?? null,
        notBefore: log.notBefore ?? null,
        notAfter: log.notAfter ?? null,
        revokedAt: log.revokedAt ?? null,
        universeId: (log.universeId || '').toLowerCase(),
        universeHash: (log.universeHash || '').toLowerCase(),
        enumeratedCount: log.enumeratedCount ?? null,
        next: (log.next || '').toLowerCase(),
        historyVersion: log.historyVersion ?? null,
        historySnapshot: (log.historySnapshot || '').toLowerCase(),
      })),
  };
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

/**
 * Both RPCs are read at `finalized`. The comparison block is the minimum of
 * those heads. The ahead RPC is read again at that block. `latest` is never
 * the comparison tag.
 */
export async function readAgreedView(rpcs: IssuerRootRpc[]): Promise<
  | { ok: true; view: ChainView }
  | { ok: false; reason: 'rpc_unavailable' | 'rpc_disagree' }
> {
  if (rpcs.length < 2) return { ok: false, reason: 'rpc_unavailable' };
  let left: ChainView;
  let right: ChainView;
  try {
    left = await rpcs[0].read('finalized');
    right = await rpcs[1].read('finalized');
  } catch {
    return { ok: false, reason: 'rpc_unavailable' };
  }
  const block = Math.min(left.blockNumber, right.blockNumber);
  try {
    if (left.blockNumber !== block) left = await rpcs[0].read(block);
    if (right.blockNumber !== block) right = await rpcs[1].read(block);
  } catch {
    return { ok: false, reason: 'rpc_unavailable' };
  }
  if (left.blockNumber !== block || right.blockNumber !== block) {
    return { ok: false, reason: 'rpc_disagree' };
  }
  if (chainViewDigest(left) !== chainViewDigest(right)) return { ok: false, reason: 'rpc_disagree' };
  return { ok: true, view: left };
}

function dnssecOf(dns: DnsLookupResult | null): IssuerRootVerdict['dnssec'] {
  if (dns && dns.status === 'ok') return dns.dnssec;
  return 'unchecked';
}

async function loadDns(input: IssuerRootInput): Promise<DnsLookupResult> {
  if (!input.dns) return resolveIssuerTxt(input.domain);
  if (typeof input.dns === 'function') return input.dns();
  return input.dns;
}

function historyAgrees(history: HistoryWindow | null | undefined, state: KeyStorage): boolean {
  if (!history || !history.found) return false;
  if (history.notBefore == null || history.notBefore !== state.notBefore) return false;
  const notAfter = history.notAfter ?? 0;
  if (notAfter !== state.notAfter) return false;
  const revoked = history.revokedAt ?? 0;
  if (history.status === 'revoked') {
    if (state.revokedAt === 0 || revoked !== state.revokedAt) return false;
  } else if (revoked !== 0 && revoked !== state.revokedAt) return false;
  return true;
}

function graceOpen(committedAt: number, now: number, ttl: number): boolean {
  return now - committedAt <= ttl + DNS_GRACE_EXTRA_SECONDS;
}

/**
 * Follow a superseded registry only when the package pin and DNS `reg` both
 * already name `next`. A pin that still names the old registry does not.
 */
export function supersessionConfirmed(pinRegistry: string, dnsReg: string | null, next: string): boolean {
  if (!next || sameAddr(next, ZERO_ADDRESS)) return false;
  if (!dnsReg) return false;
  return sameAddr(pinRegistry, next) && sameAddr(dnsReg, next);
}

function checkDns(input: {
  pin: ResolvedPin;
  view: ChainView;
  dns: DnsLookupResult;
  receiptKid: string;
  requireDns: boolean;
  requireDnssec: boolean;
  now: number;
}): IssuerRootVerdict | { ok: true; warnings: string[]; dnssec: IssuerRootVerdict['dnssec']; unavailable: boolean } {
  const dnssec = dnssecOf(input.dns);
  if (input.dns.status === 'timeout' || input.dns.status === 'servfail') {
    if (input.requireDns) return fail('dns_unavailable', { dnssec, compared_block: input.view.blockNumber });
    if (input.requireDnssec) return fail('dnssec_required', { dnssec, compared_block: input.view.blockNumber });
    return { ok: true as const, warnings: [] as string[], dnssec, unavailable: true as const };
  }
  if (input.dns.status === 'nxdomain') {
    return fail('dns_missing', { dnssec, compared_block: input.view.blockNumber });
  }
  const parsed = parseIssuerTxt(input.dns.records);
  if (!parsed.ok) return fail(parsed.reason, { dnssec, compared_block: input.view.blockNumber });
  const txt: IssuerTxt = parsed.txt;
  if (txt.chain !== input.pin.chain || !sameAddr(txt.reg, input.pin.registry)) {
    return fail('dns_registry_mismatch', { dnssec, compared_block: input.view.blockNumber });
  }
  if (txt.seq > input.view.rootSeq) {
    return fail('dns_ahead_of_chain', { dnssec, compared_block: input.view.blockNumber });
  }
  const commit = findCommit(input.view.logs, txt.seq);
  const txtRoot = normHex(txt.root);
  const commitRoot = normHex(commit?.rootHash);
  if (!commit || !txtRoot || txtRoot !== commitRoot) {
    return fail('dns_chain_disagree', { dnssec, compared_block: input.view.blockNumber });
  }
  const chainKids = activeKidsAtSeq(input.view.logs, txt.seq, input.pin.genesis_kid);
  const warnings: string[] = [];
  if (!sameKidSet(txt.kids, chainKids)) {
    const dnsDroppedReceiptKid = chainKids.includes(input.receiptKid) && !txt.kids.includes(input.receiptKid);
    const committedAt = commit.blockTimestamp;
    const inside = graceOpen(committedAt, input.now, input.dns.ttl);
    if (dnsDroppedReceiptKid || !inside) {
      return fail('dns_chain_disagree', { dnssec, compared_block: input.view.blockNumber });
    }
    warnings.push('dns_lagging');
  }
  if (input.requireDnssec && input.dns.dnssec !== 'validated') {
    return fail('dnssec_required', { dnssec, warnings, compared_block: input.view.blockNumber });
  }
  return { ok: true as const, warnings, dnssec, unavailable: false as const };
}

function applyHistory(
  view: ChainView,
  kid: string,
  history: HistoryWindow | null | undefined,
  partial: Partial<IssuerRootVerdict>,
): IssuerRootVerdict | null {
  const state = view.keys[kid];
  if (!state || !historyAgrees(history, state)) {
    return fail('history_chain_disagree', partial);
  }
  return null;
}

export async function verifyIssuerRoot(input: IssuerRootInput): Promise<IssuerRootVerdict> {
  if (!input.pin) return okVerdict('unpinned');

  if (!input.signatureValid) {
    if (input.signatureReason === 'kid_mismatch') return fail('kid_mismatch');
    return fail('signature_invalid');
  }
  if (!input.thumbprint || !input.jwsKid || input.thumbprint !== input.jwsKid) {
    return fail('kid_mismatch');
  }

  const claim = input.issuerRoot;
  const legacy = !claim;
  if (legacy && input.payloadVersion != null && input.payloadVersion >= 11) {
    return fail('registry_unpinned');
  }
  if (!legacy) {
    if (claim.v !== 1) return fail('registry_unpinned');
    if (claim.chain_id !== input.pin.chain) return fail('registry_unpinned');
    if (!claim.registry || !sameAddr(claim.registry, input.pin.registry)) return fail('registry_unpinned');
    if (claim.kid !== input.thumbprint) return fail('kid_mismatch');
    const root = normHex(claim.root_hash);
    if (!root || !Number.isInteger(claim.root_seq) || (claim.root_seq ?? 0) < 1) {
      return fail('registry_unpinned');
    }
  }

  const kid = input.thumbprint;

  if (input.offline) {
    if (kid !== input.pin.genesis_kid) return fail('key_unknown');
    if (!legacy && claim?.kid && claim.kid !== input.pin.genesis_kid) return fail('key_unknown');
    return okVerdict('pin_only', { note: 'package trust only' });
  }

  const agreed = await readAgreedView(input.rpcs ?? []);
  if (!agreed.ok) {
    if (agreed.reason === 'rpc_disagree') return fail('rpc_disagree');
    return unavailable(input.cache);
  }
  const view = agreed.view;
  const compared = { compared_block: view.blockNumber };

  if (!legacy) {
    if (view.rootSeq < (claim.root_seq as number)) return fail('root_from_future', compared);
    const commit = findCommit(view.logs, claim.root_seq as number);
    const want = normHex(claim.root_hash);
    const got = normHex(commit?.rootHash);
    if (!commit || !want || want !== got) return fail('root_hash_mismatch', compared);
  }

  const keyReason = keyVerdictAt(kid, input.iat, view, input.pin.genesis_kid);
  if (keyReason !== 'ok') return fail(keyReason, compared);

  if (view.supersededBy && !sameAddr(view.supersededBy, ZERO_ADDRESS)) {
    return fail('superseded_unconfirmed', compared);
  }

  if (legacy) {
    const proof = input.legacyProof;
    const payload = input.payloadHash ? decodePayloadHash(input.payloadHash) : null;
    if (!proof || !payload) return fail('legacy_not_in_freeze', compared);
    const freeze = findFreeze(view.logs, proof.universeId);
    if (!freeze || !freeze.universeHash) return fail('legacy_not_in_freeze', compared);
    if (freeze.enumeratedCount != null && freeze.enumeratedCount !== proof.leafCount) {
      return fail('legacy_not_in_freeze', compared);
    }
    const included = verifyLegacyInclusion(
      payload,
      proof.index,
      proof.leafCount,
      proof.proof,
      freeze.universeHash,
    );
    if (!included) return fail('legacy_not_in_freeze', compared);
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const dns = await loadDns(input);
  const dnsResult = checkDns({
    pin: input.pin,
    view,
    dns,
    receiptKid: kid,
    requireDns: input.requireDns === true,
    requireDnssec: input.requireDnssec === true,
    now,
  });
  if ('verdict' in dnsResult) return dnsResult;

  if (!legacy) {
    const historyFail = applyHistory(view, kid, input.history, {
      ...compared,
      warnings: dnsResult.warnings,
      dnssec: dnsResult.dnssec,
    });
    if (historyFail) return historyFail;
  }

  if (legacy) {
    return okVerdict('pass_legacy_root', {
      warnings: dnsResult.warnings,
      display: dnsResult.unavailable ? 'yellow' : 'normal',
      reason: dnsResult.unavailable ? 'dns_unavailable' : null,
      dnssec: dnsResult.dnssec,
      compared_block: view.blockNumber,
    });
  }

  if (dnsResult.unavailable) {
    return okVerdict('pass_dns_unavailable', {
      reason: 'dns_unavailable',
      display: 'yellow',
      warnings: dnsResult.warnings,
      dnssec: dnsResult.dnssec,
      compared_block: view.blockNumber,
    });
  }
  return okVerdict('pass', {
    warnings: dnsResult.warnings,
    dnssec: dnsResult.dnssec,
    compared_block: view.blockNumber,
  });
}

function num(value: bigint | number): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function hex32(value: string): string {
  return value.toLowerCase();
}

/** Parse one registry log. Unknown topics return null. */
export function parseRegistryLog(
  log: { topics: readonly string[]; data: string; blockNumber: number; index?: number; transactionIndex?: number },
  blockTimestamp: number,
): RegistryLog | null {
  let parsed: ReturnType<Interface['parseLog']>;
  try {
    parsed = REGISTRY_INTERFACE.parseLog({ topics: [...log.topics], data: log.data } as unknown as Log);
  } catch {
    return null;
  }
  if (!parsed) return null;
  const base: RegistryLog = {
    blockNumber: log.blockNumber,
    blockTimestamp,
    logIndex: log.index ?? log.transactionIndex ?? 0,
    event: parsed.name as RegistryEventName,
  };
  if (parsed.name === 'RootCommitted') {
    return {
      ...base,
      rootSeq: num(parsed.args.rootSeq),
      rootHash: hex32(parsed.args.rootHash),
      historyVersion: num(parsed.args.historyVersion),
      historySnapshot: hex32(parsed.args.historySnapshot),
    };
  }
  if (parsed.name === 'KeyStandby') {
    return {
      ...base,
      kid: bytes32ToKid(parsed.args.kid) ?? undefined,
      notBefore: num(parsed.args.notBefore),
      rootSeq: num(parsed.args.rootSeq),
    };
  }
  if (parsed.name === 'KeyActivated') {
    return {
      ...base,
      kid: bytes32ToKid(parsed.args.kid) ?? undefined,
      rootSeq: num(parsed.args.rootSeq),
    };
  }
  if (parsed.name === 'KeyRetired') {
    return {
      ...base,
      kid: bytes32ToKid(parsed.args.kid) ?? undefined,
      notAfter: num(parsed.args.notAfter),
      rootSeq: num(parsed.args.rootSeq),
    };
  }
  if (parsed.name === 'KeyRevoked') {
    return {
      ...base,
      kid: bytes32ToKid(parsed.args.kid) ?? undefined,
      revokedAt: num(parsed.args.revokedAt),
      reasonCode: num(parsed.args.reasonCode),
      rootSeq: num(parsed.args.rootSeq),
    };
  }
  if (parsed.name === 'Frozen') {
    return {
      ...base,
      universeId: hex32(parsed.args.universeId),
      universeHash: hex32(parsed.args.universeHash),
      enumeratedCount: num(parsed.args.enumeratedCount),
      frozenBlock: num(parsed.args.frozenBlock),
      rootSeq: num(parsed.args.rootSeq),
    };
  }
  if (parsed.name === 'Superseded') {
    return { ...base, next: getAddress(parsed.args.next) };
  }
  return null;
}

export function connectIssuerRootRpc(url: string, registry: string, genesisKid: string): IssuerRootRpc {
  const provider = new JsonRpcProvider(url);
  const contract = new Contract(registry, REGISTRY_ABI, provider);
  return {
    async read(tag: number | 'finalized' | 'latest'): Promise<ChainView> {
      const blockTag = tag;
      const block = await provider.getBlock(blockTag);
      if (!block) throw new Error('block_unavailable');
      const blockNumber = block.number;
      const [
        rootSeq,
        rootHash,
        historyVersion,
        historySnapshot,
        supersededBy,
        rawLogs,
      ] = await Promise.all([
        contract.rootSeq({ blockTag: blockNumber }),
        contract.rootHash({ blockTag: blockNumber }),
        contract.historyVersion({ blockTag: blockNumber }),
        contract.historySnapshot({ blockTag: blockNumber }),
        contract.supersededBy({ blockTag: blockNumber }),
        provider.getLogs({ address: registry, fromBlock: 0, toBlock: blockNumber }),
      ]);
      const stamps = new Map<number, number>();
      const logs: RegistryLog[] = [];
      for (const raw of rawLogs) {
        let stamp = stamps.get(raw.blockNumber);
        if (stamp == null) {
          if (raw.blockNumber === blockNumber) stamp = block.timestamp;
          else {
            const older = await provider.getBlock(raw.blockNumber);
            stamp = older?.timestamp ?? block.timestamp;
          }
          stamps.set(raw.blockNumber, stamp);
        }
        const parsed = parseRegistryLog(raw, stamp);
        if (parsed) logs.push(parsed);
      }
      const kids = new Set<string>();
      if (genesisKid) kids.add(genesisKid);
      for (const log of logs) if (log.kid) kids.add(log.kid);
      const keys: Record<string, KeyStorage> = {};
      for (const kid of kids) {
        const word = kidToBytes32(kid);
        if (!word) continue;
        const row = await contract.keys(word, { blockTag: blockNumber });
        keys[kid] = {
          status: num(row.status),
          notBefore: num(row.notBefore),
          notAfter: num(row.notAfter),
          revokedAt: num(row.revokedAt),
        };
      }
      return {
        blockNumber,
        blockTimestamp: block.timestamp,
        rootSeq: num(rootSeq),
        rootHash: hex32(rootHash),
        historyVersion: num(historyVersion),
        historySnapshot: hex32(historySnapshot),
        supersededBy: getAddress(supersededBy),
        keys,
        logs,
      };
    },
  };
}

export function registryRpcUrls(
  pin: ResolvedPin,
  opts: { primaryUrl?: string | null; secondaryUrl?: string | null; env?: NodeJS.ProcessEnv } = {},
): { primary: string; secondary: string | null } {
  const env = opts.env ?? {};
  const primary = opts.primaryUrl
    || env.CHIT_REGISTRY_RPC_PRIMARY
    || (pin.chain === 'eip155:84532' ? BASE_SEPOLIA_REGISTRY_RPC : BASE_MAINNET_REGISTRY_RPC);
  const secondary = opts.secondaryUrl || env.CHIT_REGISTRY_RPC || '';
  if (!secondary || secondary === primary) return { primary, secondary: null };
  return { primary, secondary };
}

export function rpcsForPin(
  pin: ResolvedPin,
  opts: { primaryUrl?: string | null; secondaryUrl?: string | null; env?: NodeJS.ProcessEnv } = {},
): IssuerRootRpc[] {
  const urls = registryRpcUrls(pin, opts);
  const primary = connectIssuerRootRpc(urls.primary, pin.registry, pin.genesis_kid);
  if (!urls.secondary) return [primary];
  return [primary, connectIssuerRootRpc(urls.secondary, pin.registry, pin.genesis_kid)];
}

/** Root of a payload-hash list. Exposed so tests and the legacy proof share one tree. */
export function legacyFreezeRoot(payloadHashes: string[]): string | null {
  const decoded = payloadHashes.map((hash) => decodePayloadHash(hash));
  if (decoded.some((hash) => !hash)) return null;
  return legacyMerkleRootHex(decoded as Buffer[]);
}
