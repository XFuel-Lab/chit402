/** 0.05 USDC, 6 decimals. A Surplus payment above this is refused before any signature. */
export const SURPLUS_CAP_ATOMIC = 50000n;

/** 0.002 USDC. A Chit ingest stamp above this is refused before any signature. */
export const STAMP_CAP_ATOMIC = 2000n;

export const SURPLUS_CAP_USD = '0.05';
export const STAMP_CAP_USD = '0.002';

const USDC_ASSETS = new Set([
  'usdc',
  // Base mainnet
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  // Base Sepolia
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
]);

export class PaymentCapError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentCapError';
  }
}

export function isUsdcAsset(asset) {
  if (typeof asset !== 'string') return false;
  return USDC_ASSETS.has(asset.trim().toLowerCase());
}

/**
 * Atomic USDC from an x402 accept. v2 uses `amount`; v1 uses `maxAmountRequired`.
 * Anything that is not a digit string is refused — a decimal would be a unit mistake.
 */
export function atomicAmount(accept, label) {
  const raw = accept?.amount ?? accept?.maxAmountRequired;
  if (raw == null || !/^[0-9]+$/.test(String(raw).trim())) {
    throw new PaymentCapError(
      `${label} amount is missing or not atomic USDC. Refusing before signature.`,
    );
  }
  return BigInt(String(raw).trim());
}

/**
 * Exact-scheme USDC accepts at or under `cap`.
 * Throws before the caller has a chance to sign when nothing qualifies.
 * @returns {object[]}
 */
export function affordableExactAccepts(challenge, { cap, usd, label }) {
  const accepts = Array.isArray(challenge?.accepts) ? challenge.accepts : [];
  const exact = accepts.filter((entry) => entry && entry.scheme === 'exact');
  if (exact.length === 0) {
    throw new PaymentCapError(
      `${label} challenge has no exact accept. Refusing before signature.`,
    );
  }

  const priced = exact.map((accept) => ({ accept, amount: atomicAmount(accept, label) }));
  const usdc = priced.filter((row) => isUsdcAsset(row.accept.asset));
  if (usdc.length === 0) {
    throw new PaymentCapError(`${label} accept is not USDC. Refusing before signature.`);
  }

  const under = usdc.filter((row) => row.amount <= cap);
  if (under.length === 0) {
    const lowest = usdc.reduce((min, row) => (row.amount < min.amount ? row : min));
    throw new PaymentCapError(
      `${label} is ${lowest.amount} atomic USDC, above the ${usd} USDC cap (${cap} atomic). Refusing before signature.`,
    );
  }

  under.sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0));
  return under.map((row) => row.accept);
}

export function formatAtomicUsd(amount) {
  const value = BigInt(amount);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1000000n;
  const frac = (abs % 1000000n).toString().padStart(6, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}
