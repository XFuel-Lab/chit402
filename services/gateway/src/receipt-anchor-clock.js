/**
 * Clock bound between a signed receipt-tree head and the block that anchors it.
 *
 * Suggested by @ellie-v2 on 1F916. The bound is per chain and is copied into
 * the signed head so a verifier does not have to guess. An issuer cannot
 * widen it: the verifier uses the signed value only when it is tighter than
 * this constant. Heads signed before the claim existed still verify; the
 * constant applies to them.
 *
 * base is 300 seconds. Base blocks are about 2 seconds, and a zero-value
 * anchor can sit in the mempool for a short while. Five minutes covers that
 * plus ordinary NTP skew, and it is still far inside the once-per-UTC-day
 * head.
 *
 * solana is 150 seconds. Solana expires a blockhash after 151 slots
 * (MAX_PROCESSING_AGE is 150). At the 400ms target slot that window is about
 * 60 seconds. getBlockTime is not the publisher's clock: it is a
 * stake-weighted median of vote timestamps, and the slot that just landed
 * often has no time until later votes arrive, so the estimate can lag wall
 * clock by more than one blockhash window. 150 seconds is two of those
 * windows. That is enough for the lag and for the publisher's NTP skew, and
 * it still refuses a block from a different recent-blockhash epoch. The same
 * 300 second Base window would be too loose for a 400ms slot.
 */
export const clock_tolerance_s = Object.freeze({
  base: 300,
  solana: 150,
});

/** Fresh object for the signed payload. Do not sign the frozen constant. */
export function clockToleranceClaim() {
  return { base: clock_tolerance_s.base, solana: clock_tolerance_s.solana };
}

export function toUnixSeconds(ts) {
  if (ts == null || ts === '') return null;
  if (typeof ts === 'string') {
    const trimmed = ts.trim();
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
      const hex = Number.parseInt(trimmed, 16);
      return Number.isFinite(hex) ? hex : null;
    }
    if (Number.isNaN(Number(trimmed))) {
      const parsed = Date.parse(trimmed);
      return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
    }
  }
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function chainKey(chain) {
  return chain === 'solana' ? 'solana' : 'base';
}

/**
 * Seconds the verifier will allow. Missing claim → the named constant.
 * A signed value larger than the constant is ignored.
 */
export function toleranceSeconds(chain, signedMap) {
  const key = chainKey(chain);
  const cap = clock_tolerance_s[key];
  if (signedMap == null || typeof signedMap !== 'object') return cap;
  const n = Number(signedMap[key]);
  if (!Number.isFinite(n) || n < 0) return cap;
  return Math.min(cap, Math.floor(n));
}

export function anchorClockVerdict(publishedAt, blockTs, tolerance) {
  const published = toUnixSeconds(publishedAt);
  const block = toUnixSeconds(blockTs);
  if (published == null || block == null || !Number.isFinite(tolerance)) {
    return { ok: false, reason: 'anchor_clock_drift', detail: 'missing timestamp' };
  }
  const drift = Math.abs(published - block);
  if (drift > tolerance) {
    return {
      ok: false,
      reason: 'anchor_clock_drift',
      drift,
      tolerance,
      detail: `|published_at - block_ts| = ${drift}s > tolerance ${tolerance}s`,
    };
  }
  return { ok: true, drift, tolerance, detail: null };
}

/** A receipt stamped after the head (plus the bound) was not in that anchor. */
export function receiptWithinHead(receiptTs, publishedAt, tolerance) {
  const receipt = toUnixSeconds(receiptTs);
  const published = toUnixSeconds(publishedAt);
  if (receipt == null || published == null || !Number.isFinite(tolerance)) {
    return { ok: false, reason: 'anchor_clock_drift', detail: 'missing timestamp' };
  }
  if (receipt > published + tolerance) {
    return {
      ok: false,
      reason: 'anchor_clock_drift',
      detail: 'receipt timestamp is later than the head plus the tolerance',
      receipt_ts: receipt,
      published_at: published,
      tolerance,
    };
  }
  return { ok: true, receipt_ts: receipt, published_at: published, tolerance, detail: null };
}

/**
 * Decode `iat` from a compact JWS payload. Does not check the signature;
 * the caller verifies the JWS when that is the trust boundary.
 */
export function receiptTimestampSeconds(receipt) {
  const jws = receipt?.issuer_signature?.jws;
  if (typeof jws === 'string') {
    const part = jws.split('.')[1];
    if (part) {
      try {
        const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
        const iat = toUnixSeconds(payload?.iat);
        if (iat != null) return iat;
      } catch {
        /* fall through to the unsigned timestamp */
      }
    }
  }
  return toUnixSeconds(receipt?.created_at ?? receipt?.iat ?? null);
}

/**
 * Downgrade a side that already confirmed outside the bound.
 * Leaves the object alone when no block time was observed, so a send that
 * has not been mined yet is not rewritten here.
 * On drift, `tx` / `signature` are cleared so a later reader does not treat
 * the hash as an anchor. `rejected_tx` keeps the hash for the next sample.
 */
export function applyAnchorClock(side, { publishedAt, blockTs, chain } = {}) {
  if (!side || side.status !== 'anchored') return side;
  if (blockTs == null) return side;
  const which = chain || side.chain || 'base';
  const verdict = anchorClockVerdict(publishedAt, blockTs, toleranceSeconds(which, null));
  const observed = toUnixSeconds(blockTs);
  if (verdict.ok) return { ...side, block_ts: observed };
  return {
    ...side,
    status: 'pending',
    tx: null,
    signature: null,
    reason: 'anchor_clock_drift',
    block_ts: observed,
    rejected_tx: side.tx || side.signature || null,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function jsonRpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'rpc_error');
  return json.result ?? null;
}

export async function fetchBaseBlockTimestamp(txHash, rpcUrl, {
  call = jsonRpc,
  attempts = 1,
  delayMs = 400,
} = {}) {
  if (!rpcUrl || !txHash) return null;
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const receipt = await call(rpcUrl, 'eth_getTransactionReceipt', [txHash]);
      const blockNum = receipt?.blockNumber;
      if (blockNum != null) {
        const block = await call(rpcUrl, 'eth_getBlockByNumber', [blockNum, false]);
        if (block?.timestamp == null) return null;
        return toUnixSeconds(block.timestamp);
      }
      lastError = null;
    } catch (err) {
      lastError = err;
    }
    if (i + 1 < attempts) await delay(delayMs);
  }
  if (lastError) throw lastError;
  return null;
}

export async function fetchSolanaBlockTimestamp(signature, rpcUrl, { call = jsonRpc } = {}) {
  if (!rpcUrl || !signature) return null;
  const result = await call(rpcUrl, 'getTransaction', [
    signature,
    { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'json' },
  ]);
  if (!result || result.blockTime == null) return null;
  return toUnixSeconds(result.blockTime);
}

/**
 * Read the Base block time when an RPC is already configured.
 * A missing RPC, a not-yet-mined tx, or a transport error leaves the anchor
 * as describeAnchor returned it. A mined block outside the bound becomes pending.
 */
export async function gatePublishedAnchor(anchor, publishedAt, {
  blockTimestamp,
  readBlockTs,
  rpcUrl,
  fetchBlockTs = fetchBaseBlockTimestamp,
} = {}) {
  if (!anchor || anchor.status !== 'anchored' || !anchor.tx) return anchor;
  let blockTs = blockTimestamp;
  if (blockTs === undefined) {
    try {
      if (typeof readBlockTs === 'function') {
        blockTs = await readBlockTs(anchor.tx);
      } else {
        const rpc = rpcUrl || process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || null;
        blockTs = rpc
          ? await fetchBlockTs(anchor.tx, rpc, { attempts: 5, delayMs: 400 })
          : null;
      }
    } catch {
      blockTs = null;
    }
  }
  return applyAnchorClock(anchor, {
    publishedAt,
    blockTs,
    chain: anchor.chain || 'base',
  });
}

/** Base side from `anchor` / `anchors.base`, plus `anchors.solana` when present. */
export function anchorSides(head) {
  const sides = [];
  const base = head?.anchors?.base || head?.anchor || null;
  const baseTx = base?.tx || (!head?.anchors?.base ? head?.anchor_tx : null) || null;
  if (base || baseTx) {
    sides.push({
      chain: 'base',
      tx: baseTx || null,
      status: base?.status || (baseTx ? 'anchored' : 'pending'),
    });
  }
  const sol = head?.anchors?.solana || null;
  if (sol) {
    sides.push({
      chain: 'solana',
      tx: sol.signature || null,
      status: sol.status || (sol.signature ? 'anchored' : 'pending'),
    });
  }
  return sides;
}

function receiptBound(sides, signedMap) {
  const anchored = sides.filter((side) => side.status === 'anchored' && side.tx);
  const source = anchored.length ? anchored : sides;
  const chains = source.length ? source.map((side) => side.chain) : ['base'];
  return Math.min(...chains.map((chain) => toleranceSeconds(chain, signedMap)));
}

/**
 * RPC-backed clock check.
 * `enabled` is false when the caller did not pass --rpc: the result is
 * skipped, never passed. Chain reads go through `call` so tests can mock RPC.
 */
export async function verifyAnchorClock({
  head = null,
  signedPayload = null,
  signatureValid = true,
  signatureReason = null,
  enabled = false,
  rpcUrl = null,
  solanaRpcUrl = null,
  receiptTs = null,
  proven = null,
  call = jsonRpc,
} = {}) {
  const skipped = (reason, extra = {}) => ({
    status: 'skipped',
    reason,
    detail: null,
    published_at: head?.published_at ?? null,
    chains: [],
    receipt: { status: 'skipped', reason, detail: null },
    ...extra,
  });

  if (!head) return skipped('no_head');
  if (!enabled) return skipped('no_rpc');
  if (signatureValid === false) {
    return {
      status: 'failed',
      reason: signatureReason || 'signature_invalid',
      detail: null,
      published_at: head.published_at ?? null,
      chains: [],
      receipt: { status: 'skipped', reason: 'signature_invalid', detail: null },
    };
  }

  const publishedAt = signedPayload?.published_at ?? head.published_at ?? null;
  const signedMap = signedPayload?.clock_tolerance_s ?? null;
  const sides = anchorSides(head);
  const chains = [];

  if (proven === false) {
    return {
      status: 'failed',
      reason: 'inclusion_failed',
      detail: 'receipt leaf is not in this head',
      published_at: publishedAt,
      chains,
      receipt: { status: 'failed', reason: 'inclusion_failed', detail: 'receipt leaf is not in this head' },
    };
  }

  for (const side of sides) {
    const tolerance = toleranceSeconds(side.chain, signedMap);
    if (!side.tx || side.status !== 'anchored') {
      chains.push({
        chain: side.chain, status: 'skipped', reason: 'pending_anchor', tx: side.tx, tolerance,
      });
      continue;
    }
    const url = side.chain === 'solana' ? solanaRpcUrl : rpcUrl;
    if (!url) {
      chains.push({
        chain: side.chain, status: 'skipped', reason: 'no_rpc', tx: side.tx, tolerance,
      });
      continue;
    }
    let blockTs = null;
    try {
      blockTs = side.chain === 'solana'
        ? await fetchSolanaBlockTimestamp(side.tx, url, { call })
        : await fetchBaseBlockTimestamp(side.tx, url, { call, attempts: 1 });
    } catch (err) {
      chains.push({
        chain: side.chain,
        status: 'failed',
        reason: 'rpc_error',
        detail: err.message || 'rpc_error',
        tx: side.tx,
        tolerance,
      });
      continue;
    }
    if (blockTs == null) {
      chains.push({
        chain: side.chain,
        status: 'failed',
        reason: 'anchor_unconfirmed',
        detail: 'anchor transaction has no block timestamp',
        tx: side.tx,
        tolerance,
      });
      continue;
    }
    const verdict = anchorClockVerdict(publishedAt, blockTs, tolerance);
    chains.push({
      chain: side.chain,
      status: verdict.ok ? 'passed' : 'failed',
      reason: verdict.ok ? null : 'anchor_clock_drift',
      detail: verdict.detail,
      drift: verdict.drift,
      block_ts: blockTs,
      tx: side.tx,
      tolerance,
    });
  }

  let receipt = { status: 'skipped', reason: 'not_proven', detail: null };
  if (proven === true) {
    const tolerance = receiptBound(sides, signedMap);
    const verdict = receiptWithinHead(receiptTs, publishedAt, tolerance);
    receipt = {
      status: verdict.ok ? 'passed' : 'failed',
      reason: verdict.ok ? null : 'anchor_clock_drift',
      detail: verdict.detail,
      tolerance,
    };
  }

  const failed = [
    ...chains.filter((row) => row.status === 'failed'),
    ...(receipt.status === 'failed' ? [receipt] : []),
  ];
  if (failed.length) {
    const drift = failed.find((row) => row.reason === 'anchor_clock_drift') || failed[0];
    const chainName = drift.chain ? `${drift.chain} ` : '';
    return {
      status: 'failed',
      reason: drift.reason || 'anchor_clock_drift',
      detail: `${chainName}${drift.detail || drift.reason || 'anchor_clock_drift'}`.trim(),
      published_at: publishedAt,
      chains,
      receipt,
    };
  }

  const anchored = sides.filter((side) => side.status === 'anchored' && side.tx);
  const checked = chains.filter((row) => row.status === 'passed');
  const receiptOk = proven !== true || receipt.status === 'passed';
  if (anchored.length > 0 && checked.length === anchored.length && receiptOk) {
    return {
      status: 'passed',
      reason: null,
      detail: null,
      published_at: publishedAt,
      chains,
      receipt,
    };
  }

  const why = chains.find((row) => row.status === 'skipped')?.reason || receipt.reason || 'no_rpc';
  return {
    status: 'skipped',
    reason: why,
    detail: null,
    published_at: publishedAt,
    chains,
    receipt,
  };
}

export function assessInclusion({
  receipt,
  inclusion,
  head,
  verifyInclusion,
  leafHash,
} = {}) {
  if (!inclusion || !head?.root) return { proven: null, reason: 'not_proven' };
  if (typeof verifyInclusion !== 'function' || typeof leafHash !== 'function') {
    return { proven: null, reason: 'not_proven' };
  }
  let leaf = null;
  if (typeof inclusion.leaf === 'string' && /^[0-9a-fA-F]{64}$/.test(inclusion.leaf)) {
    leaf = Buffer.from(inclusion.leaf, 'hex');
  } else if (receipt?.task_id != null) {
    const row = receipt.row_hash ?? receipt.book_chain?.row_hash ?? '';
    leaf = leafHash(Buffer.from(`${receipt.task_id}|${row}`));
  }
  if (!leaf) return { proven: null, reason: 'not_proven' };
  const size = inclusion.tree_size ?? head.tree_size;
  const ok = verifyInclusion(leaf, inclusion.leaf_index, size, head.root, inclusion.proof);
  return ok
    ? { proven: true, reason: null }
    : { proven: false, reason: 'inclusion_failed' };
}

export function formatAnchorClock(result) {
  if (!result) return 'Anchor clock: skipped (no_rpc)';
  if (result.status === 'skipped') {
    const why = result.reason === 'no_rpc' ? 'no --rpc' : (result.reason || 'no_rpc');
    return `Anchor clock: skipped (${why})`;
  }
  if (result.status === 'failed') {
    const detail = result.detail ? ` — ${result.detail}` : '';
    return `Anchor clock: FAILED — ${result.reason || 'anchor_clock_drift'}${detail}`;
  }
  return 'Anchor clock: passed';
}
