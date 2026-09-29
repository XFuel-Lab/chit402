import { privateKeyToAccount } from 'viem/accounts';
import type { LocalAccount } from 'viem';

/** Standard ingest stamp. Matches STAMP_FEE_UNITS in stamp.ts. */
const STAMP_CAP_UNITS = 2000n;

/**
 * Same shape as `X402Payer` in xfuel-sdk (`createEip3009Payer`, `createMockPayer`).
 * The returned `header` is the `X-PAYMENT` value. `nonce` is `X-PAYMENT-NONCE`.
 */
export interface StampPayment {
  header: string;
  nonce?: string;
}

export interface StampAccept {
  scheme: string;
  network: string;
  asset: string;
  amount?: string;
  maxAmountRequired?: string;
  payTo?: string | null;
  resource?: string;
  extra?: {
    name?: string;
    version?: string;
    nonce?: string;
    taskId?: string;
  };
}

/** 402 body from `POST /v1/agents/:agent_id/book/ingest`. */
export interface StampChallenge {
  x402Version: number;
  error?: string;
  accepts: StampAccept[];
  resource?: unknown;
  extensions?: Record<string, unknown>;
}

export type StampPayer = (challenge: StampChallenge) => Promise<StampPayment>;

/**
 * Who pays the $0.002 ingest stamp.
 * A function is the SDK payer. A viem local account signs EIP-3009 here.
 * A string is a hex private key (`CHIT_STAMP_PRIVATE_KEY`).
 */
export type StampSigner = StampPayer | LocalAccount | string;

const USDC: Record<string, { chainId: number; usdc: `0x${string}`; name: string; version: string }> = {
  base: {
    chainId: 8453,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    name: 'USD Coin',
    version: '2',
  },
  'eip155:8453': {
    chainId: 8453,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    name: 'USD Coin',
    version: '2',
  },
  'base-sepolia': {
    chainId: 84532,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    name: 'USDC',
    version: '2',
  },
  'eip155:84532': {
    chainId: 84532,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    name: 'USDC',
    version: '2',
  },
};

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export const MISSING_STAMP_SIGNER_WARNING =
  'no stamp signer configured. Book ingest charges $0.002 USDC (2000 atomic) and returns 402 unless the API key is waiver-listed, so no receipt is written. Pass signer: a viem account, createEip3009Payer from xfuel-sdk/onchain, or CHIT_STAMP_PRIVATE_KEY.';

const warned = new WeakSet<object>();

/** One warning per config object, at wrapper construction, not on each read. */
export function warnMissingStampSigner(
  config: object,
  hasSigner: boolean,
  log: (message: string) => void,
): void {
  if (hasSigner || warned.has(config)) return;
  warned.add(config);
  log(MISSING_STAMP_SIGNER_WARNING);
}

export function hasStampSigner(signer: StampSigner | undefined, envKey: string | undefined): boolean {
  if (typeof signer === 'function') return true;
  if (typeof signer === 'string' && signer.trim()) return true;
  if (isLocalAccount(signer)) return true;
  return Boolean(envKey && envKey.trim());
}

export function stampPayerFrom(signer: StampSigner): StampPayer {
  if (typeof signer === 'function') return signer;
  if (typeof signer === 'string') return payerFromPrivateKey(signer);
  if (isLocalAccount(signer)) return payerFromViemAccount(signer);
  throw new Error('stamp signer must be a payer function, a viem account, or a private key');
}

/** EIP-3009 payer from a hex private key. The key is not logged or sent. */
export function payerFromPrivateKey(privateKey: string): StampPayer {
  const account = privateKeyToAccount(normalizePrivateKey(privateKey));
  return payerFromViemAccount(account);
}

/**
 * Build the SDK `X-PAYMENT` blob from a viem local account.
 * Refuses a challenge above the standard 2000-atomic stamp.
 */
export function payerFromViemAccount(account: LocalAccount): StampPayer {
  return async (challenge) => {
    const accept = selectAccept(challenge);
    const amount = acceptAmount(accept);
    if (BigInt(amount) > STAMP_CAP_UNITS) {
      throw new Error(
        `stamp challenge is ${amount} atomic USDC, above the ${STAMP_CAP_UNITS} standard stamp`,
      );
    }
    const net = USDC[accept.network];
    const chainId = net?.chainId ?? chainIdFromCaip(accept.network);
    const verifyingContract = usdcAddress(accept, net?.usdc);
    const name = accept.extra?.name || net?.name || 'USD Coin';
    const version = accept.extra?.version || net?.version || '2';
    if (!chainId || !verifyingContract) {
      throw new Error(`unsupported stamp network "${accept.network}"`);
    }
    if (!accept.payTo) throw new Error('stamp challenge is missing payTo');

    const from = account.address;
    const now = Math.floor(Date.now() / 1000);
    const validBefore = now + 3600;
    const eipNonce = randomBytes32();
    const domain = {
      name,
      version,
      chainId,
      verifyingContract,
    };
    const message = {
      from,
      to: accept.payTo as `0x${string}`,
      value: BigInt(amount),
      validAfter: 0n,
      validBefore: BigInt(validBefore),
      nonce: eipNonce,
    };
    const signature = await account.signTypedData({
      domain,
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    });

    const header = encodePaymentHeader({
      x402Version: challenge.x402Version ?? 1,
      scheme: accept.scheme,
      network: accept.network,
      asset: accept.asset,
      amount,
      payTo: accept.payTo,
      nonce: accept.extra?.nonce,
      authorization: {
        type: 'eip3009-transferWithAuthorization',
        domain,
        message: {
          from,
          to: accept.payTo,
          value: amount,
          validAfter: 0,
          validBefore,
          nonce: eipNonce,
        },
        signature,
      },
      ...(challenge.resource ? { resource: challenge.resource } : {}),
      ...(challenge.extensions ? { extensions: challenge.extensions } : {}),
    });
    return { header, nonce: accept.extra?.nonce };
  };
}

export function selectAccept(challenge: StampChallenge): StampAccept {
  const accepts = challenge?.accepts ?? [];
  if (accepts.length === 0) throw new Error('x402 challenge has no accepts[]');
  return accepts.find((entry) => entry.scheme === 'exact') ?? accepts[0];
}

export function challengeFromResponse(
  body: Record<string, unknown> | undefined,
  paymentRequiredHeader: string | null,
): StampChallenge | undefined {
  const fromBody = asChallenge(body);
  if (fromBody) return fromBody;
  if (!paymentRequiredHeader) return undefined;
  try {
    return asChallenge(JSON.parse(decodeBase64(paymentRequiredHeader)) as unknown);
  } catch {
    return undefined;
  }
}

function asChallenge(value: unknown): StampChallenge | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const accepts = (value as { accepts?: unknown }).accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) return undefined;
  return value as StampChallenge;
}

function isLocalAccount(value: unknown): value is LocalAccount {
  if (!value || typeof value !== 'object') return false;
  const account = value as { address?: unknown; signTypedData?: unknown };
  return typeof account.address === 'string' && typeof account.signTypedData === 'function';
}

function acceptAmount(accept: StampAccept): string {
  const amount = accept.amount ?? accept.maxAmountRequired;
  if (amount == null || !/^[0-9]+$/.test(String(amount))) {
    throw new Error('x402 accept is missing amount');
  }
  return String(amount);
}

function usdcAddress(accept: StampAccept, fallback: `0x${string}` | undefined): `0x${string}` | undefined {
  if (typeof accept.asset === 'string' && /^0x[0-9a-fA-F]{40}$/.test(accept.asset)) {
    return accept.asset as `0x${string}`;
  }
  return fallback;
}

function chainIdFromCaip(network: string): number | undefined {
  const match = /^eip155:(\d+)$/.exec(network);
  if (!match) return undefined;
  return Number(match[1]);
}

function normalizePrivateKey(value: string): `0x${string}` {
  const trimmed = value.trim();
  const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('CHIT_STAMP_PRIVATE_KEY must be a 32-byte hex private key');
  }
  return `0x${hex}`;
}

function randomBytes32(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `0x${hex}`;
}

function encodePaymentHeader(obj: unknown): string {
  return encodeBase64(JSON.stringify(obj));
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function decodeBase64(value: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64').toString('utf8');
  const bin = atob(value);
  const bytes = Uint8Array.from(bin, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
