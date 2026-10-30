/**
 * Process-local once-store. One successful sigma claims its payment id and
 * its authorization, and a later request for either is refused.
 * A caller can pass its own store with the same claim/release methods when
 * the refusal has to outlive this process.
 */

export function createOnceStore() {
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
  };
}
