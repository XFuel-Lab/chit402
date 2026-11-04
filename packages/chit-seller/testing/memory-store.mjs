/**
 * In-memory once-store for tests only. Production passes a shared durable
 * store into createSeller. Two instances must share that store: separate
 * stores will sign the same payment twice.
 *
 * claim(id) is the atomic take. release(id) undoes a claim that did not
 * finish. has(id) reports a live claim.
 */

export function createMemoryStore() {
  const held = new Set();
  return {
    claim(id) {
      if (typeof id !== 'string' || id.length === 0) return false;
      if (held.has(id)) return false;
      held.add(id);
      return true;
    },
    release(id) {
      if (typeof id !== 'string') return;
      held.delete(id);
    },
    has(id) {
      return held.has(id);
    },
    list(prefix) {
      const out = [];
      for (const id of held) {
        if (typeof prefix !== 'string' || id.startsWith(prefix)) out.push(id);
      }
      return out;
    },
  };
}
