/**
 * The ChitAnchor that admits a record, taken from the pinned contract list
 * for one hour. The address is not read from config or from the network.
 *
 * Coverage is [genesisHourStart, retireHour). retireHour is the first hour
 * the pin does not cover, so the next pin can start there without an overlap.
 * An hour on no pin, or on more than one, is refused.
 */

import { refuse } from './reasons.mjs';
import { addressHex, isZeroHex, parseUint } from './hex.mjs';

export const HOUR_SECONDS = 3600n;

function hour(value) {
  const parsed = parseUint(value, 64);
  if (parsed == null) return null;
  if (parsed % HOUR_SECONDS !== 0n) return false;
  return parsed;
}

export function contractForHour(list, chainId, hourStart) {
  if (!Array.isArray(list)) return refuse('bad_type');
  const chain = parseUint(chainId, 256);
  const at = hour(hourStart);
  if (chain == null || at == null) return refuse('bad_uint');
  if (at === false) return refuse('bad_hour');
  const hits = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return refuse('bad_type');
    const entryChain = parseUint(entry.chainId, 256);
    const start = hour(entry.genesisHourStart);
    if (entryChain == null || start == null) return refuse('bad_uint');
    if (start === false) return refuse('bad_hour');
    let end = null;
    if (entry.retireHour != null && entry.retireHour !== '') {
      end = hour(entry.retireHour);
      if (end == null) return refuse('bad_uint');
      if (end === false) return refuse('bad_hour');
      if (end < start) return refuse('bad_hour');
    }
    if (entryChain !== chain || at < start || (end != null && at >= end)) continue;
    const address = addressHex(entry.address);
    if (!address || isZeroHex(address)) return refuse('bad_payment');
    hits.push(address);
  }
  if (hits.length === 0) return refuse('contract_unpinned');
  if (hits.length > 1) return refuse('ambiguous_contract');
  return { ok: true, address: hits[0], chainId: chain, hourStart: at };
}
