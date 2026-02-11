import { useEffect, useRef, useCallback } from 'react';

/**
 * Generic polling hook. Calls `fetchFn` every `intervalMs` while `enabled`.
 * Stops when component unmounts or `enabled` flips to false.
 *
 * @param {() => Promise<any>} fetchFn   Async function to call
 * @param {number}             intervalMs Interval between calls (default 5000)
 * @param {boolean}            enabled    Whether polling is active
 */
export default function usePoller(fetchFn, intervalMs = 5000, enabled = true) {
  const savedFn = useRef(fetchFn);

  useEffect(() => {
    savedFn.current = fetchFn;
  }, [fetchFn]);

  const tick = useCallback(() => savedFn.current(), []);

  useEffect(() => {
    if (!enabled) return;
    // Immediate first call
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [tick, intervalMs, enabled]);
}
