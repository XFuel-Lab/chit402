import type { EmDashPrice } from './types.js';

const USDC_SCALE = 1_000_000n;

/**
 * Atomic USDC (6 decimals) for the book ingest amount.
 * Settlement amount wins when it is a digit string.
 * A `{ amount }` price is already atomic. Strings and numbers are US dollars
 * (`$0.05` and `0.05` both become `50000`).
 */
export function priceToAtomicUsdc(
  price: EmDashPrice | undefined,
  settlementAmount?: string,
): string | undefined {
  const settled = digits(settlementAmount);
  if (settled) return settled;
  if (price == null) return undefined;
  if (typeof price === 'number') return usdNumberToAtomic(price);
  if (typeof price === 'object') return digits(price.amount);
  return usdDecimalToAtomic(price);
}

function digits(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!/^[0-9]+$/.test(s)) return undefined;
  return s;
}

function usdNumberToAtomic(value: number): string | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const scaled = Math.round(value * 1_000_000);
  if (!Number.isSafeInteger(scaled)) return undefined;
  return String(scaled);
}

/** `$0.05` or `0.05` to 6-decimal atomic units. Extra fraction digits are truncated. */
export function usdDecimalToAtomic(raw: string): string | undefined {
  const cleaned = raw.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined;
  const [whole, frac = ''] = cleaned.split('.');
  const frac6 = (frac + '000000').slice(0, 6);
  return (BigInt(whole) * USDC_SCALE + BigInt(frac6)).toString();
}
