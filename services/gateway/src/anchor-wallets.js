/**
 * Signed list of wallets allowed to anchor a receipt-log root.
 *
 * GET /.well-known/anchor-wallets.json
 *
 * The package pin is the epoch-1 production pair, confirmed by a read of
 * Base tx 0x1d8d7ea255170c8d4b87bef9382e13555dded2072fd877ce35f995f1ab54ee09
 * (`from`) and Solana signature
 * 61RHMsPPseUc35v5oxDEtANEDCvXk5fmxZdrFDMknGWc5m7U8YhMfz4En1eFFj3z9n67ZtMiha1zkwnneL2LUiXk
 * (first account, the fee payer). A configured Base key (`RECEIPT_ANCHOR_FROM`
 * or `RECEIPT_ANCHOR_PRIVATE_KEY`) and Solana key (`SOLANA_ANCHOR_SECRET_KEY`
 * or `SOLANA_ANCHOR_FEE_PAYER`) are added for heads anchored after that pair.
 *
 * `issuer_root` and `dns` are null. A later build can fill them from the
 * Base ChitIssuerRoot registry (draft #485) and the TXT at `_issuer.chit402.com`
 * without changing this document's schema. This module does not call those
 * sources and does not embed a registry address.
 *
 * The issuer key signs the list. This is not a receipt and it does not
 * change the epoch record.
 */
import { getIssuerPublicKeyJwk, signJws } from './issuer-key.js';
import { resolveAnchorSender } from './receipt-log-anchor.js';
import { solanaAnchorFeePayer } from './solana-receipt-anchor.js';

export const ANCHOR_WALLETS_SCHEMA = 'chit402.anchor_wallets.v1';
export const ANCHOR_WALLETS_JWT_TYP = 'chit402-anchor-wallets+jwt';

export const PINNED_BASE_ANCHOR_WALLET = '0x1844D1F5FE42aff1Cce6F776514Fd40374079582';
export const PINNED_SOLANA_ANCHOR_FEE_PAYER = 'BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD';

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function anchorWalletClaims(env = process.env) {
  const base = [PINNED_BASE_ANCHOR_WALLET];
  const solana = [PINNED_SOLANA_ANCHOR_FEE_PAYER];
  try {
    const from = resolveAnchorSender(env);
    if (from) base.push(from);
  } catch (err) {
    if (err?.code === 'anchor_sender_mismatch' || err?.code === 'anchor_key' || err?.code === 'anchor_from') {
      throw err;
    }
  }
  try {
    const payer = solanaAnchorFeePayer(env);
    if (payer) solana.push(payer);
  } catch (err) {
    if (err?.code === 'anchor_fee_payer_mismatch') throw err;
  }
  return {
    schema: ANCHOR_WALLETS_SCHEMA,
    payload_version: 1,
    base: unique(base),
    solana: unique(solana),
    issuer_root: null,
    dns: null,
  };
}

let cachedKey = '';
let cachedDoc = null;

/** Same claims reuse the signed bytes. ES256 is non-deterministic, so a changed list is the only re-sign. */
export function currentAnchorWallets(env = process.env) {
  const claims = anchorWalletClaims(env);
  const key = JSON.stringify(claims);
  if (cachedDoc && cachedKey === key) return cachedDoc;
  const { jws, kid } = signJws(claims, { typ: ANCHOR_WALLETS_JWT_TYP });
  cachedDoc = {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: ANCHOR_WALLETS_JWT_TYP,
      payload_version: 1,
      jws,
      kid,
      issuer_jwk: getIssuerPublicKeyJwk(),
    },
  };
  cachedKey = key;
  return cachedDoc;
}

export function resetAnchorWalletCache() {
  cachedKey = '';
  cachedDoc = null;
}

export function writeAnchorWallets(res) {
  const doc = currentAnchorWallets();
  res.set('Cache-Control', 'public, max-age=300');
  res.json(doc);
}
