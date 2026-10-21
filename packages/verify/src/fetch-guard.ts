/**
 * Follow-up reads (issuer history, JWKS, inclusion, tree head, epoch,
 * preimages) never follow a redirect. A redirect is refused and the read is
 * treated as unreachable, so the check it feeds is could_not_check.
 */

export const REDIRECT_REFUSED = 'redirect_refused';

export class RedirectRefusedError extends Error {
  readonly code = REDIRECT_REFUSED;
  constructor(url: string) {
    super(`${REDIRECT_REFUSED}: ${url}`);
    this.name = 'RedirectRefusedError';
  }
}

function causeMentionsRedirect(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 4; depth++) {
    const message = (cur as { message?: unknown }).message;
    if (typeof message === 'string' && /redirect/i.test(message)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * fetch with `redirect: 'error'`. A custom fetch that ignores the option is
 * still checked: a 3xx status or `redirected: true` is refused.
 */
export async function fetchNoRedirect(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, redirect: 'error' });
  } catch (err) {
    if (causeMentionsRedirect(err)) throw new RedirectRefusedError(url);
    throw err;
  }
  if (res && (res.redirected === true || (res.status >= 300 && res.status < 400))) {
    throw new RedirectRefusedError(url);
  }
  return res;
}

export function isRedirectRefused(err: unknown): boolean {
  return err instanceof RedirectRefusedError
    || (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === REDIRECT_REFUSED);
}
