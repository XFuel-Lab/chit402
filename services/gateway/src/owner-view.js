/**
 * Owner view for a receipt, an agent book, or the house metrics.
 *
 * Proof of ownership is a payer wallet (EIP-712, ERC-1271, or ERC-6492),
 * a Solana ed25519 signature over a prefixed message, or an agent key bound
 * at registration. House metrics use the same challenge and a house-scoped
 * session (the house agent key or a house payer wallet).
 *
 * Challenge nonces and session tokens are random server-side bytes.
 * This module does not import the receipt issuer signer and does not call it.
 */
import crypto from 'node:crypto';
import { ethers } from 'ethers';
import { AgentOwnerKeyStore, agentBindMessage } from './agent-owner-key.js';
import { openOwnerStore, resolveOwnerStorePath } from './owner-store.js';
import { jcsCanonicalize, privateFieldsOf, decodeJwsPayload } from './receipt-shell.js';

export const OWNER_ACTION = 'receipt.owner_view.v1';
export const EIP712_DOMAIN_NAME = 'Chit402 Receipt Owner View';
export const EIP712_VERSION = '1';
export const EIP712_CHAIN_ID = 8453;
export const OWNER_STATEMENT = 'Open the private Chit402 receipt view for the audience and scope in this message. This is not a transfer, permit, or payment authorization.';
export const SOLANA_PREFIX = 'Chit402 owner view. This message is not a Solana transaction.\n';
export const DEFAULT_NONCE_TTL_MS = 120_000;
export const DEFAULT_SESSION_TTL_MS = 600_000;
export const NOT_FOUND_BODY = '{"error":"not_found"}';

/**
 * Host or URL to a lowercase hostname. A port, scheme, or path is not part
 * of the audience. `*` is not a wildcard.
 */
export function normalizeAudienceHost(value) {
  let host = String(value || '').trim().toLowerCase();
  if (!host) return '';
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split('/')[0].split('?')[0];
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? '' : host.slice(1, end);
  }
  const colon = host.lastIndexOf(':');
  if (colon > -1 && /^\d+$/.test(host.slice(colon + 1))) host = host.slice(0, colon);
  if (!host || host === '*') return '';
  return host;
}

/**
 * Configured owner-view audiences. The request Host header is not a source.
 * OWNER_VIEW_AUDIENCES, PUBLIC_HOSTS, and the host of PUBLIC_BASE_URL.
 */
export function resolveOwnerAudiences(env = process.env) {
  const raw = [env.OWNER_VIEW_AUDIENCES, env.PUBLIC_HOSTS, env.PUBLIC_BASE_URL]
    .filter((item) => item != null && String(item).trim() !== '')
    .join(',');
  const hosts = [];
  const seen = new Set();
  for (const part of raw.split(',')) {
    const host = normalizeAudienceHost(part);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

/**
 * Boot warning when no owner-view audience is configured. An empty allowlist
 * refuses every owner session, so silence at boot looks like a healthy server.
 * @returns {string|null}
 */
export function ownerAudienceBootWarning(env = process.env) {
  if (resolveOwnerAudiences(env).length > 0) return null;
  return 'owner-view audience allowlist is empty; owner sessions will refuse every host. Set OWNER_VIEW_AUDIENCES, PUBLIC_HOSTS, or PUBLIC_BASE_URL.';
}

const ERC1271_MAGIC = '0x1626ba7e';
const ERC6492_MAGIC = '6492'.repeat(16);
const ERC1271 = new ethers.Interface([
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
]);

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function solanaAddressFromBase64(b64) {
  return base58Encode(Buffer.from(String(b64), 'base64'));
}

function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += B58[digits[i]];
  return out;
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

function normalizeId(id) {
  const value = String(id || '');
  if (value.startsWith('chit-')) return `xfuel-${value.slice(5)}`;
  return value;
}

function sameId(a, b) {
  return normalizeId(a) === normalizeId(b);
}

function samePayer(a, b) {
  if (!a || !b) return false;
  const left = String(a);
  const right = String(b);
  if (left.startsWith('0x') || right.startsWith('0x')) return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

export function typedDataFor(challenge) {
  return {
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_VERSION,
      chainId: EIP712_CHAIN_ID,
    },
    types: {
      OwnerView: [
        { name: 'action', type: 'string' },
        { name: 'audience', type: 'string' },
        { name: 'scope', type: 'string' },
        { name: 'nonce', type: 'string' },
        { name: 'issuedAt', type: 'string' },
        { name: 'expiresAt', type: 'string' },
        { name: 'statement', type: 'string' },
      ],
    },
    primaryType: 'OwnerView',
    message: {
      action: challenge.action,
      audience: challenge.audience,
      scope: jcsCanonicalize(challenge.scope),
      nonce: challenge.nonce,
      issuedAt: challenge.issued_at,
      expiresAt: challenge.expires_at,
      statement: OWNER_STATEMENT,
    },
  };
}

export function solanaMessage(challenge) {
  return Buffer.concat([
    Buffer.from(SOLANA_PREFIX, 'utf8'),
    Buffer.from(jcsCanonicalize(challenge), 'utf8'),
  ]);
}

function normalizeScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return null;
  if (scope.house === true) return { house: true };
  if (scope.agent_id != null && scope.receipt_ids == null && scope.payer !== true) {
    const id = Number(scope.agent_id);
    if (!Number.isInteger(id) || id < 1) return null;
    return { agent_id: id };
  }
  if (Array.isArray(scope.receipt_ids)) {
    if (scope.receipt_ids.length < 1 || scope.receipt_ids.length > 20) return null;
    return { receipt_ids: scope.receipt_ids.map((id) => String(id)) };
  }
  if (scope.payer === true) return { payer: true };
  return null;
}

function scopeKey(scope) {
  return jcsCanonicalize(scope);
}

function preparePrivate(res) {
  res.removeHeader('Access-Control-Allow-Origin');
  res.removeHeader('Access-Control-Allow-Credentials');
  res.set('Cache-Control', 'private, no-store');
  res.set('Vary', 'Authorization');
}

export async function sendGenericNotFound(res, startedAt, budgetMs) {
  const wait = budgetMs - (Date.now() - startedAt);
  if (wait > 0) await delay(wait);
  preparePrivate(res);
  res.status(404);
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Length', String(Buffer.byteLength(NOT_FOUND_BODY)));
  return res.end(NOT_FOUND_BODY);
}

function sendUnauthorized(res) {
  preparePrivate(res);
  return res.status(401).json({ error: 'unauthorized' });
}

function sendRateLimit(res) {
  preparePrivate(res);
  return res.status(429).json({ error: 'rate_limit_exceeded' });
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'anon');
}

function tokenFromReq(req) {
  const header = String(req.get?.('authorization') || req.headers?.authorization || '');
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

function hitLimit(bucket, key, max, windowMs, now) {
  const row = (bucket.get(key) || []).filter((at) => now - at < windowMs);
  if (row.length >= max) {
    bucket.set(key, row);
    return false;
  }
  row.push(now);
  bucket.set(key, row);
  return true;
}

function spkiEd25519(raw) {
  return crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
    format: 'der',
    type: 'spki',
  });
}

function verifySolana(publicKey, message, signature) {
  const raw = Buffer.from(publicKey, 'base64');
  const sig = Buffer.from(signature, 'base64');
  if (raw.length !== 32 || sig.length !== 64) return false;
  return crypto.verify(null, message, spkiEd25519(raw), sig);
}

function signedPayerOf(receipt) {
  const claims = decodeJwsPayload(receipt?.issuer_signature?.jws) || {};
  const fromJws = claims?.caller_binding?.payer_wallet || null;
  const outer = receipt?.caller_binding?.payer_wallet || null;
  if (fromJws && outer && !samePayer(fromJws, outer)) return { conflict: true, payer: null };
  return { conflict: false, payer: fromJws };
}

function signedAgentOf(receipt, ledgerRow) {
  const claims = decodeJwsPayload(receipt?.issuer_signature?.jws) || {};
  const fromClaim = claims.claim_id != null && claims.claim_id !== '' ? Number(claims.claim_id) : null;
  const fromBook = claims?.book_chain?.book_id != null ? Number(claims.book_chain.book_id) : null;
  const signed = Number.isInteger(fromClaim) && fromClaim > 0
    ? fromClaim
    : (Number.isInteger(fromBook) && fromBook > 0 ? fromBook : null);
  const ledger = ledgerRow?.agent_id != null ? Number(ledgerRow.agent_id) : null;
  const ledgerId = Number.isInteger(ledger) && ledger > 0 ? ledger : null;
  if (signed != null && ledgerId != null && signed !== ledgerId) return { conflict: true, agentId: null };
  return { conflict: false, agentId: signed ?? ledgerId };
}

function originalJws(receipt) {
  const jws = receipt?.issuer_signature?.jws;
  return typeof jws === 'string' ? jws : null;
}

/**
 * @param {object} deps
 */
export function createOwnerView(deps) {
  const store = deps.store || openOwnerStore(deps.dbPath || resolveOwnerStorePath(process.env));
  const challengeHits = new Map();
  const fetchHits = new Map();
  const agentKeys = deps.agentKeys || new AgentOwnerKeyStore();
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const nonceTtl = Number(deps.nonceTtlMs) > 0 ? Number(deps.nonceTtlMs) : DEFAULT_NONCE_TTL_MS;
  const sessionTtl = Number(deps.sessionTtlMs) > 0 ? Number(deps.sessionTtlMs) : DEFAULT_SESSION_TTL_MS;
  const challengeMax = Number(deps.challengeMax) > 0 ? Number(deps.challengeMax) : 30;
  const fetchMax = Number(deps.fetchMax) > 0 ? Number(deps.fetchMax) : 60;
  const budgetMs = Number.isFinite(Number(deps.notFoundBudgetMs)) ? Number(deps.notFoundBudgetMs) : 12;
  const houseAgentId = deps.houseAgentId != null && deps.houseAgentId !== ''
    ? Number(deps.houseAgentId)
    : null;
  const housePayers = new Set(
    String(deps.housePayers || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  let rpcProvider = deps.rpcProvider || null;
  const audiences = new Set(
    (Array.isArray(deps.audiences) ? deps.audiences : resolveOwnerAudiences(process.env))
      .map(normalizeAudienceHost)
      .filter(Boolean),
  );

  function audienceOf(req) {
    const host = typeof req.get === 'function' ? req.get('host') : req.headers?.host;
    const normalized = normalizeAudienceHost(host);
    if (!normalized || !audiences.has(normalized)) return '';
    return normalized;
  }

  function issueChallenge(scopeInput, audience) {
    const scope = normalizeScope(scopeInput);
    if (!scope) return { error: 'bad_scope' };
    if (!audience) return { error: 'bad_audience' };
    const issued = now();
    const challenge = {
      action: OWNER_ACTION,
      audience,
      scope,
      nonce: crypto.randomBytes(32).toString('hex'),
      issued_at: new Date(issued).toISOString(),
      expires_at: new Date(issued + nonceTtl).toISOString(),
    };
    try {
      store.insertNonce({
        nonce: challenge.nonce,
        canonical: jcsCanonicalize(challenge),
        audience,
        scopeKey: scopeKey(scope),
        expiresAt: issued + nonceTtl,
        challenge,
      });
    } catch {
      return { error: 'store' };
    }
    return {
      challenge,
      typed_data: typedDataFor(challenge),
      solana_message_b64: solanaMessage(challenge).toString('base64'),
    };
  }

  /**
   * Synchronous consume. Callers must invoke this before any await.
   */
  function consumeNonce(challenge) {
    if (!challenge || typeof challenge !== 'object' || !challenge.nonce) return null;
    let row;
    try {
      row = store.consumeNonce(challenge.nonce);
    } catch {
      return null;
    }
    if (!row) return null;
    if (row.expiresAt <= now()) return null;
    if (jcsCanonicalize(challenge) !== row.canonical) return null;
    if (challenge.audience !== row.audience) return null;
    if (scopeKey(challenge.scope) !== row.scopeKey) return null;
    return row;
  }

  function sessionFromReq(req) {
    const token = tokenFromReq(req);
    if (!token) return null;
    let row;
    try {
      row = store.readSession(token);
    } catch {
      return null;
    }
    if (!row) return null;
    if (row.expiresAt <= now()) {
      try { store.deleteSession(token); } catch { /* deny either way */ }
      return null;
    }
    return row;
  }

  function allowFetch(req, subject) {
    const ip = clientIp(req);
    const at = now();
    return hitLimit(fetchHits, `ip:${ip}`, fetchMax, 60_000, at)
      && hitLimit(fetchHits, `sub:${subject || ip}`, fetchMax, 60_000, at);
  }

  async function verifyOwnership(body, challenge) {
    const kind = String(body?.kind || 'evm');
    const signature = body?.signature;
    const signer = body?.signer;
    if (!signature || !signer) return null;
    if (kind === 'evm') {
      try {
        const typed = typedDataFor(challenge);
        const recovered = ethers.verifyTypedData(typed.domain, typed.types, typed.message, signature);
        if (!samePayer(recovered, signer)) return null;
        return { kind: 'payer', payer: recovered.toLowerCase() };
      } catch {
        return null;
      }
    }
    if (kind === 'erc1271' || kind === 'erc6492') {
      const ok = kind === 'erc6492'
        ? await verifyErc6492(signer, challenge, signature)
        : await verifyErc1271(signer, challenge, signature);
      if (!ok) return null;
      return { kind: 'payer', payer: String(signer).toLowerCase() };
    }
    if (kind === 'solana') {
      const message = solanaMessage(challenge);
      let raw;
      try { raw = Buffer.from(String(signer), 'base64'); } catch { return null; }
      if (raw.length !== 32) return null;
      if (!verifySolana(signer, message, signature)) return null;
      return { kind: 'payer', payer: base58Encode(raw) };
    }
    if (kind === 'agent') {
      const scope = challenge.scope;
      const agentId = scope.house === true ? houseAgentId : scope.agent_id;
      if (!Number.isInteger(Number(agentId))) return null;
      const bound = agentKeys.get(agentId);
      if (!bound) return null;
      try {
        const recovered = ethers.verifyMessage(jcsCanonicalize(challenge), signature);
        if (recovered.toLowerCase() !== bound.publicKey) return null;
        if (recovered.toLowerCase() !== String(signer).toLowerCase()) return null;
      } catch {
        return null;
      }
      if (scope.house === true) return { kind: 'house', house: true, agentId: Number(agentId) };
      return { kind: 'agent', agentId: Number(agentId) };
    }
    return null;
  }

  function digestOf(challenge) {
    const typed = typedDataFor(challenge);
    return ethers.TypedDataEncoder.hash(typed.domain, typed.types, typed.message);
  }

  async function verifyErc1271(address, challenge, signature) {
    const provider = rpcProvider;
    if (!provider || typeof provider.call !== 'function') return false;
    try {
      const digest = digestOf(challenge);
      const data = ERC1271.encodeFunctionData('isValidSignature', [digest, signature]);
      const raw = await provider.call({ to: address, data });
      const [magic] = ERC1271.decodeFunctionResult('isValidSignature', raw);
      return String(magic).toLowerCase() === ERC1271_MAGIC;
    } catch {
      return false;
    }
  }

  async function verifyErc6492(address, challenge, signature) {
    const hex = String(signature || '').replace(/^0x/, '');
    if (!hex.endsWith(ERC6492_MAGIC)) return false;
    const provider = rpcProvider;
    if (!provider || typeof provider.call !== 'function') return false;
    try {
      const body = `0x${hex.slice(0, -ERC6492_MAGIC.length)}`;
      const [factory, factoryCalldata, innerSig] = ethers.AbiCoder.defaultAbiCoder().decode(
        ['address', 'bytes', 'bytes'],
        body,
      );
      let code = '0x';
      if (typeof provider.getCode === 'function') code = await provider.getCode(address);
      if (code && code !== '0x') {
        return await verifyErc1271(address, challenge, innerSig);
      }
      const returned = await provider.call({ to: factory, data: factoryCalldata });
      const deployed = ethers.getAddress(`0x${String(returned).slice(-40)}`);
      if (deployed.toLowerCase() !== String(address).toLowerCase()) return false;
      return await verifyErc1271(address, challenge, innerSig);
    } catch {
      return false;
    }
  }

  function openSession(proof, challenge) {
    const scope = challenge.scope;
    let row;
    if (scope.house === true) {
      const houseAgent = proof.kind === 'house' && Number(proof.agentId) === Number(houseAgentId);
      const housePayer = proof.kind === 'payer' && housePayers.has(String(proof.payer).toLowerCase());
      if (!houseAgent && !housePayer) return null;
      row = { kind: 'house', house: true, agentId: houseAgent ? Number(houseAgentId) : null, payer: housePayer ? proof.payer : null };
    } else if (scope.agent_id != null) {
      if (proof.kind !== 'agent' || Number(proof.agentId) !== Number(scope.agent_id)) return null;
      row = { kind: 'agent', agentId: Number(scope.agent_id), payer: null, house: false };
    } else if (proof.kind === 'payer' && proof.payer) {
      row = {
        kind: 'payer',
        payer: proof.payer,
        agentId: null,
        house: false,
        receiptIds: Array.isArray(scope.receipt_ids) ? scope.receipt_ids.map(String) : null,
      };
    } else {
      return null;
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = now() + sessionTtl;
    try {
      store.insertSession({ ...row, token, expiresAt });
    } catch {
      return null;
    }
    return { token, expires_at: new Date(expiresAt).toISOString(), scope: row.kind };
  }

  async function loadOne(rawId) {
    if (typeof deps.loadReceipt !== 'function') return null;
    return deps.loadReceipt(rawId);
  }

  function receiptAllowed(session, loaded, rawId) {
    if (!session || !loaded?.receipt) return false;
    if (session.kind === 'house') return false;
    const payer = signedPayerOf(loaded.receipt);
    const agent = signedAgentOf(loaded.receipt, loaded.ledgerRow);
    if (payer.conflict || agent.conflict) return false;
    if (session.kind === 'agent') return agent.agentId != null && Number(session.agentId) === Number(agent.agentId);
    if (session.kind !== 'payer') return false;
    if (session.receiptIds && !session.receiptIds.some((id) => sameId(id, rawId) || sameId(id, loaded.taskId) || sameId(id, loaded.receipt?.task_id))) {
      return false;
    }
    return samePayer(session.payer, payer.payer);
  }

  function privateBody(loaded) {
    const receipt = loaded.receipt;
    const stored = deps.saltStore?.get?.(loaded.taskId)
      || deps.saltStore?.get?.(receipt?.task_id)
      || null;
    const row = loaded.ledgerRow?.book_chain?.row_hash ?? loaded.ledgerRow?.row_hash ?? null;
    const body = {
      jws: originalJws(receipt),
      salt: stored?.salt ?? null,
      private_fields: stored?.privateFields ?? privateFieldsOf(receipt),
      // Own leaf preimage part (task_id|row_hash) so the owner can prove inclusion.
      row_hash: typeof row === 'string' ? row : null,
    };
    // Payer binding: owner view only, read from the private store. A read
    // never signs; a receipt without one shows pending or missing. The view
    // gets the JWS served here, so a binding by another key is not shown.
    if (typeof deps.payerBinding === 'function') {
      const taskId = String(loaded.taskId || receipt?.task_id || '');
      let view;
      try {
        view = deps.payerBinding(taskId, body.jws);
      } catch {
        view = { status: 'missing', reason: 'store_unreadable' };
      }
      body.payer_binding = view || { status: 'missing', reason: 'not_bound' };
    }
    return body;
  }

  async function handleChallenge(req, res) {
    const ip = clientIp(req);
    if (!hitLimit(challengeHits, ip, challengeMax, 60_000, now())) return sendRateLimit(res);
    const audience = audienceOf(req);
    const issued = issueChallenge(req.body?.scope, audience);
    if (issued.error === 'store') {
      preparePrivate(res);
      return res.status(503).json({ error: 'unavailable' });
    }
    if (issued.error) return sendUnauthorized(res);
    preparePrivate(res);
    return res.json(issued);
  }

  async function handleSession(req, res) {
    const challenge = req.body?.challenge;
    const row = consumeNonce(challenge);
    if (!row) return sendUnauthorized(res);
    if (challenge.audience !== audienceOf(req)) return sendUnauthorized(res);
    const proof = await verifyOwnership(req.body, challenge);
    if (!proof) return sendUnauthorized(res);
    const opened = openSession(proof, challenge);
    if (!opened) return sendUnauthorized(res);
    preparePrivate(res);
    return res.json(opened);
  }

  async function handleReceipt(req, res) {
    const started = now();
    const session = sessionFromReq(req);
    const subject = session?.payer || (session?.agentId != null ? `agent:${session.agentId}` : null) || 'anon';
    if (!allowFetch(req, subject)) return sendRateLimit(res);
    // No session, and a house session, are not receipt owners. Skip the load
    // so an unknown id and a real id take the same path.
    if (!session || session.kind === 'house') {
      return await sendGenericNotFound(res, started, budgetMs);
    }
    const loaded = await loadOne(req.params.receipt_id);
    if (!receiptAllowed(session, loaded, req.params.receipt_id)) {
      return await sendGenericNotFound(res, started, budgetMs);
    }
    preparePrivate(res);
    return res.json(privateBody(loaded));
  }

  async function handleBook(req, res) {
    const started = now();
    const session = sessionFromReq(req);
    const id = Number(req.params.agent_id);
    if (!allowFetch(req, session?.agentId != null ? `agent:${session.agentId}` : 'anon')) return sendRateLimit(res);
    const owns = session?.kind === 'agent' && Number.isInteger(id) && Number(session.agentId) === id;
    if (!owns || typeof deps.listReceipts !== 'function') {
      return await sendGenericNotFound(res, started, budgetMs);
    }
    const rows = await deps.listReceipts({ agentId: id });
    const receipts = [];
    for (const loaded of rows || []) {
      if (receiptAllowed(session, loaded, loaded.taskId)) receipts.push(privateBody(loaded));
    }
    preparePrivate(res);
    return res.json({ agent_id: id, receipts });
  }

  async function handleHouse(req, res) {
    const started = now();
    const session = sessionFromReq(req);
    if (!allowFetch(req, session?.kind === 'house' ? 'house' : 'anon')) return sendRateLimit(res);
    if (!session || session.kind !== 'house') return await sendGenericNotFound(res, started, budgetMs);
    const body = typeof deps.houseMetrics === 'function' ? await deps.houseMetrics() : {};
    preparePrivate(res);
    return res.json(body);
  }

  async function handleBind(req, res) {
    const started = now();
    const id = Number(req.params.agent_id);
    const identity = Number.isInteger(id) ? deps.registry?.get?.(id) : null;
    const wallet = identity?.agentWallet || identity?.agent_wallet || null;
    const bound = identity && wallet
      ? agentKeys.bind({
        agentId: id,
        publicKey: req.body?.public_key,
        walletSignature: req.body?.wallet_signature,
        keySignature: req.body?.key_signature,
        agentWallet: wallet,
      })
      : { ok: false };
    if (!bound.ok) return await sendGenericNotFound(res, started, budgetMs);
    preparePrivate(res);
    return res.json({ bound: true, agent_id: id });
  }

  function mount(app) {
    app.post('/v1/receipts/owner/challenge', handleChallenge);
    app.post('/v1/receipts/owner/session', handleSession);
    app.get('/v1/receipts/:receipt_id/owner', handleReceipt);
    app.get('/v1/agents/:agent_id/book/owner', handleBook);
    app.get('/v1/house/metrics', handleHouse);
    app.post('/v1/agents/:agent_id/owner-key', handleBind);
  }

  return {
    mount,
    agentKeys,
    issueChallenge,
    consumeNonce,
    sessionFromReq,
    typedDataFor,
    solanaMessage,
    setRpcProvider(provider) { rpcProvider = provider; },
    agentBindMessage,
    constants: {
      nonceTtl,
      sessionTtl,
      challengeMax,
      fetchMax,
    },
  };
}

export { agentBindMessage };
