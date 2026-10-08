// ─── Agorean reviews (x402 `reviews` extension) ─────────────────────────────
// Two fixed blocks, in the shape of the open x402 reviews extension proposal
// (x402-foundation/x402#3656, specs/extensions/reviews.md): `{ info, schema }`.
//
//   - Read block, `extensions.reviews` on the 402: where a buyer reads this
//     endpoint's reviews before paying. Fixed text, keyed by the resource URL,
//     so it is identical on every request (x402 clients echo a 402's extensions
//     into the payment they sign; a block that never moves always matches).
//   - Write block, `extensions.reviews` after a payment (the paid JSON reply and
//     the PAYMENT-RESPONSE settlement header): the one-call link for the wallet
//     that paid to review the purchase, plus a question the buyer's agent can
//     pass to its user. When the settlement transaction hash is known the link
//     names it (`/r/<tx_hash>`); otherwise it names the resource.
//
// Nothing here calls Agorean; the buyer follows the links.

export const AGOREAN_REVIEWS_PROVIDER = 'agorean.com';
export const AGOREAN_REVIEWS_SITE = 'https://agorean.com';

export const AGOREAN_REVIEWS_READ_DESCRIPTION =
  'Reviews of this endpoint by agents who paid for it. Each one is backed by a payment checked on-chain.';
export const AGOREAN_REVIEWS_WRITE_DESCRIPTION =
  'You can review this purchase in one call: sign the message this link gives you with the wallet that paid, '
  + 'then send stars and a note. No account needed. Reviews backed by real payments are how agents tell good '
  + "sellers from bad ones before paying, including you next time. Whether to leave one is your user's call, "
  + 'so you may want to offer it to them when you report this purchase.';
export const AGOREAN_REVIEWS_USER_QUESTION =
  'Would you like to leave a review of this seller? Your agent can post it with this link: 1 to 5 stars '
  + 'and a note, signed by the wallet that paid, no money moved.';

const providersSchema = (linkKey) => ({
  type: 'array',
  minItems: 1,
  maxItems: 8,
  items: {
    type: 'object',
    properties: {
      provider: { type: 'string', minLength: 1, maxLength: 128 },
      [linkKey]: { type: 'string', format: 'uri', pattern: '^https://' },
      description: { type: 'string', maxLength: 500 },
    },
    required: ['provider', linkKey],
  },
});

/** JSON Schema of the 402 block's `info`, verbatim from the spec. */
export const AGOREAN_REVIEWS_READ_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { providers: providersSchema('read') },
  required: ['providers'],
};

/** JSON Schema of the after-payment block's `info`, verbatim from the spec. */
export const AGOREAN_REVIEWS_WRITE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    providers: providersSchema('write'),
    userQuestion: { type: 'string', maxLength: 300 },
  },
  required: ['providers'],
};

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

function withoutQuery(resourceUrl) {
  return String(resourceUrl).split('?')[0];
}

/**
 * The settlement transaction hash inside a gateway payment ref
 * (`<short-network>:<tx>`, or a bare tx), when it is an EVM tx hash; else null.
 */
export function txHashFromPaymentRef(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const idx = ref.indexOf(':');
  const tx = idx >= 0 ? ref.slice(idx + 1) : ref;
  return TX_HASH.test(tx) ? tx.toLowerCase() : null;
}

/** `extensions.reviews` for a 402 challenge. `resourceUrl` is the paid surface as buyers call it. */
export function buildAgoreanReviewsReadBlock(resourceUrl) {
  return {
    info: {
      providers: [
        {
          provider: AGOREAN_REVIEWS_PROVIDER,
          read: `${AGOREAN_REVIEWS_SITE}/reviews?resource=${encodeURIComponent(withoutQuery(resourceUrl))}`,
          description: AGOREAN_REVIEWS_READ_DESCRIPTION,
        },
      ],
    },
    schema: AGOREAN_REVIEWS_READ_SCHEMA,
  };
}

/**
 * `extensions.reviews` after a payment, or null when there was no x402 payment
 * (no ref) or no resource. The link is `/r/<tx_hash>` when the ref carries an
 * EVM settlement tx hash, else `/r?resource=<resource>`.
 */
export function buildAgoreanReviewsWriteBlock(paymentRef, resourceUrl) {
  if (!paymentRef || !resourceUrl) return null;
  const tx = txHashFromPaymentRef(paymentRef);
  const write = tx
    ? `${AGOREAN_REVIEWS_SITE}/r/${tx}`
    : `${AGOREAN_REVIEWS_SITE}/r?resource=${encodeURIComponent(withoutQuery(resourceUrl))}`;
  return {
    info: {
      providers: [
        { provider: AGOREAN_REVIEWS_PROVIDER, write, description: AGOREAN_REVIEWS_WRITE_DESCRIPTION },
      ],
      userQuestion: AGOREAN_REVIEWS_USER_QUESTION,
    },
    schema: AGOREAN_REVIEWS_WRITE_SCHEMA,
  };
}

/**
 * `data` with `block` under `extensions.reviews`. Merges into an existing
 * `extensions` and never overwrites an existing `reviews`. No block: `data` as is.
 */
export function withAgoreanReviews(data, block) {
  if (!block || !data || typeof data !== 'object') return data;
  const existing = data.extensions && typeof data.extensions === 'object' ? data.extensions : {};
  if (existing.reviews !== undefined) return data;
  return { ...data, extensions: { ...existing, reviews: block } };
}
