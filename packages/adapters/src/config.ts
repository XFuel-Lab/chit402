/** Default Chit402 OpenAI-compatible base URL (includes /v1). */
export const DEFAULT_CHIT_BASE_URL = 'https://api.chit402.com/v1';

/** Gateway origin without /v1 — used to build receipt URLs. */
export const DEFAULT_CHIT_API_URL = 'https://api.chit402.com';

/** @deprecated Public demo keys no longer grant free completions. */
export const DEFAULT_CHIT_DEMO_KEY = 'chit402-demo';

const ENV_ALIASES = {
  apiUrl: ['CHIT_API_URL', 'CHIT402_API_URL', 'XFUEL_API_URL'],
  apiKey: ['CHIT_API_KEY', 'CHIT402_API_KEY', 'XFUEL_API_KEY'],
} as const;

function firstEnv(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export interface ChitClientConfig {
  /** OpenAI-compatible base URL including `/v1`. */
  baseURL: string;
  /** Gateway origin for receipt URLs (no trailing slash). */
  apiUrl: string;
  /** API key sent as `Authorization: Bearer` or `X-API-Key`. */
  apiKey: string;
}

export interface ResolveChitConfigOptions {
  baseURL?: string;
  apiUrl?: string;
  apiKey?: string;
}

/** Normalize a gateway origin or /v1 base into `{ apiUrl, baseURL }`. */
export function normalizeChitUrls(input?: string): { apiUrl: string; baseURL: string } {
  const raw = (input ?? DEFAULT_CHIT_API_URL).replace(/\/$/, '');
  if (raw.endsWith('/v1')) {
    return { apiUrl: raw.slice(0, -3), baseURL: raw };
  }
  return { apiUrl: raw, baseURL: `${raw}/v1` };
}

/** Resolve Chit402 client settings from options + env (CHIT_* with XFUEL_* aliases). */
export function resolveChitConfig(options: ResolveChitConfigOptions = {}): ChitClientConfig {
  const envUrl = firstEnv(ENV_ALIASES.apiUrl);
  const envKey = firstEnv(ENV_ALIASES.apiKey);

  const urlSeed = options.baseURL ?? options.apiUrl ?? envUrl ?? DEFAULT_CHIT_API_URL;
  const { apiUrl, baseURL } = normalizeChitUrls(urlSeed);

  return {
    baseURL,
    apiUrl,
    apiKey: options.apiKey ?? envKey ?? '',
  };
}
