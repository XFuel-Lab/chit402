/**
 * Nano (XNO) verification for foreign-book ingest.
 *
 * A row is written only when at least two public RPCs agree the block is a
 * cemented send: subtype=send, confirmed=true (not merely published), the
 * recipient (link_as_account / linked_account) matches, and block_info.amount
 * equals both the caller's expected raw amount and the balance delta versus
 * the previous block. A send has no "received" field — amount is the delta.
 *
 * Dedupe is the caller's job (payment ref nano:<hash>, persisted on the ledger).
 */

const RAW_PER_XNO = 10n ** 30n;
const ZERO_HASH = '0'.repeat(64);
const NANO_ACCOUNT = /^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;

export const DEFAULT_NANO_RPC_URLS = [
  'https://nanoslo.0x.no/proxy',
  'https://rpc.nano.to',
];

export const DEFAULT_NANO_TICKER_URL = 'https://api.kraken.com/0/public/Ticker?pair=NANOUSD';

export const NANO_EXPLORER_BLOCK = 'https://nanexplorer.com/nano/block/';

export function nanoRpcUrls(env = process.env) {
  const raw = env.NANO_RPC_URLS;
  const list = (raw == null || String(raw).trim() === ''
    ? DEFAULT_NANO_RPC_URLS
    : String(raw).split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  return list;
}

export function nanoTickerUrl(env = process.env) {
  const raw = env.NANO_USD_TICKER_URL;
  return raw && String(raw).trim() ? String(raw).trim() : DEFAULT_NANO_TICKER_URL;
}

export function normalizeNanoHash(value) {
  if (value == null) return null;
  let s = String(value).trim();
  if (s.toLowerCase().startsWith('nano:')) s = s.slice(5);
  if (s.toLowerCase().startsWith('0x')) s = s.slice(2);
  if (!/^[0-9a-fA-F]{64}$/.test(s)) return null;
  return s.toUpperCase();
}

export function formatXno(raw) {
  const n = BigInt(String(raw));
  if (n < 0n) throw new Error('negative raw');
  const whole = n / RAW_PER_XNO;
  const frac = n % RAW_PER_XNO;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(30, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

/**
 * Multiply a decimal XNO amount by a decimal USD price. Both are base-10 strings.
 * @returns {string} USD with up to 8 fractional digits, trailing zeros trimmed
 */
export function multiplyDecimal(amount, price) {
  const parse = (s) => {
    const t = String(s).trim();
    if (!/^\d+(\.\d+)?$/.test(t)) throw new Error('not a decimal');
    const [w, f = ''] = t.split('.');
    return { int: BigInt((w || '0') + f), scale: f.length };
  };
  const a = parse(amount);
  const p = parse(price);
  const scale = a.scale + p.scale;
  const product = a.int * p.int;
  const digits = product.toString().padStart(scale + 1, '0');
  const cut = digits.length - scale;
  const whole = digits.slice(0, cut);
  let frac = digits.slice(cut);
  if (frac.length > 8) frac = frac.slice(0, 8);
  frac = frac.replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

function hasNanoMarker(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.nano || body.nano_payment || body.xno) return true;
  const inv = body.foreign_invoice || body.fulfillment_invoice || body.foreign_settle || body.invoice;
  if (!inv || typeof inv !== 'object') return false;
  const network = String(inv.network || inv.chain || '').toLowerCase();
  const asset = String(inv.asset || '').toLowerCase();
  return network === 'nano' || network === 'xno' || asset === 'xno' || asset === 'nano';
}

/**
 * Pull a Nano ingest from `nano` or a foreign_invoice marked network=nano.
 * @returns {{ ok: true, value: object } | { ok: false, reason: string } | null}
 *   null when the body is not a Nano ingest (caller should try the USDC shape).
 */
export function parseNanoIngest(body) {
  if (!hasNanoMarker(body)) return null;
  const explicit = body.nano || body.nano_payment || body.xno;
  const inv = body.foreign_invoice || body.fulfillment_invoice || body.foreign_settle || body.invoice;
  const src = (explicit && typeof explicit === 'object') ? explicit : (inv && typeof inv === 'object' ? inv : null);
  if (!src) return { ok: false, reason: 'nano ingest body is empty' };

  const hash = normalizeNanoHash(src.block || src.hash || src.block_hash || src.tx || src.payment_ref);
  if (!hash) return { ok: false, reason: 'nano block hash must be 64 hex characters' };

  const recipient = String(src.recipient || src.payTo || src.pay_to || src.account || '').trim();
  if (!NANO_ACCOUNT.test(recipient)) {
    return { ok: false, reason: 'nano recipient must be a nano_ account' };
  }

  const amountRaw = String(src.amount ?? src.amount_raw ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(amountRaw) && amountRaw !== '0') {
    return { ok: false, reason: 'nano amount must be a positive raw integer' };
  }
  if (amountRaw === '0') return { ok: false, reason: 'nano amount must be a positive raw integer' };

  const description = String(
    src.description || src.task || src.call || src.model || body.description || '',
  ).trim();
  if (!description) return { ok: false, reason: 'nano ingest requires a task/call description' };
  if (description.length > 512) return { ok: false, reason: 'nano description is too long' };

  return {
    ok: true,
    value: { hash, recipient, amountRaw, description },
  };
}

function isCemented(info) {
  const c = info?.confirmed;
  return c === true || c === 'true';
}

function recipientOf(info) {
  const link = info?.contents?.link_as_account ? String(info.contents.link_as_account) : '';
  const linked = info?.linked_account ? String(info.linked_account) : '';
  if (link && linked && link !== linked) {
    return { ok: false, reason: 'link_as_account and linked_account disagree' };
  }
  const recipient = link || linked;
  if (!recipient) return { ok: false, reason: 'block has no recipient' };
  return { ok: true, recipient };
}

function viewOf(info) {
  const rec = recipientOf(info);
  return {
    subtype: String(info?.subtype || ''),
    cemented: isCemented(info),
    amount: info?.amount != null ? String(info.amount) : '',
    balance: info?.balance != null ? String(info.balance) : '',
    recipient: rec.ok ? rec.recipient : '',
    recipientError: rec.ok ? null : rec.reason,
    account: String(info?.block_account || info?.contents?.account || ''),
    previous: String(info?.contents?.previous || '').toUpperCase(),
  };
}

function viewsAgree(views) {
  const first = JSON.stringify(views[0]);
  return views.every((v) => JSON.stringify(v) === first);
}

async function rpcBlockInfo(rpcUrl, hash, fetchImpl) {
  const res = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      action: 'block_info',
      json_block: 'true',
      hash,
      include_linked_account: 'true',
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res || res.ok === false) {
    throw new Error(`${rpcUrl} HTTP ${res?.status ?? 'error'}`);
  }
  const json = await res.json();
  if (!json || typeof json !== 'object') throw new Error(`${rpcUrl} empty body`);
  if (json.error) {
    const msg = typeof json.error === 'string' ? json.error : JSON.stringify(json.error);
    throw new Error(msg);
  }
  return json;
}

async function fetchKrakenNanoUsd(fetchImpl, tickerUrl) {
  const res = await fetchImpl(tickerUrl, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res || res.ok === false) throw new Error(`ticker HTTP ${res?.status ?? 'error'}`);
  const json = await res.json();
  if (Array.isArray(json?.error) && json.error.length > 0) {
    throw new Error(json.error.join('; '));
  }
  const result = json?.result && typeof json.result === 'object' ? json.result : {};
  const pair = result.NANOUSD || result.XNOUSD || result.NANOUSDZ || Object.values(result)[0];
  const price = pair?.c?.[0];
  if (price == null || !/^\d+(\.\d+)?$/.test(String(price)) || Number(price) <= 0) {
    throw new Error('NANOUSD last price missing');
  }
  return String(price);
}

/**
 * Verify a cemented Nano send against two or more public RPCs.
 *
 * @returns {Promise<{ ok: true, sender: string, recipient: string, amountRaw: string, amountXno: string, hash: string, height: string, explorer_url: string, usd_estimate: object } | { ok: false, status: number, error: string, message: string }>}
 */
export async function verifyNanoSend({ hash, recipient, amountRaw }, {
  fetchImpl = globalThis.fetch,
  rpcUrls = nanoRpcUrls(),
  tickerUrl = nanoTickerUrl(),
} = {}) {
  const urls = Array.isArray(rpcUrls) ? rpcUrls.filter(Boolean) : [];
  if (urls.length < 2) {
    return {
      ok: false,
      status: 503,
      error: 'verify_unavailable',
      message: 'NANO_RPC_URLS must list at least two public Nano RPCs',
    };
  }

  let infos;
  try {
    infos = await Promise.all(urls.map((url) => rpcBlockInfo(url, hash, fetchImpl)));
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: 'verify_failed',
      message: `Nano block_info failed: ${err.message}`,
    };
  }

  const views = infos.map(viewOf);
  if (!viewsAgree(views)) {
    return {
      ok: false,
      status: 400,
      error: 'payment_invalid',
      message: 'Nano RPCs disagree on the block',
    };
  }

  const view = views[0];
  if (view.recipientError) {
    return { ok: false, status: 400, error: 'payment_invalid', message: view.recipientError };
  }
  if (view.subtype !== 'send') {
    return {
      ok: false,
      status: 400,
      error: 'payment_invalid',
      message: `block subtype is ${view.subtype || 'missing'}; only cemented sends are ingested`,
    };
  }
  if (!view.cemented) {
    return {
      ok: false,
      status: 400,
      error: 'payment_invalid',
      message: 'block is not cemented (confirmed != true)',
    };
  }
  if (view.recipient !== recipient) {
    return {
      ok: false,
      status: 400,
      error: 'payment_invalid',
      message: `recipient ${view.recipient} does not match expected ${recipient}`,
    };
  }
  if (view.amount !== String(amountRaw)) {
    return {
      ok: false,
      status: 400,
      error: 'payment_invalid',
      message: `amount ${view.amount || 'missing'} does not match expected ${amountRaw}`,
    };
  }

  const previous = view.previous;
  if (previous && previous !== ZERO_HASH && !/^0+$/.test(previous)) {
    let prevs;
    try {
      prevs = await Promise.all(urls.map((url) => rpcBlockInfo(url, previous, fetchImpl)));
    } catch (err) {
      return {
        ok: false,
        status: 502,
        error: 'verify_failed',
        message: `previous block_info failed: ${err.message}`,
      };
    }
    const balances = prevs.map((p) => (p?.balance != null ? String(p.balance) : ''));
    if (new Set(balances).size !== 1 || !balances[0]) {
      return {
        ok: false,
        status: 400,
        error: 'payment_invalid',
        message: 'Nano RPCs disagree on the previous balance',
      };
    }
    let delta;
    try {
      delta = BigInt(balances[0]) - BigInt(view.balance);
    } catch {
      return {
        ok: false,
        status: 400,
        error: 'payment_invalid',
        message: 'balance delta is not an integer',
      };
    }
    if (delta !== BigInt(view.amount)) {
      return {
        ok: false,
        status: 400,
        error: 'payment_invalid',
        message: `balance delta ${delta} does not match send amount ${view.amount}`,
      };
    }
  }

  let amountXno;
  try {
    amountXno = formatXno(view.amount);
  } catch {
    return { ok: false, status: 400, error: 'payment_invalid', message: 'raw amount is not an integer' };
  }

  const stampedAt = new Date().toISOString();
  let usdEstimate = {
    label: 'estimate',
    available: false,
    source: 'kraken',
    pair: 'NANOUSD',
    amount_xno: amountXno,
    amount_raw: view.amount,
    stamped_at: stampedAt,
  };
  try {
    const price = await fetchKrakenNanoUsd(fetchImpl, tickerUrl);
    usdEstimate = {
      label: 'estimate',
      available: true,
      source: 'kraken',
      pair: 'NANOUSD',
      price_usd: price,
      amount_xno: amountXno,
      amount_usd: multiplyDecimal(amountXno, price),
      amount_raw: view.amount,
      stamped_at: stampedAt,
    };
  } catch (err) {
    usdEstimate.reason = err.message;
  }

  return {
    ok: true,
    hash,
    sender: view.account,
    recipient: view.recipient,
    amountRaw: view.amount,
    amountXno,
    height: infos[0].height != null ? String(infos[0].height) : null,
    explorer_url: `${NANO_EXPLORER_BLOCK}${hash}`,
    usd_estimate: usdEstimate,
  };
}

export default {
  DEFAULT_NANO_RPC_URLS,
  DEFAULT_NANO_TICKER_URL,
  NANO_EXPLORER_BLOCK,
  nanoRpcUrls,
  nanoTickerUrl,
  normalizeNanoHash,
  formatXno,
  multiplyDecimal,
  parseNanoIngest,
  verifyNanoSend,
};
