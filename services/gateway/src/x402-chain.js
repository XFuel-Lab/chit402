/**
 * On-chain confirmation for a facilitator settle. The facilitator is evidence.
 * Settled amount, payer, and payee come only from the confirmed transfer.
 */
import crypto from 'node:crypto';
import { ethers } from 'ethers';
import logger from './logger.js';
import { decodeBase58, encodeBase58, isEvmTxHash, isSolanaSignature, sameNetwork } from './payment-ref.js';
import { isSolanaNetwork, decodePaymentHeader } from './x402-facilitator.js';
import { sameEvmAddress, samePayee, truncateWallet } from './x402-flags.js';
import {
  setChainReaderForTests,
  clearChainReaderForTests,
  getChainReaderForTests,
  echoChainReader,
  installEchoChainReader,
} from './x402-chain-hook.js';
import { withRpcTimeout } from './receipt-log-anchor.js';
import {
  ARC_CHAINS, arcNetwork, evmRpcUrlFor, evmSettlementSide, isArcSystemLog, lateIssueWindow,
} from './arc-rail.js';

export {
  setChainReaderForTests,
  clearChainReaderForTests,
  getChainReaderForTests,
  echoChainReader,
  installEchoChainReader,
};

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const AUTH_USED_TOPIC = ethers.id('AuthorizationUsed(address,bytes32)');
// Late-issue search window (chunk size, chunk cap, margin, block time) is per
// chain: see lateIssueWindow in arc-rail.js. Base keeps 2,000 x 2 chunks, a
// 64-block margin and 2 s blocks.
/** Head block stamped on a new challenge. A miss leaves issue_block empty. */
const HEAD_BLOCK_TTL_MS = 2000;
let headBlockCache = { url: null, block: null, at: 0 };

export const ERC6492_MAGIC = `0x${'64926492'.repeat(8)}`;

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const MEMO_PROGRAMS = new Set([
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
]);

const ED25519_P = (1n << 255n) - 19n;
const ED25519_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

function modPow(base, exp, mod) {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function isOnCurve32(bytes) {
  if (!bytes || bytes.length !== 32) return false;
  let y = 0n;
  for (let i = 0; i < 32; i += 1) y |= BigInt(bytes[i]) << BigInt(8 * i);
  y &= (1n << 255n) - 1n;
  if (y >= ED25519_P) return false;
  const y2 = (y * y) % ED25519_P;
  const u = (y2 - 1n + ED25519_P) % ED25519_P;
  const v = ((ED25519_D * y2) % ED25519_P + 1n) % ED25519_P;
  const vInv = modPow(v, ED25519_P - 2n, ED25519_P);
  const x2 = (u * vInv) % ED25519_P;
  if (x2 === 0n) return true;
  return modPow(x2, (ED25519_P - 1n) / 2n, ED25519_P) === 1n;
}

function sha256(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

export function findProgramAddress(seeds, programId) {
  const program = decodeBase58(programId);
  if (!program) throw new Error('bad program id');
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = sha256(...seeds, Buffer.from([bump]), program, Buffer.from('ProgramDerivedAddress'));
    if (!isOnCurve32(hash)) return encodeBase58(hash);
  }
  throw new Error('pda not found');
}

/** SPL associated token account. Owner and mint are base58, compared exactly. */
export function associatedTokenAddress(owner, mint, tokenProgram = TOKEN_PROGRAM) {
  const ownerB = decodeBase58(owner);
  const mintB = decodeBase58(mint);
  const tokenB = decodeBase58(tokenProgram);
  if (!ownerB || !mintB || !tokenB) return null;
  return findProgramAddress([ownerB, tokenB, mintB], ASSOCIATED_TOKEN_PROGRAM);
}

export function deriveCreate2Address(factory, salt, initCodeHash) {
  const fac = ethers.getAddress(factory);
  const saltHex = ethers.zeroPadValue(salt, 32);
  const initHex = ethers.zeroPadValue(initCodeHash, 32);
  const packed = ethers.concat(['0xff', fac, saltHex, initHex]);
  return ethers.getAddress(ethers.getAddress(`0x${ethers.keccak256(packed).slice(-40)}`));
}

/**
 * ERC-6492 wrapper: abi.encode(address factory, bytes factoryCalldata, bytes innerSig) || magic.
 * Factory calldata is not one ABI shape. A CREATE2 salt and init-code hash are recognized
 * only when that calldata is exactly two bytes32 words. Any other well-formed wrapper is
 * still ERC-6492. Settlement binds on Transfer(from) + AuthorizationUsed(from, nonce),
 * not on this derivation or on receipt.contractAddress.
 * A truncated magic suffix is refused (not treated as an EOA signature).
 */
export function parseErc6492Signature(signature) {
  if (typeof signature !== 'string' || !signature.startsWith('0x')) return { kind: 'eoa' };
  const magic = ERC6492_MAGIC.slice(2).toLowerCase();
  const body = signature.slice(2).toLowerCase();
  const magicPrefix = magic.slice(0, 16);
  if (body.endsWith(magic)) {
    const encoded = `0x${body.slice(0, -magic.length)}`;
    try {
      const [factory, factoryCalldata, innerSig] = ethers.AbiCoder.defaultAbiCoder().decode(
        ['address', 'bytes', 'bytes'],
        encoded,
      );
      // ethers decodes bytes32,bytes32 from the first 64 bytes of longer calldata
      // without throwing, so createAccount(bytes[],uint256) would invent a CREATE2
      // address. A short payload throws and used to be classified as invalid, which
      // refused the payer before the log check. Only an exact two-word payload is a
      // salt and init-code hash.
      const raw = typeof factoryCalldata === 'string' ? factoryCalldata : ethers.hexlify(factoryCalldata);
      const wordsHex = raw.startsWith('0x') ? raw.slice(2) : raw;
      let salt = null;
      let initCodeHash = null;
      let derived = null;
      if (wordsHex.length === 128) {
        try {
          const words = ethers.AbiCoder.defaultAbiCoder().decode(['bytes32', 'bytes32'], raw);
          salt = words[0];
          initCodeHash = words[1];
          derived = deriveCreate2Address(factory, salt, initCodeHash);
        } catch { /* 64 bytes, but not a CREATE2 salt and init-code hash */ }
      }
      return {
        kind: 'erc6492',
        factory,
        factoryCalldata: raw,
        innerSig,
        salt,
        initCodeHash,
        derived,
      };
    } catch {
      return { kind: 'erc6492_invalid' };
    }
  }
  if (body.length >= 16 && (body.endsWith(magicPrefix) || magic.startsWith(body.slice(-Math.min(body.length, magic.length))) && body.slice(-magic.length) !== magic && body.includes(magicPrefix))) {
    // Truncated or partial magic. Refuse rather than treat it as an EOA signature.
    if (body.includes('64926492') && !body.endsWith(magic)) return { kind: 'erc6492_invalid' };
  }
  if (body.includes(magicPrefix) && !body.endsWith(magic)) return { kind: 'erc6492_invalid' };
  return { kind: 'eoa' };
}

export function wrapErc6492({ factory, salt, initCodeHash, innerSig = '0x' + '11'.repeat(65) }) {
  const factoryCalldata = ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32'], [salt, initCodeHash]);
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'bytes', 'bytes'],
    [factory, factoryCalldata, innerSig],
  );
  return `${encoded}${ERC6492_MAGIC.slice(2)}`;
}

function topicAddress(topic) {
  if (!topic || topic.length < 66) return null;
  return ethers.getAddress(`0x${topic.slice(-40)}`);
}

const AUTH_NONCE_RE = /^0x[0-9a-fA-F]{64}$/;

/** EIP-3009 nonce as lowercase bytes32, or null when it is not exactly 0x plus 64 hex. */
export function canonicalAuthNonce(nonce) {
  return typeof nonce === 'string' && AUTH_NONCE_RE.test(nonce) ? nonce.toLowerCase() : null;
}

const UINT_RE = /^[0-9]{1,78}$/;
// Integer-equivalent decimal ("2000.0"). normalizeAuthorizationPayload sends it
// to the facilitator as "2000", so it is the same uint.
const UINT_DOT_ZERO_RE = /^([0-9]{1,78})\.0+$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Whole bytes only: 0x plus an even number of hex digits.
const SIGNATURE_RE = /^0x(?:[0-9a-fA-F]{2})+$/;
const AUTH_FIELDS = new Set(['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce']);

/** Largest payment header accepted, in characters (raw JSON or base64). */
export const PAYMENT_HEADER_MAX_CHARS = 64 * 1024;
/** An ECDSA signature is 65 bytes. Smart wallets (ERC-1271, ERC-6492) are longer. */
export const EVM_SIGNATURE_MIN_BYTES = 65;
/** Room for an ERC-6492 wrapper: factory, deploy calldata, inner signature, magic suffix. */
export const EVM_SIGNATURE_MAX_BYTES = 8 * 1024;
/**
 * Longest validBefore window accepted, from now. The challenge advertises
 * maxTimeoutSeconds (120 by default), but the SDKs in this repo sign
 * validBefore = now + 3600, so the window is the larger of the two.
 */
export const EVM_AUTH_MAX_WINDOW_S = 3600;
/** Client clock allowance for validAfter and the validBefore upper bound. */
export const EVM_AUTH_CLOCK_SKEW_S = 60;
/** validBefore must leave at least this long for the facilitator to land the tx. */
export const EVM_AUTH_MIN_REMAINING_S = 6;

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function evmAddress(v) {
  return typeof v === 'string' && EVM_ADDRESS_RE.test(v);
}

function uintField(v) {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v !== 'string') return null;
  if (UINT_RE.test(v)) return v;
  const m = UINT_DOT_ZERO_RE.exec(v);
  return m ? m[1] : null;
}

/**
 * True when a decoded header is a transfer method other than EIP-3009
 * transferWithAuthorization (Permit2, a different x402 scheme, and so on).
 */
function otherPaymentScheme(decoded) {
  const p = decoded?.payload;
  if (p && typeof p === 'object' && (p.permit2Authorization || p.permit2 || p.permit)) return true;
  const method = decoded?.accepted?.extra?.assetTransferMethod ?? decoded?.extra?.assetTransferMethod;
  if (method != null && String(method).toLowerCase() !== 'eip3009') return true;
  const scheme = decoded?.accepted?.scheme ?? decoded?.scheme;
  if (scheme != null && String(scheme) !== 'exact') return true;
  return false;
}

/**
 * The one authorization a header carries, or null when there is none or more
 * than one. Two shapes are accepted, the same two toPaymentPayload forwards:
 * x402 `payload: { authorization, signature }`, and the XFuel SDK
 * `authorization: { message, signature }`. A header with both, a bare
 * top-level authorization without `message`, or a stray top-level signature
 * is refused, so the facilitator never sees a different authorization than
 * the one checked here.
 */
function singleAuthorization(decoded) {
  const p = decoded.payload;
  const inPayload = isPlainObject(p) && p.authorization != null;
  const top = decoded.authorization;
  if (inPayload) {
    if (top != null || decoded.signature != null) return null;
    if (!isPlainObject(p.authorization)) return null;
    return { auth: p.authorization, signature: p.signature };
  }
  if (top == null) return null;
  if (!isPlainObject(top) || !isPlainObject(top.message)) return null;
  if (decoded.signature != null) return null;
  if (isPlainObject(p) && p.signature != null) return null;
  return { auth: top.message, signature: top.signature };
}

/**
 * Why an EVM payment header is refused before the facilitator, or null when
 * it carries one well-formed EIP-3009 authorization:
 * - header at most PAYMENT_HEADER_MAX_CHARS;
 * - from and to are 20-byte hex addresses; no fields beyond the six EIP-3009 ones;
 * - value, validAfter (optional, 0) and validBefore are uints;
 * - validAfter <= now + skew, and now + EVM_AUTH_MIN_REMAINING_S < validBefore
 *   <= now + max(maxTimeoutSeconds, EVM_AUTH_MAX_WINDOW_S) + skew;
 * - a bytes32 nonce;
 * - a signature of whole bytes, EVM_SIGNATURE_MIN_BYTES to EVM_SIGNATURE_MAX_BYTES.
 * Other transfer methods get payment_scheme_unsupported. Every other refusal
 * is settle_unconfirmed.
 * @param {string} paymentHeader
 * @param {{ nowSec?: number, maxTimeoutSeconds?: number }} [opts]
 */
export function evmAuthorizationRefusal(paymentHeader, { nowSec, maxTimeoutSeconds } = {}) {
  if (typeof paymentHeader === 'string' && paymentHeader.length > PAYMENT_HEADER_MAX_CHARS) {
    return 'settle_unconfirmed';
  }
  const decoded = decodePaymentHeader(paymentHeader);
  if (decoded && otherPaymentScheme(decoded)) return 'payment_scheme_unsupported';
  if (!isPlainObject(decoded)) return 'settle_unconfirmed';
  const one = singleAuthorization(decoded);
  if (!one) return 'settle_unconfirmed';
  const { auth, signature } = one;
  for (const key of Object.keys(auth)) {
    if (!AUTH_FIELDS.has(key)) return 'settle_unconfirmed';
  }
  // from and to must be addresses here. The payee and payer checks that
  // follow bind them to the challenge and the facilitator result.
  if (!evmAddress(auth.from) || !evmAddress(auth.to)) return 'settle_unconfirmed';
  const value = uintField(auth.value);
  const validAfter = auth.validAfter == null ? '0' : uintField(auth.validAfter);
  const validBefore = uintField(auth.validBefore);
  if (!value || !validAfter || !validBefore) return 'settle_unconfirmed';
  const now = BigInt(Number.isSafeInteger(nowSec) ? nowSec : Math.floor(Date.now() / 1000));
  const advertised = Number.isSafeInteger(maxTimeoutSeconds) && maxTimeoutSeconds > 0 ? maxTimeoutSeconds : 0;
  const windowS = BigInt(Math.max(advertised, EVM_AUTH_MAX_WINDOW_S));
  const skew = BigInt(EVM_AUTH_CLOCK_SKEW_S);
  if (BigInt(validAfter) > now + skew) return 'settle_unconfirmed';
  if (BigInt(validBefore) <= now + BigInt(EVM_AUTH_MIN_REMAINING_S)) return 'settle_unconfirmed';
  if (BigInt(validBefore) > now + windowS + skew) return 'settle_unconfirmed';
  if (!canonicalAuthNonce(auth.nonce)) return 'settle_unconfirmed';
  if (typeof signature !== 'string' || !SIGNATURE_RE.test(signature)) return 'settle_unconfirmed';
  const sigBytes = (signature.length - 2) / 2;
  if (sigBytes < EVM_SIGNATURE_MIN_BYTES || sigBytes > EVM_SIGNATURE_MAX_BYTES) return 'settle_unconfirmed';
  return null;
}

export function readEvmAuthorization(paymentHeader) {
  const decoded = decodePaymentHeader(paymentHeader);
  if (!decoded) return null;
  const auth = decoded.payload?.authorization || decoded.authorization?.message || decoded.authorization || null;
  if (!auth || typeof auth !== 'object') return null;
  const signature = decoded.payload?.signature || decoded.authorization?.signature || decoded.signature || null;
  return {
    from: auth.from || null,
    to: auth.to || null,
    value: auth.value != null ? String(auth.value) : null,
    nonce: auth.nonce || null,
    validAfter: auth.validAfter != null ? auth.validAfter : null,
    validBefore: auth.validBefore != null ? auth.validBefore : null,
    signature: typeof signature === 'string' ? signature : null,
  };
}

/**
 * Confirm one USDC EIP-3009 transfer in a receipt.
 * More than one matching transfer is a refusal (not a sum).
 */
export function confirmEvmReceipt(receipt, {
  challenge,
  expectedPayTo,
  authorization,
  facilitatorPayer,
} = {}) {
  if (!receipt) return { ok: false, code: 'settle_unconfirmed' };
  if (receipt.status !== 1 && receipt.status !== '0x1') return { ok: false, code: 'settle_unconfirmed' };
  const asset = String(challenge?.asset || '').toLowerCase();
  if (!asset) return { ok: false, code: 'settle_unconfirmed' };
  // Arc mirrors each USDC move from 0xff..fe in 18-decimal units. That emitter
  // is never the payment asset.
  if (isArcSystemLog({ address: asset })) return { ok: false, code: 'settle_unconfirmed' };

  let wrapped = null;
  if (authorization?.signature) {
    wrapped = parseErc6492Signature(authorization.signature);
    if (wrapped.kind === 'erc6492_invalid') return { ok: false, code: 'settle_unconfirmed' };
    // MF3: do not require a derived factory address or receipt.contractAddress.
    // A call receipt has contractAddress null, and a loose ABI decode of real
    // factory calldata invents a CREATE2 address. USDC emits
    // AuthorizationUsed(authorizer = from) only after it checked the signature
    // for `from`, so the Transfer + AuthorizationUsed match below is the binding.
  }

  const payer = authorization?.from || null;
  if (payer && facilitatorPayer && !sameEvmAddress(payer, facilitatorPayer)) {
    return { ok: false, code: 'settle_unconfirmed' };
  }
  const wantPayer = payer || facilitatorPayer;
  if (!wantPayer) return { ok: false, code: 'settle_unconfirmed' };

  const matches = [];
  const auths = [];
  for (let i = 0; i < (receipt.logs || []).length; i += 1) {
    const log = receipt.logs[i];
    if (isArcSystemLog(log)) continue;
    const addr = String(log.address || '').toLowerCase();
    if (addr !== asset) continue;
    const topic0 = String(log.topics?.[0] || '').toLowerCase();
    if (topic0 === TRANSFER_TOPIC.toLowerCase() && log.topics?.length >= 3) {
      const from = topicAddress(log.topics[1]);
      const to = topicAddress(log.topics[2]);
      let value = 0n;
      try { value = BigInt(log.data || '0x0'); } catch { value = 0n; }
      if (from && to && sameEvmAddress(from, wantPayer) && samePayee(to, expectedPayTo)) {
        matches.push({ value, from, to, logIndex: log.logIndex != null ? Number(log.logIndex) : i });
      }
    } else if (topic0 === AUTH_USED_TOPIC.toLowerCase()) {
      const authorizer = topicAddress(log.topics?.[1]);
      const nonce = log.topics?.[2] ? String(log.topics[2]).toLowerCase() : null;
      auths.push({ authorizer, nonce });
    }
  }
  if (matches.length !== 1) return { ok: false, code: 'settle_unconfirmed' };
  // EIP-3009 nonce is required. Without it, any AuthorizationUsed by the payer
  // would match, and a different transfer could confirm this payment.
  const authNonce = canonicalAuthNonce(authorization?.nonce);
  if (!authNonce) return { ok: false, code: 'settle_unconfirmed' };
  const authOk = auths.some((a) => a.authorizer && sameEvmAddress(a.authorizer, wantPayer));
  const nonceOk = auths.some((a) => a.authorizer && sameEvmAddress(a.authorizer, wantPayer)
    && a.nonce && String(a.nonce).toLowerCase() === authNonce);
  if (!authOk || !nonceOk) return { ok: false, code: 'settle_unconfirmed' };

  const min = BigInt(String(challenge.amount));
  if (matches[0].value < min) return { ok: false, code: 'settle_unconfirmed' };
  // TODO(reorg): Base accepts a status-1 receipt with no confirmation depth.
  // A reorg after this receipt is not caught. Require N confirmations, or a
  // safe/finalized block at or above blockNumber, before treating this as
  // final. Solana already requires finalized. Do not implement that here.
  const matchedLog = (receipt.logs || []).find((log) => {
    if (isArcSystemLog(log)) return false;
    const addr = String(log.address || '').toLowerCase();
    return addr === asset && String(log.topics?.[0] || '').toLowerCase() === TRANSFER_TOPIC.toLowerCase();
  });
  return {
    ok: true,
    confirmed: true,
    amount: matches[0].value.toString(),
    payer: ethers.getAddress(matches[0].from),
    payTo: ethers.getAddress(matches[0].to),
    authorizer: ethers.getAddress(wantPayer),
    asset: matchedLog?.address ? ethers.getAddress(matchedLog.address) : ethers.getAddress(challenge.asset),
    transferCount: 1,
    logIndex: matches[0].logIndex,
    blockNumber: receipt.blockNumber != null ? Number(receipt.blockNumber) : null,
    network: challenge.network || null,
    blockHash: receipt.blockHash || null,
    status: 1,
  };
}

function accountKeyAt(message, index) {
  const keys = message?.accountKeys || [];
  const k = keys[index];
  if (!k) return null;
  return typeof k === 'string' ? k : (k.pubkey || null);
}

function instructionProgram(ix, message) {
  if (ix.programId) return ix.programId;
  if (typeof ix.programIdIndex === 'number') return accountKeyAt(message, ix.programIdIndex);
  return ix.program || null;
}

/**
 * Confirm one finalized SPL transferChecked into the house ATA.
 * Plain transfer, wrong mint, extra instructions, or a non-finalized tx are refused.
 */
export function confirmSolanaTransaction(tx, {
  challenge,
  expectedPayTo,
  facilitatorPayer,
  signature,
} = {}) {
  if (!tx) return { ok: false, code: 'settle_unconfirmed' };
  if (tx.confirmationStatus && tx.confirmationStatus !== 'finalized') {
    return { ok: false, code: 'settle_unconfirmed', pending: true };
  }
  if (tx.finalized === false) return { ok: false, code: 'settle_unconfirmed', pending: true };
  const meta = tx.meta;
  if (!meta || meta.err != null) return { ok: false, code: 'settle_unconfirmed' };
  const message = tx.transaction?.message;
  if (!message) return { ok: false, code: 'settle_unconfirmed' };

  const mint = challenge?.asset;
  const feePayer = challenge?.feePayer || challenge?.extra?.feePayer || null;
  const ata = associatedTokenAddress(expectedPayTo, mint);
  if (!ata || !mint) return { ok: false, code: 'settle_unconfirmed' };

  const instructions = [
    ...(message.instructions || []),
  ];
  let transfer = null;
  let memoCount = 0;
  for (const ix of instructions) {
    const program = instructionProgram(ix, message);
    if (program === COMPUTE_BUDGET) continue;
    if (MEMO_PROGRAMS.has(program)) {
      memoCount += 1;
      const memo = ix.parsed || ix.data || '';
      const text = typeof memo === 'string' ? memo : (memo?.info || memo?.memo || '');
      if (challenge?.memo != null && String(text) !== String(challenge.memo) && String(ix.parsed) !== String(challenge.memo)) {
        // parsed memo may be the string itself
        if (String(text) !== String(challenge.memo)) return { ok: false, code: 'settle_unconfirmed' };
      }
      continue;
    }
    if (program === TOKEN_PROGRAM) {
      const type = ix.parsed?.type;
      if (type !== 'transferChecked') return { ok: false, code: 'settle_unconfirmed' };
      if (transfer) return { ok: false, code: 'settle_unconfirmed' };
      transfer = ix.parsed.info || {};
      continue;
    }
    return { ok: false, code: 'settle_unconfirmed' };
  }
  if (challenge?.memo != null && memoCount !== 1) return { ok: false, code: 'settle_unconfirmed' };
  if (!transfer) return { ok: false, code: 'settle_unconfirmed' };
  if (transfer.mint !== mint) return { ok: false, code: 'settle_unconfirmed' };
  const decimals = Number(transfer.tokenAmount?.decimals ?? transfer.decimals);
  if (decimals !== 6) return { ok: false, code: 'settle_unconfirmed' };
  if (transfer.destination !== ata) return { ok: false, code: 'settle_unconfirmed' };
  const authority = transfer.authority || transfer.multisigAuthority || null;
  if (!authority || authority !== facilitatorPayer) return { ok: false, code: 'settle_unconfirmed' };
  if (feePayer && (authority === feePayer || transfer.source === feePayer)) {
    return { ok: false, code: 'settle_unconfirmed' };
  }
  // Fee payer must not be the source token account owner via authority, already checked.
  const amountStr = transfer.tokenAmount?.amount != null
    ? String(transfer.tokenAmount.amount)
    : (transfer.amount != null ? String(transfer.amount) : null);
  if (amountStr == null) return { ok: false, code: 'settle_unconfirmed' };
  let amount;
  try { amount = BigInt(amountStr); } catch { return { ok: false, code: 'settle_unconfirmed' }; }

  const keys = message.accountKeys || [];
  const destIndex = keys.findIndex((k) => (typeof k === 'string' ? k : k.pubkey) === transfer.destination);
  if (destIndex < 0) return { ok: false, code: 'settle_unconfirmed' };
  const pre = (meta.preTokenBalances || []).find((b) => b.accountIndex === destIndex && b.mint === mint);
  const post = (meta.postTokenBalances || []).find((b) => b.accountIndex === destIndex && b.mint === mint);
  const preAmt = BigInt(pre?.uiTokenAmount?.amount || '0');
  const postAmt = BigInt(post?.uiTokenAmount?.amount || '0');
  if (postAmt - preAmt !== amount) return { ok: false, code: 'settle_unconfirmed' };
  if (amount < BigInt(String(challenge.amount))) return { ok: false, code: 'settle_unconfirmed' };
  if (signature && tx.transaction?.signatures?.[0] && tx.transaction.signatures[0] !== signature) {
    return { ok: false, code: 'settle_unconfirmed' };
  }
  const finalized = tx.confirmationStatus === 'finalized' || tx.finalized === true;
  return {
    ok: true,
    confirmed: true,
    finalized,
    amount: amount.toString(),
    payer: authority,
    payTo: expectedPayTo,
    asset: mint,
    feePayer: feePayer || null,
    transferCount: 1,
    messageHash: typeof tx.messageHash === 'string' ? tx.messageHash : null,
    blockTimestamp: tx.blockTime != null ? Number(tx.blockTime) : null,
    logIndex: null,
    slot: tx.slot != null ? Number(tx.slot) : null,
    blockNumber: null,
  };
}

async function rpcCall(url, method, params, timeoutMs = 8000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = new Error('rpc_http');
    throw err;
  }
  const data = await res.json();
  if (data.error) {
    const err = new Error('rpc_error');
    throw err;
  }
  return data.result;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * A receipt block is final only when it is at or below the node's finalized tip.
 * A missing tip, a mismatched block, or an RPC error is not final.
 */
export async function evmFinality(rpcUrl, blockNumber, timeoutMs = 8000, meter = null) {
  if (!rpcUrl || blockNumber == null) return { finalized: false, blockTimestamp: null };
  let want;
  try { want = BigInt(blockNumber); } catch { return { finalized: false, blockTimestamp: null }; }
  const hex = `0x${want.toString(16)}`;
  if (!chargeMeter(meter, 2)) return { finalized: false, blockTimestamp: null };
  const [block, tip] = await Promise.all([
    rpcCall(rpcUrl, 'eth_getBlockByNumber', [hex, false], timeoutMs),
    rpcCall(rpcUrl, 'eth_getBlockByNumber', ['finalized', false], timeoutMs),
  ]);
  if (!block?.number || !tip?.number || block.timestamp == null) {
    return { finalized: false, blockTimestamp: null };
  }
  let got;
  let tipN;
  let ts;
  try {
    got = BigInt(block.number);
    tipN = BigInt(tip.number);
    ts = Number(BigInt(block.timestamp));
  } catch {
    return { finalized: false, blockTimestamp: null };
  }
  if (got !== want || !Number.isFinite(ts)) return { finalized: false, blockTimestamp: null, blockHash: null };
  return { finalized: got <= tipN, blockTimestamp: ts, blockHash: block.hash || null };
}

function hexBlock(n) {
  return `0x${n.toString(16)}`;
}

function timeAnchor(tipNumber, tipTimestamp, unixSec, blockMs = 2000n) {
  if (unixSec == null || unixSec === '' || tipTimestamp == null) return null;
  let tipTs;
  let unix;
  try {
    tipTs = BigInt(tipTimestamp);
    unix = BigInt(unixSec);
  } catch {
    return null;
  }
  if (unix <= 0n || tipTs <= 0n) return null;
  const delta = tipTs > unix ? ((tipTs - unix) * 1000n) / blockMs : 0n;
  return tipNumber > delta ? tipNumber - delta : 0n;
}

/**
 * Later of the issue anchor and the validAfter anchor, minus 64 blocks.
 * The issue anchor is the recorded issue block, or a time estimate from
 * challenge issued-at when that block was not stored. validAfter alone
 * never opens a scan from genesis.
 */
function boundedStart(tipNumber, tipTimestamp, { issueBlock, validAfter, issuedAtMs } = {}, win = lateIssueWindow(null)) {
  const anchors = [];
  let issued = null;
  if (issueBlock != null && issueBlock !== '') {
    try {
      const block = BigInt(issueBlock);
      if (block >= 0n) issued = block;
    } catch { /* fall through to the issued-at estimate */ }
  }
  if (issued == null) {
    const ms = Number(issuedAtMs);
    if (Number.isFinite(ms) && ms > 0) {
      issued = timeAnchor(tipNumber, tipTimestamp, Math.floor(ms / 1000), win.blockMs);
    }
  }
  if (issued != null) anchors.push(issued);
  const after = timeAnchor(tipNumber, tipTimestamp, validAfter, win.blockMs);
  if (after != null) anchors.push(after);
  if (anchors.length === 0) return null;
  let start = anchors.reduce((hi, n) => (n > hi ? n : hi));
  start = start > win.marginBlocks ? start - win.marginBlocks : 0n;
  if (start > tipNumber) start = tipNumber;
  if (start < 0n) start = 0n;
  return start;
}

function chargeMeter(meter, n = 1) {
  if (!meter) return true;
  if (meter.left < n) return false;
  for (let i = 0; i < n; i += 1) meter.take();
  return true;
}

function decimalBlock(value) {
  if (value == null || value === '') return null;
  try {
    const n = BigInt(value);
    if (n < 0n) return null;
    return n.toString();
  } catch {
    return null;
  }
}

/**
 * Latest head block, cached for a couple of seconds. An RPC miss returns
 * null so challenge issuance still completes.
 */
export async function readHeadBlock(rpcUrl, timeoutMs = 250) {
  if (!rpcUrl) return null;
  const now = Date.now();
  if (headBlockCache.url === rpcUrl && headBlockCache.block != null && now - headBlockCache.at < HEAD_BLOCK_TTL_MS) {
    return headBlockCache.block;
  }
  try {
    const result = await rpcCall(rpcUrl, 'eth_blockNumber', [], timeoutMs);
    const block = Number(BigInt(result));
    if (!Number.isSafeInteger(block) || block < 0) return null;
    headBlockCache = { url: rpcUrl, block, at: now };
    return block;
  } catch {
    return null;
  }
}

/**
 * One AuthorizationUsed log for this authorizer and nonce, at or below the
 * finalized tip. The scan starts at max(issue anchor, validAfter anchor)
 * minus 64 blocks, and never before a saved scanned-to cursor. Each call
 * covers at most 2,000 blocks, and one resolve covers at most two chunks.
 * scannedTo is the last block included, so the next resolve reads only
 * newer blocks. Zero logs stay pending. More than one log in the window
 * stays pending and does not advance the cursor. A null or non-array
 * eth_getLogs result is an error and does not advance the cursor.
 * `meter`, when set, stops the search once the run's RPC budget is spent.
 */
export async function findAuthorizationTx(rpcUrl, {
  asset,
  from,
  nonce,
  timeoutMs = 8000,
  issueBlock = null,
  validAfter = null,
  issuedAtMs = null,
  scannedTo = null,
  meter = null,
  network = null,
} = {}) {
  if (!rpcUrl || !asset || !from || !nonce) return { ok: false, pending: true };
  const win = lateIssueWindow(network);
  let topic1;
  let topic2;
  try {
    topic1 = ethers.zeroPadValue(ethers.getAddress(from), 32);
    const raw = String(nonce).startsWith('0x') ? String(nonce) : `0x${nonce}`;
    topic2 = ethers.zeroPadValue(raw, 32);
  } catch {
    return { ok: false, pending: true };
  }
  const cursorIn = decimalBlock(scannedTo);
  try {
    if (!chargeMeter(meter, 1)) return { ok: false, pending: true };
    const tip = await rpcCall(rpcUrl, 'eth_getBlockByNumber', ['finalized', false], timeoutMs);
    if (!tip?.number) return { ok: false, pending: true };
    const tipN = BigInt(tip.number);
    const anchor = boundedStart(tipN, tip.timestamp, { issueBlock, validAfter, issuedAtMs }, win);
    if (anchor == null) return { ok: false, pending: true };
    let start = anchor;
    if (cursorIn != null) {
      const next = BigInt(cursorIn) + 1n;
      if (next > start) start = next;
    }
    if (start > tipN) return { ok: false, pending: true, scannedTo: cursorIn };
    const capEnd = start + (win.chunkBlocks * win.chunkCap) - 1n;
    const windowEnd = capEnd < tipN ? capEnd : tipN;
    const logs = [];
    let covered = start - 1n;
    for (let cursor = start; cursor <= windowEnd;) {
      const end = cursor + win.chunkBlocks - 1n > windowEnd ? windowEnd : cursor + win.chunkBlocks - 1n;
      if (!chargeMeter(meter, 1)) return { ok: false, pending: true };
      const chunk = await rpcCall(rpcUrl, 'eth_getLogs', [{
        address: asset,
        topics: [AUTH_USED_TOPIC, topic1, topic2],
        fromBlock: hexBlock(cursor),
        toBlock: hexBlock(end),
      }], timeoutMs);
      if (!Array.isArray(chunk)) {
        logger.warn('x402: authorization log search returned no list');
        return { ok: false, pending: true };
      }
      logs.push(...chunk);
      covered = end;
      if (logs.length > 1) return { ok: false, pending: true };
      if (end === windowEnd) break;
      cursor = end + 1n;
    }
    const scanned = covered >= start ? covered.toString() : cursorIn;
    if (logs.length !== 1 || !logs[0]?.transactionHash) {
      return { ok: false, pending: true, scannedTo: scanned };
    }
    return {
      ok: true,
      tx: logs[0].transactionHash,
      blockNumber: logs[0].blockNumber ?? null,
      blockHash: logs[0].blockHash || null,
      scannedTo: scanned,
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'x402: authorization log search failed');
    return { ok: false, pending: true };
  }
}

export async function readEvmReceipt(rpcUrl, txHash, meter = null) {
  if (!rpcUrl) return null;
  if (!chargeMeter(meter, 1)) return null;
  const result = await rpcCall(rpcUrl, 'eth_getTransactionReceipt', [txHash]);
  if (!result) return null;
  return {
    status: result.status === '0x1' || result.status === 1 ? 1 : 0,
    blockNumber: result.blockNumber != null ? Number(BigInt(result.blockNumber)) : null,
    blockHash: result.blockHash || null,
    contractAddress: result.contractAddress || null,
    logs: (result.logs || []).map((log) => ({
      address: log.address,
      topics: log.topics,
      data: log.data,
      logIndex: log.logIndex != null ? Number(BigInt(log.logIndex)) : null,
    })),
  };
}

export async function readSolanaTransaction(rpcUrl, signature, { waitMs = 30000, intervalMs = 1000 } = {}) {
  if (!rpcUrl) return null;
  const deadline = Date.now() + waitMs;
  let last = null;
  do {
    last = await rpcCall(rpcUrl, 'getTransaction', [signature, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
      encoding: 'jsonParsed',
    }]);
    if (last) return last;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  } while (Date.now() <= deadline);
  return last;
}

/**
 * Confirm a settle. Injected readers (tests) run first. Otherwise read the
 * configured RPC and fail closed on every miss.
 */
export async function confirmSettlement({
  challenge,
  facilitator,
  paymentHeader,
  expectedPayTo,
  cfg = {},
  chainReader = null,
  authorization = null,
  ignorePause = false,
} = {}) {
  // Settle sets ignorePause after the pre-settle check already passed.
  // That OK lasts for this request. Late-issue leaves it false.
  // Either way the reader below must still find the pinned transfer.
  if (!ignorePause) {
    const paused = settlementRefusal(challenge?.network);
    if (paused) {
      return {
        ok: false,
        code: paused,
        // Always pending: the RPC is untrusted right now, not the transfer.
        pending: true,
      };
    }
  }
  const reader = chainReader || cfg.chainReader || getChainReaderForTests();
  if (reader) {
    try {
      const out = await reader({ challenge, facilitator, paymentHeader, expectedPayTo, cfg, authorization });
      if (!out?.ok || out.confirmed === false) {
        return {
          ok: false,
          code: 'settle_unconfirmed',
          pending: !!out?.pending,
          nonceUnused: out?.nonceUnused === true,
          blockhashExpired: out?.blockhashExpired === true,
        };
      }
      return out;
    } catch (err) {
      logger.warn({ err: err.message }, 'x402: injected chain reader failed');
      return { ok: false, code: 'settle_unconfirmed', pending: true };
    }
  }

  const solana = isSolanaNetwork(challenge?.network);
  try {
    if (solana) {
      const url = settlementSolanaRpcUrl(cfg);
      if (!url) return { ok: false, code: 'settle_unconfirmed', pending: true };
      const sig = facilitator.transaction || facilitator.txRef;
      const tx = await readSolanaTransaction(url, sig, {
        waitMs: Number(cfg.solanaFinalizeWaitMs) || 30000,
      });
      if (!tx) return { ok: false, code: 'settle_unconfirmed', pending: true };
      return confirmSolanaTransaction(tx, {
        challenge,
        expectedPayTo,
        facilitatorPayer: facilitator.payer,
        signature: sig,
      });
    }
    const url = evmRpcUrlFor(challenge?.network, cfg);
    if (!url) return { ok: false, code: 'settle_unconfirmed', pending: true };
    const txHash = facilitator.transaction || facilitator.txRef;
    const receipt = await readEvmReceipt(url, txHash, cfg.rpcMeter || null);
    if (!receipt) return { ok: false, code: 'settle_unconfirmed', pending: true };
    const evmAuthorization = authorization || readEvmAuthorization(paymentHeader);
    return confirmEvmReceipt(receipt, {
      challenge,
      expectedPayTo,
      authorization: evmAuthorization,
      facilitatorPayer: facilitator.payer,
    });
  } catch (err) {
    logger.warn({ err: err.message, payer: truncateWallet(facilitator?.payer) }, 'x402: chain confirm failed closed');
    return { ok: false, code: 'settle_unconfirmed', pending: true };
  }
}

export function facilitatorFieldsOk(settle, challenge) {
  if (!settle || !challenge) return false;
  const success = settle.success === true || settle.settled === true;
  if (!success) return false;
  const tx = settle.transaction || settle.txRef || null;
  if (!tx || typeof tx !== 'string') return false;
  if (!settle.payer || typeof settle.payer !== 'string') return false;
  if (!settle.network || !sameNetwork(settle.network, challenge.network)) return false;
  if (isSolanaNetwork(challenge.network)) return isSolanaSignature(tx);
  return isEvmTxHash(tx.startsWith('0x') ? tx : `0x${tx}`);
}

export { sameNetwork };

export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
// Full getGenesisHash values. CAIP-2 keeps only the first 32 characters.
export const SOLANA_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const SOLANA_DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const SOLANA_MAINNET_CAIP = 'solana:5eykt4usfv8p8njdtrepy1vzqkqzkvdp';
const SOLANA_DEVNET_CAIP = 'solana:etwtrabzayq6imfeykouru166vu2xqa1';

/** Same URL settle uses: SOLANA_RPC_URL on config.x402.solanaRpcUrl, then solana.rpcUrl. */
export function settlementSolanaRpcUrl(cfg = {}) {
  return cfg.solanaRpcUrl || cfg.solana?.rpcUrl || null;
}

function rpcHostname(url) {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

const DEFAULT_SETTLEMENT_RECHECK_MS = 10 * 60 * 1000;

function freshSettlementRow() {
  return {
    paused: false,
    reason: null,
    attempts: 0,
    checked: false,
    nextAt: 0,
  };
}

const settlementRpc = {
  base: freshSettlementRow(),
  solana: freshSettlementRow(),
  arc: freshSettlementRow(),
};

let settlementTimer = null;

export function settlementRecheckMs(env = process.env, configured = null) {
  const raw = configured != null ? configured : env.SETTLEMENT_RPC_RECHECK_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return DEFAULT_SETTLEMENT_RECHECK_MS;
  return n;
}

export function expectedBaseChainId(network) {
  const n = String(network || '').trim().toLowerCase();
  if (n === 'base' || n === 'eip155:8453') return BASE_MAINNET_CHAIN_ID;
  if (n === 'base-sepolia' || n === 'eip155:84532') return BASE_SEPOLIA_CHAIN_ID;
  return null;
}

/** eth_chainId an EVM settlement RPC must report. Arc only when its rail is live. */
export function expectedEvmChainId(network) {
  const arc = arcNetwork(network);
  if (arc) return ARC_CHAINS[arc].chainId;
  return expectedBaseChainId(network);
}

export function expectedSolanaGenesis(network) {
  const n = String(network || '').trim().toLowerCase();
  if (n === 'solana' || n === 'solana-mainnet' || n === 'mainnet-beta' || n === SOLANA_MAINNET_CAIP) {
    return SOLANA_MAINNET_GENESIS;
  }
  if (n === 'solana-devnet' || n === 'devnet' || n === SOLANA_DEVNET_CAIP) {
    return SOLANA_DEVNET_GENESIS;
  }
  return null;
}

function chainIdEquals(chainId, expected) {
  if (chainId == null || chainId === '' || expected == null) return false;
  if (Number(chainId) === expected) return true;
  const hex = String(chainId).trim().toLowerCase();
  if (!hex.startsWith('0x')) return false;
  try {
    return Number(BigInt(hex)) === expected;
  } catch {
    return false;
  }
}

function settlementSide(network) {
  if (!network) return null;
  return isSolanaNetwork(network) ? 'solana' : evmSettlementSide(network);
}

export function settlementRpcState(side) {
  const row = settlementRpc[side];
  if (!row) return null;
  return {
    paused: row.paused === true,
    reason: row.reason,
    attempts: row.attempts,
    checked: row.checked === true,
  };
}

export function resetSettlementRpcForTests() {
  settlementRpc.base = freshSettlementRow();
  settlementRpc.solana = freshSettlementRow();
  settlementRpc.arc = freshSettlementRow();
  if (settlementTimer) {
    clearInterval(settlementTimer);
    settlementTimer = null;
  }
}

/** Refusal code when this network's settlement RPC is paused. Null when open. */
export function settlementRefusal(network) {
  const side = settlementSide(network);
  if (!side) return null;
  const row = settlementRpc[side];
  if (!row?.paused) return null;
  return row.reason || 'network_not_accepted';
}

async function callSettlementRpc(url, method, params, request, signal) {
  if (typeof request === 'function') return request(url, method, params, signal);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal,
  });
  if (!res.ok) {
    const err = new Error('rpc_http');
    err.code = 'rpc_http';
    throw err;
  }
  const data = await res.json();
  if (data.error) {
    const err = new Error('rpc_error');
    err.code = 'rpc_error';
    throw err;
  }
  return data.result;
}

async function pauseBackoff(attempts) {
  const { anchorBackoffMs } = await import('./receipt-merkle.js');
  return anchorBackoffMs(attempts);
}

/**
 * eth_chainId for Base, getGenesisHash for Solana. A mismatch pauses that
 * side only. A timeout pauses it and retries on the anchor backoff.
 */
export async function probeSettlementSide({
  side,
  url,
  expected,
  request,
  timeoutMs = 5000,
  now = Date.now(),
  warn = null,
} = {}) {
  const row = settlementRpc[side];
  if (!row || !url || expected == null) return settlementRpcState(side);
  if (row.paused && row.nextAt && now < row.nextAt) return settlementRpcState(side);
  const budget = Math.max(1, Math.ceil(Number(timeoutMs) || 5000));
  const signal = AbortSignal.timeout(budget);
  const method = side === 'solana' ? 'getGenesisHash' : 'eth_chainId';
  try {
    const result = await withRpcTimeout(
      async () => await callSettlementRpc(url, method, [], request, signal),
      budget,
    );
    const ok = side === 'solana' ? result === expected : chainIdEquals(result, expected);
    row.checked = true;
    if (!ok) {
      row.paused = true;
      row.reason = 'network_not_accepted';
      row.attempts += 1;
      row.nextAt = now + settlementRecheckMs();
      if (side === 'solana') {
        const report = warn || ((obj, msg) => logger.warn(obj, msg));
        const actual = typeof result === 'string' ? result : null;
        report({
          side: 'solana',
          expected,
          actual,
          host: rpcHostname(url),
        }, 'settlement RPC genesis mismatch');
      }
      return settlementRpcState(side);
    }
    row.paused = false;
    row.reason = null;
    row.attempts = 0;
    row.nextAt = 0;
    return settlementRpcState(side);
  } catch {
    row.checked = true;
    row.paused = true;
    row.reason = 'settle_unconfirmed';
    row.attempts += 1;
    row.nextAt = now + await pauseBackoff(row.attempts);
    return settlementRpcState(side);
  }
}

export async function probeConfiguredSettlementRpcs(cfg = {}, opts = {}) {
  const jobs = [];
  const baseUrl = cfg.baseRpcUrl || cfg.rpcUrl || null;
  const baseExpected = expectedBaseChainId(cfg.network);
  if (baseUrl && baseExpected != null) {
    jobs.push(await probeSettlementSide({
      side: 'base',
      url: baseUrl,
      expected: baseExpected,
      request: opts.request,
      timeoutMs: opts.timeoutMs,
      now: opts.now,
    }));
  }
  const solUrl = settlementSolanaRpcUrl(cfg);
  const solExpected = expectedSolanaGenesis(cfg.solana?.network);
  if (solUrl && solExpected) {
    jobs.push(await probeSettlementSide({
      side: 'solana',
      url: solUrl,
      expected: solExpected,
      request: opts.request,
      timeoutMs: opts.timeoutMs,
      now: opts.now,
      warn: opts.warn,
    }));
  }
  // Arc row: probed only while the rail is live and ARC_RPC_URL is set.
  const arcUrl = cfg.arcRpcUrl || null;
  const arcExpected = arcNetwork('arc-testnet') ? ARC_CHAINS['arc-testnet'].chainId : null;
  if (arcUrl && arcExpected != null) {
    jobs.push(await probeSettlementSide({
      side: 'arc',
      url: arcUrl,
      expected: arcExpected,
      request: opts.request,
      timeoutMs: opts.timeoutMs,
      now: opts.now,
    }));
  }
  await Promise.all(jobs);
  const out = {
    base: settlementRpcState('base'),
    solana: settlementRpcState('solana'),
  };
  if (arcExpected != null) out.arc = settlementRpcState('arc');
  return out;
}

export function startSettlementRpcRecheck(cfg = {}, { intervalMs } = {}) {
  if (settlementTimer) return settlementTimer;
  const every = intervalMs ?? settlementRecheckMs(process.env, cfg.settlementRpcRecheckMs);
  const timer = setInterval(async () => {
    await probeConfiguredSettlementRpcs(cfg).catch(() => {});
  }, every);
  if (typeof timer.unref === 'function') timer.unref();
  settlementTimer = timer;
  return timer;
}
