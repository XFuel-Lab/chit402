/**
 * Thin CDP SpendStore. The cap decision is the gateway hold, not this process.
 *
 * Confirmed against @coinbase/cdp-sdk 1.58.0 (and 1.55.0, the build GTM read):
 * SpendStore is load / append / optional removeEntry, size, prune, dropOldest.
 * There is no atomic check-and-append. applySpendControls sums load() and
 * then calls append under an in-process per-asset lock. A throw from append
 * leaves the before-hook before the scheme signs.
 */
import { createSpendBook } from './hold-client.js';

/**
 * @param {ConstructorParameters<typeof createSpendBook>[0]} options
 */
export function createChitSpendStore(options) {
  const book = createSpendBook(options);
  return {
    book,
    async load() {
      return book.load();
    },
    async append(entry) {
      await book.holdEntry(entry);
    },
    async removeEntry(entry) {
      await book.releaseEntry(entry);
    },
    async size() {
      const entries = await book.load();
      return entries.length;
    },
  };
}
