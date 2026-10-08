/**
 * Hold-then-settle hooks for any x402 client (fetch wrapper, axios, CDP).
 * Do not combine attachHoldSettle with a CDP SpendStore on the same client:
 * both would reserve.
 */

/**
 * @param {object} requirements Selected x402 payment requirements.
 */
export function entryFromRequirements(requirements) {
  const amount = requirements?.amount ?? requirements?.maxAmountRequired;
  return {
    atomicAmount: BigInt(amount),
    asset: requirements.asset,
    network: requirements.network,
    payTo: requirements.payTo,
    at: Date.now(),
  };
}

/**
 * Before-hook throws on an over-cap hold, which stops createPaymentPayload
 * before the scheme client signs. Failure releases. The payment-response
 * hook settles and returns the Chit402 receipt.
 * @param {object} client x402Client
 * @param {ReturnType<import('./hold-client.js').createSpendBook>} book
 */
export function attachHoldSettle(client, book) {
  client.onBeforePaymentCreation(async (ctx) => {
    const entry = entryFromRequirements(ctx.selectedRequirements);
    await book.holdEntry(entry);
    ctx.chitEntry = entry;
  });
  client.onAfterPaymentCreation(async (ctx) => {
    book.notePayload(ctx.paymentPayload, ctx.selectedRequirements);
  });
  client.onPaymentCreationFailure(async (ctx) => {
    if (ctx.chitEntry) await book.releaseEntry(ctx.chitEntry);
  });
  client.onPaymentResponse(async (ctx) => {
    const result = await book.onPaymentResponse(ctx);
    if (result) ctx.chitReceipt = result;
    return result;
  });
  return client;
}

/**
 * CDP already reserved inside append. This only settles or releases.
 * Register it after applySpendControls so it sees the payment payload.
 * @param {object} client
 * @param {{ book: ReturnType<import('./hold-client.js').createSpendBook> }} store
 */
export function attachChitReceipt(client, store) {
  const book = store.book || store;
  client.onAfterPaymentCreation(async (ctx) => {
    book.notePayload(ctx.paymentPayload, ctx.selectedRequirements);
  });
  client.onPaymentResponse(async (ctx) => {
    const result = await book.onPaymentResponse(ctx);
    if (result) ctx.chitReceipt = result;
    return result;
  });
  return client;
}
