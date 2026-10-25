/**
 * Refuses and records any fetch off 127.0.0.1, so a test never reaches a
 * real host. Import it in a test file, or pass it with `--import` to a CLI
 * child: each refusal is also written to stderr as `OFF_LOOPBACK <url>`.
 */
export const offHost = [];

if (!globalThis.__chitLoopbackGuard) {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.__chitLoopbackGuard = offHost;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const host = new URL(String(url)).hostname;
    if (host !== '127.0.0.1') {
      globalThis.__chitLoopbackGuard.push(String(url));
      process.stderr.write(`OFF_LOOPBACK ${String(url)}\n`);
      throw new TypeError('off-loopback fetch refused in test');
    }
    return realFetch(input, init);
  };
}

export const loopbackGuardImport = import.meta.url;
