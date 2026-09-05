/**
 * verify_receipt MCP tool — offline receipt verification via @xfuel/verify.
 */
import { verifyReceipt, type Jwks, type XFuelReceipt } from '@xfuel/verify';
import type { XFuelClient } from 'xfuel-sdk';
import type { McpConfig } from './config.js';
import { receiptUrlFor, withReceiptFields } from './receipt-fields.js';
import { ok, fail, describeError } from './format.js';

export interface VerifyReceiptArgs {
  task_id?: string;
  verify_url?: string;
  fetch_jwks?: boolean;
  check_payer?: boolean;
  check_nullifier?: boolean;
}

async function loadReceiptJson(
  client: XFuelClient,
  config: McpConfig,
  args: VerifyReceiptArgs,
): Promise<{ receipt: XFuelReceipt; verify_url: string } | ReturnType<typeof fail>> {
  if (!args.task_id && !args.verify_url) {
    return fail('verify_receipt requires task_id or verify_url');
  }

  if (args.task_id) {
    const receipt = (await client.getReceipt(args.task_id)) as XFuelReceipt;
    const verify_url =
      receipt.verify_url
      || args.verify_url
      || receiptUrlFor(config.apiUrl, args.task_id);
    return { receipt, verify_url };
  }

  const raw = String(args.verify_url);
  const url = raw.includes('format=') ? raw : `${raw}${raw.includes('?') ? '&' : '?'}format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    return fail(`verify_receipt fetch HTTP ${res.status} — check verify_url or task_id`);
  }
  const receipt = (await res.json()) as XFuelReceipt;
  const verify_url = receipt.verify_url || raw.split('?')[0];
  return { receipt, verify_url };
}

async function loadJwks(apiUrl: string): Promise<Jwks | undefined> {
  const url = `${apiUrl.replace(/\/$/, '')}/.well-known/jwks.json`;
  const res = await fetch(url);
  if (!res.ok) return undefined;
  return (await res.json()) as Jwks;
}

export async function runVerifyReceipt(
  client: XFuelClient,
  config: McpConfig,
  args: VerifyReceiptArgs,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  try {
    const loaded = await loadReceiptJson(client, config, args);
    if ('isError' in loaded && loaded.isError) return loaded;

    const { receipt, verify_url } = loaded as { receipt: XFuelReceipt; verify_url: string };
    const jwks =
      args.fetch_jwks !== false ? await loadJwks(config.apiUrl) : undefined;

    const verification = await verifyReceipt(receipt, {
      jwks,
      checkPayer: args.check_payer === true,
      checkNullifier: args.check_nullifier === true,
      rpcUrl: config.rpcUrl,
      verifierAddress: config.zkVerifierAddress,
    });

    const structured = withReceiptFields(
      {
        verify_url,
        receipt,
        verification,
      },
      config.apiUrl,
    );

    const summary =
      `verify_receipt(${receipt.task_id}): overall=${verification.overall}` +
      (verification.errors.length ? ` — ${verification.errors.join('; ')}` : '') +
      `\nVerify/share: ${verify_url}`;

    return ok(structured, summary);
  } catch (err) {
    return fail(describeError(err));
  }
}
