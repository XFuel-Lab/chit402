import { x402Client, x402HTTPClient } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Sign one x402 exact challenge with the configured EVM key.
 * The seller's facilitator settles. This client does not submit the transfer.
 */
export async function payExactChallenge(privateKey: string, challenge: unknown) {
  const account = privateKeyToAccount(normalizePrivateKey(privateKey));
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  const http = new x402HTTPClient(client);
  const payload = await client.createPaymentPayload(
    challenge as Parameters<x402Client['createPaymentPayload']>[0],
  );
  return { headers: asHeaderRecord(http.encodePaymentSignatureHeader(payload)) };
}

function normalizePrivateKey(value: string): `0x${string}` {
  const trimmed = String(value || '').trim();
  const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('payer private key must be 32-byte hex');
  }
  return `0x${hex}`;
}

function asHeaderRecord(headers: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
