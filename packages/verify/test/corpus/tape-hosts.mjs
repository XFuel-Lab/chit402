/**
 * The only hosts the corpus recorder reads (https GET). Shared by
 * tape-preload.mjs and the tape tests; importing it has no side effects.
 */
export const GET_HOSTS = new Set([
  'api.chit402.com', 'chit402.com', 'www.chit402.com',
  'api.xfuel.app', 'xfuel.app', 'www.xfuel.app',
]);
