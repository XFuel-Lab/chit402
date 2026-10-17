/**
 * Cache headers for possession-gated reads.
 *
 * A book, policy, export, gaps report or lineage row is private to the
 * holder of the agent's session or book proof. Those secrets arrive in
 * request headers, so a shared cache keyed on the URL alone could hand one
 * agent's book to a caller who has no secret. These routes therefore send
 * `Cache-Control: private, no-store` on every status (200, 401, 403, 404,
 * 5xx), name the secret headers in `Vary`, and send no ETag, so a client
 * cannot get a 304 that confirms a guessed body.
 */

/** Request headers that carry possession for the book routes. */
export const POSSESSION_VARY = Object.freeze(['X-XFuel-Session', 'X-XFuel-Book-Proof']);

const noEtagViews = new WeakMap();

/**
 * A view of the Express app with ETag generation turned off. Express reads
 * the `etag fn` setting from `res.app` when it sends a body; every other
 * setting falls through to the real app.
 */
function noEtagView(app) {
  let view = noEtagViews.get(app);
  if (!view) {
    view = Object.create(app);
    view.settings = Object.create(app.settings);
    view.settings['etag fn'] = undefined;
    noEtagViews.set(app, view);
  }
  return view;
}

/**
 * Express middleware. Mount it before the handler so the headers are
 * already set when the handler answers, whatever the status.
 * @param {{ vary?: string[] }} [opts] extra request headers to name in Vary
 */
export function privateNoStore({ vary = [] } = {}) {
  const names = [...POSSESSION_VARY, ...vary];
  return function privateNoStoreMiddleware(req, res, next) {
    res.set('Cache-Control', 'private, no-store');
    for (const name of names) res.vary(name);
    if (req.app) {
      Object.defineProperty(res, 'app', {
        value: noEtagView(req.app),
        configurable: true,
        enumerable: false,
        writable: true,
      });
    }
    next();
  };
}
