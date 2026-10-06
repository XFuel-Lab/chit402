const body = process.env.CHIT_TEST_JWKS || '{"keys":[]}';
const allow = new Set(String(process.env.CHIT_TEST_JWKS_URL || '').split(',').filter(Boolean));

globalThis.fetch = async (input) => {
  const href = typeof input === 'string' ? input : input?.url;
  if (allow.has(String(href))) {
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
};
