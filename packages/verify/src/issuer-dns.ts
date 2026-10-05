/**
 * `_issuer` TXT parser.
 *
 * One TXT RRset, one logical record. Strings longer than 255 octets are
 * concatenated. `v` must be first. Unknown `v` values are ignored. Two
 * `chit-issuer1` records is `dns_ambiguous`. `kid` and `standby` repeat.
 *
 * This module only reads. It does not write DNS.
 */

import { Resolver } from 'node:dns/promises';
import { getAddress, isAddress } from 'ethers';

export const ISSUER_TXT_VERSION = 'chit-issuer1';
export const DEFAULT_ISSUER_DOMAIN = 'chit402.com';
/** Spec TTL. Node's resolveTxt does not return the wire TTL. */
export const DEFAULT_ISSUER_TXT_TTL = 300;
/** Grace after a RootCommitted block: TTL plus one hour. */
export const DNS_GRACE_EXTRA_SECONDS = 3600;

export interface IssuerTxt {
  v: typeof ISSUER_TXT_VERSION;
  chain: string;
  reg: string;
  seq: number;
  root: string;
  kids: string[];
  standbys: string[];
  hist: string | null;
  hv: number | null;
}

export type DnsLookupResult =
  | {
    status: 'ok';
    ttl: number;
    records: string[][];
    dnssec: 'validated' | 'unsigned';
  }
  | { status: 'nxdomain' }
  | { status: 'servfail' }
  | { status: 'timeout' };

export type DnsParseFailure = 'dns_missing' | 'dns_ambiguous' | 'dns_malformed';

export type DnsParseResult =
  | { ok: true; txt: IssuerTxt }
  | { ok: false; reason: DnsParseFailure };

function splitKv(part: string): { key: string; value: string } | null {
  const eq = part.indexOf('=');
  if (eq <= 0) return null;
  return { key: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() };
}

function isHex32(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Parse one RRset. `records` is the set of TXT records, each already split
 * into character-strings. Strings inside one record are concatenated.
 */
export function parseIssuerTxt(records: string[][]): DnsParseResult {
  const parsed: IssuerTxt[] = [];
  for (const chunks of records) {
    if (!Array.isArray(chunks) || chunks.some((chunk) => typeof chunk !== 'string')) {
      return { ok: false, reason: 'dns_malformed' };
    }
    const text = chunks.join('');
    const parts = text.split(';').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const first = splitKv(parts[0]);
    const claimsIssuer = parts.some((part) => {
      const kv = splitKv(part);
      return kv?.key === 'v' && kv.value === ISSUER_TXT_VERSION;
    });
    if (!first || first.key !== 'v') {
      if (claimsIssuer) return { ok: false, reason: 'dns_malformed' };
      continue;
    }
    if (first.value !== ISSUER_TXT_VERSION) continue;

    const txt: IssuerTxt = {
      v: ISSUER_TXT_VERSION,
      chain: '',
      reg: '',
      seq: -1,
      root: '',
      kids: [],
      standbys: [],
      hist: null,
      hv: null,
    };
    let malformed = false;
    for (const part of parts.slice(1)) {
      const kv = splitKv(part);
      if (!kv) {
        malformed = true;
        break;
      }
      if (kv.key === 'kid') txt.kids.push(kv.value);
      else if (kv.key === 'standby') txt.standbys.push(kv.value);
      else if (kv.key === 'chain') txt.chain = kv.value;
      else if (kv.key === 'reg') txt.reg = kv.value;
      else if (kv.key === 'seq') {
        if (!/^[0-9]+$/.test(kv.value)) malformed = true;
        else txt.seq = Number(kv.value);
      } else if (kv.key === 'root') txt.root = kv.value;
      else if (kv.key === 'hist') txt.hist = kv.value;
      else if (kv.key === 'hv') {
        if (!/^[0-9]+$/.test(kv.value)) malformed = true;
        else txt.hv = Number(kv.value);
      }
    }
    if (malformed || !txt.chain || txt.seq < 0 || !isHex32(txt.root) || !isAddress(txt.reg)) {
      return { ok: false, reason: 'dns_malformed' };
    }
    txt.reg = getAddress(txt.reg);
    txt.root = txt.root.toLowerCase();
    if (txt.hist) {
      const hist = txt.hist.replace(/^0x/, '');
      if (!/^[0-9a-fA-F]{64}$/.test(hist)) return { ok: false, reason: 'dns_malformed' };
      txt.hist = hist.toLowerCase();
    }
    parsed.push(txt);
  }
  if (parsed.length > 1) return { ok: false, reason: 'dns_ambiguous' };
  if (parsed.length === 0) return { ok: false, reason: 'dns_missing' };
  return { ok: true, txt: parsed[0] };
}

function dnsCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') return err.code;
  return '';
}

/**
 * Read `_issuer.<domain>`. NXDOMAIN and an empty answer are `nxdomain`
 * (missing). SERVFAIL is `servfail`. A timeout is `timeout`.
 * DNSSEC is not validated here; the result is `unsigned`.
 */
export async function resolveIssuerTxt(
  domain = DEFAULT_ISSUER_DOMAIN,
  resolver: { resolveTxt(name: string): Promise<string[][]> } = new Resolver(),
  timeoutMs = 4000,
): Promise<DnsLookupResult> {
  const name = `_issuer.${domain}`;
  let timer: NodeJS.Timeout | undefined;
  try {
    const records = await Promise.race([
      resolver.resolveTxt(name),
      new Promise<string[][]>((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('dns timeout') as NodeJS.ErrnoException;
          err.code = 'ETIMEOUT';
          reject(err);
        }, timeoutMs);
      }),
    ]);
    if (!records || records.length === 0) return { status: 'nxdomain' };
    return { status: 'ok', ttl: DEFAULT_ISSUER_TXT_TTL, records, dnssec: 'unsigned' };
  } catch (err) {
    const code = dnsCode(err);
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') return { status: 'nxdomain' };
    if (code === 'ETIMEOUT' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED' || code === 'ETIME') {
      return { status: 'timeout' };
    }
    return { status: 'servfail' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function sameKidSet(left: readonly string[], right: readonly string[]): boolean {
  const uniq = (list: readonly string[]) => [...new Set(list)].sort();
  const a = uniq(left);
  const b = uniq(right);
  return a.length === b.length && a.every((kid, i) => kid === b[i]);
}
