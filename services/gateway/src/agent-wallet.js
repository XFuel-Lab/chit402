/**
 * Bind an agentWallet for POST /v1/agents/register.
 *
 * The wallet is an address, not an API key and not a pasteable secret.
 * Prefer an AAWP official / smart-account address (docs.aawp.ai).
 * Reject an EOA when we can detect one (empty bytecode, or Identity says not official).
 */

import { ethers } from 'ethers';

/** Published AAWP Identity proxy (CREATE2 vanity; same on Base and other EVM). */
export const AAWP_IDENTITY = '0xAAAafBf6F88367C75A9B701fFb4684Df6bCA1D1d';

/** Published AAWP Factory proxy. */
export const AAWP_FACTORY = '0xAAAA3Df87F112c743BbC57c4de1700C72eB7aaAA';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_SECRET = /^(?:0x)?[0-9a-fA-F]{64}$/;
const AAWP_IDENTITY_ABI = ['function isOfficialWallet(address addr) view returns (bool)'];

function looksLikeSecret(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (HEX_SECRET.test(s) && !EVM_ADDRESS.test(s)) return true;
  const words = s.split(/\s+/);
  if (words.length >= 12 && words.every((w) => /^[a-z]+$/.test(w))) return true;
  return false;
}

function looksLikeApiKey(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (EVM_ADDRESS.test(s)) return false;
  return /^(xfuel-|sk_|ak_|api[-_]?key)/i.test(s) || s.length < 20;
}

/**
 * Static checks (no RPC). Reject secrets and "API key as wallet".
 * @param {string} agentWallet
 * @param {{ apiKey?: string|null }} [opts]
 */
export function inspectWalletShape(agentWallet, { apiKey = null } = {}) {
  const raw = String(agentWallet ?? '').trim();
  if (!raw) return { ok: false, reason: 'agentWallet is required' };
  if (looksLikeSecret(raw)) {
    return { ok: false, reason: 'agentWallet must be an address, not a secret' };
  }
  if (looksLikeApiKey(raw)) {
    return { ok: false, reason: 'agentWallet must be an address, not an API key' };
  }
  if (apiKey && raw === String(apiKey).trim()) {
    return { ok: false, reason: 'agentWallet must not equal the API key' };
  }
  if (!EVM_ADDRESS.test(raw)) {
    return { ok: false, reason: 'agentWallet must be a 0x-prefixed 20-byte address' };
  }
  return { ok: true, address: ethers.getAddress(raw) };
}

/**
 * On-chain / injected lookup. Official AAWP preferred; contract code accepted;
 * empty code is treated as EOA and rejected when we can see it.
 *
 * @param {string} address checksummed
 * @param {{
 *   provider?: { getCode?: Function } | null,
 *   identity?: { isOfficialWallet?: Function } | null,
 *   inspect?: Function,
 * }} [opts]
 */
export async function inspectWalletOnChain(address, {
  provider = null,
  identity = null,
  inspect = null,
} = {}) {
  if (typeof inspect === 'function') {
    return inspect(address);
  }

  let official = null;
  if (identity && typeof identity.isOfficialWallet === 'function') {
    try {
      official = !!(await identity.isOfficialWallet(address));
    } catch {
      official = null;
    }
  }

  let code = null;
  if (provider && typeof provider.getCode === 'function') {
    try {
      code = await provider.getCode(address);
    } catch {
      code = null;
    }
  }

  const hasCode = typeof code === 'string' && code !== '0x' && code !== '0x0';
  if (official === true) {
    return { kind: 'aawp', official: true, eoa: false, code };
  }
  if (hasCode) {
    return { kind: 'smart_account', official: official === true, eoa: false, code };
  }
  if (code != null && !hasCode) {
    return { kind: 'eoa', official: false, eoa: true, code };
  }
  return { kind: 'unknown', official: official === true, eoa: null, code };
}

/**
 * Bind an agentWallet. Returns { ok, address, kind } or { ok:false, reason }.
 */
export async function bindAgentWallet(agentWallet, {
  apiKey = null,
  provider = null,
  identity = null,
  inspect = null,
} = {}) {
  const shape = inspectWalletShape(agentWallet, { apiKey });
  if (!shape.ok) return shape;

  const onChain = await inspectWalletOnChain(shape.address, { provider, identity, inspect });
  if (onChain.eoa === true) {
    return { ok: false, reason: 'EOA agentWallet is not accepted; use an AAWP official or smart-account address' };
  }

  return {
    ok: true,
    address: shape.address,
    kind: onChain.kind,
    official: !!onChain.official,
  };
}

/**
 * Build an ethers Identity reader when an RPC URL is available.
 * Returns { provider, identity } or { provider: null, identity: null }.
 */
export function aawpReaders(rpcUrl, identityAddress = AAWP_IDENTITY) {
  if (!rpcUrl) return { provider: null, identity: null };
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const identity = new ethers.Contract(identityAddress, AAWP_IDENTITY_ABI, provider);
    return { provider, identity };
  } catch {
    return { provider: null, identity: null };
  }
}
