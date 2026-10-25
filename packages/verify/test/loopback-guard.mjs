import net from 'node:net';

/**
 * Refuses and records any fetch off 127.0.0.1 (and any raw socket connect
 * off loopback), so a test never reaches a
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
  // N-E3 (646): a raw net/http/tls client is refused off loopback as well, so
  // a future non-fetch client cannot reach a real host from a test. A unix
  // socket path is local and allowed. The default host (none given) is
  // localhost.
  const realConnect = net.Socket.prototype.connect;
  const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);
  net.Socket.prototype.connect = function guardedConnect(...args) {
    let opts = args[0];
    if (Array.isArray(opts)) opts = opts[0];
    let host;
    let isPath = false;
    if (opts && typeof opts === 'object') {
      isPath = typeof opts.path === 'string';
      host = opts.host;
    } else if (typeof opts === 'string' && !/^\d+$/.test(opts)) {
      isPath = true;
    } else {
      host = typeof args[1] === 'string' ? args[1] : undefined;
    }
    if (!isPath && host !== undefined && !LOCAL.has(String(host).replace(/^\[|\]$/g, ''))) {
      const where = `${host}:${opts && typeof opts === 'object' ? opts.port : opts}`;
      globalThis.__chitLoopbackGuard.push(`net://${where}`);
      process.stderr.write(`OFF_LOOPBACK net://${where}\n`);
      throw new Error('off-loopback socket connect refused in test');
    }
    return realConnect.apply(this, args);
  };
}

export const loopbackGuardImport = import.meta.url;
