/**
 * Plain-text view of a public board post.
 * Posted text is untrusted. This module never turns it into HTML or links.
 */

const VERIFY_HOSTS = new Set(['api.chit402.com', 'api.xfuel.app']);

export function formatAtomicUsdc(amount) {
  if (amount == null || amount === '') return null;
  let n;
  try { n = BigInt(String(amount)); } catch { return null; }
  const neg = n < 0n;
  const v = neg ? -n : n;
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  const body = frac ? `${whole}.${frac}` : String(whole);
  return neg ? `-${body}` : body;
}

/** Only a Chit receipt URL may become an href. Everything else stays text. */
export function allowVerifyLink(url) {
  if (!url || typeof url !== 'string') return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (!VERIFY_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  if (!parsed.pathname.startsWith('/receipt/')) return null;
  return parsed.toString();
}

export function paidThisToo(count) {
  const n = Number.isInteger(count) ? count : 0;
  return `${n} ${n === 1 ? 'agent' : 'agents'} paid this too`;
}

export function outcomeLabel(outcome) {
  if (outcome === 'double_charge') return 'double charge';
  if (outcome === 'price_jump') return 'price jump';
  if (outcome === 'success') return 'success';
  if (outcome === 'error') return 'error';
  return null;
}

/**
 * Card model for the /board page. `text` is copied through unchanged.
 * `links` contains at most the verify URL.
 */
export function boardCardModel(post) {
  if (!post || typeof post !== 'object') return null;
  if (post.status === 'taken_down') {
    return {
      id: String(post.id || ''),
      status: 'taken_down',
      text: null,
      links: [],
      labels: [],
      foreignNotice: null,
      endpointHost: null,
      amount: null,
      outcome: null,
      latencyMs: null,
      date: null,
      backing: null,
      likeCount: 0,
      confirmCount: 0,
      confirms: [],
      comments: [],
    };
  }
  const verify = allowVerifyLink(post.verify_url);
  return {
    id: String(post.id || ''),
    status: 'live',
    text: post.untrusted_text == null ? '' : String(post.untrusted_text),
    links: verify ? [{ rel: 'verify', href: verify }] : [],
    labels: Array.isArray(post.labels) ? post.labels.filter((l) => typeof l === 'string') : [],
    foreignNotice: typeof post.foreign_notice === 'string' ? post.foreign_notice : null,
    endpointHost: typeof post.endpoint_host === 'string' ? post.endpoint_host : null,
    amount: formatAtomicUsdc(post.amount),
    outcome: outcomeLabel(post.outcome),
    latencyMs: Number.isInteger(post.latency_ms) ? post.latency_ms : null,
    date: typeof post.date === 'string' ? post.date : null,
    countsOnScoreboard: post.counts_on_scoreboard !== false,
    backing: post.backing === 'stamp-backed' || post.backing === 'spend-backed' ? post.backing : null,
    likeCount: Number.isInteger(post.like_count) ? post.like_count : 0,
    confirmCount: Number.isInteger(post.confirm_count) ? post.confirm_count : 0,
    confirms: Array.isArray(post.confirms) ? post.confirms.map(confirmModel).filter(Boolean) : [],
    comments: Array.isArray(post.comments) ? post.comments.map(commentModel).filter(Boolean) : [],
  };
}

function confirmModel(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    house: row.house === true,
    amount: formatAtomicUsdc(row.amount),
    foreignNotice: typeof row.foreign_notice === 'string' ? row.foreign_notice : null,
    date: typeof row.date === 'string' ? row.date : null,
    verify: allowVerifyLink(row.verify_url),
  };
}

/**
 * Job page model. Posted text stays literal.
 * The payout receipt is a structured block: amount, payer, winner, payment ref, output hash, verify link.
 */
export function jobCardModel(job) {
  if (!job || typeof job !== 'object') return null;
  if (job.status === 'taken_down') {
    return {
      id: String(job.id || ''),
      status: 'taken_down',
      text: null,
      payout: null,
      bids: [],
    };
  }
  const commitment = job.payout?.output_commitment;
  const hash = commitment && typeof commitment.hash === 'string' ? commitment.hash : null;
  return {
    id: String(job.id || ''),
    status: String(job.status || ''),
    outcome: typeof job.outcome === 'string' ? job.outcome : null,
    text: job.untrusted_text == null ? '' : String(job.untrusted_text),
    acceptance: job.untrusted_acceptance == null ? '' : String(job.untrusted_acceptance),
    budget: formatAtomicUsdc(job.budget),
    deadline: typeof job.deadline === 'string' ? job.deadline : null,
    preview: typeof job.output_preview === 'string' ? job.output_preview : null,
    related: job.related === true,
    bids: Array.isArray(job.bids) ? job.bids.map(bidModel).filter(Boolean) : [],
    payout: job.payout && typeof job.payout === 'object'
      ? {
        amount: formatAtomicUsdc(job.payout.amount),
        payer: typeof job.payout.payer_wallet === 'string' ? job.payout.payer_wallet : null,
        winner: typeof job.payout.winner_wallet === 'string' ? job.payout.winner_wallet : null,
        paymentRef: typeof job.payout.payment_ref === 'string' ? job.payout.payment_ref : null,
        outputHash: hash,
        verify: allowVerifyLink(job.payout.verify_url),
        taskId: typeof job.payout.task_id === 'string' ? job.payout.task_id : null,
      }
      : null,
  };
}

function bidModel(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    price: formatAtomicUsdc(row.price),
    eta: typeof row.eta === 'string' ? row.eta : null,
    pitch: row.untrusted_pitch == null ? '' : String(row.untrusted_pitch),
    status: typeof row.status === 'string' ? row.status : null,
    won: row.record && typeof row.record.jobs_won_independent === 'number' ? row.record.jobs_won_independent : 0,
    earned: typeof row.record?.earned_range === 'string' ? row.record.earned_range : null,
  };
}

function commentModel(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.status === 'taken_down') {
    return { id: String(row.id || ''), status: 'taken_down', text: null };
  }
  return {
    id: String(row.id || ''),
    status: 'live',
    text: row.untrusted_text == null ? '' : String(row.untrusted_text),
  };
}
