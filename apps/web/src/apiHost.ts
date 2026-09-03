import { getHostConfig } from './hostConfig';

/** Canonical public gateway. api.xfuel.app is a live alias. */
export function getApiHost(): string {
  return `https://${getHostConfig().apiDomain}`;
}

export function getApiV1(): string {
  return `${getApiHost()}/v1`;
}

/** Static fallback for Chit door (used in prerender / SSG). */
export const API_HOST = 'https://api.chit402.com';
export const API_V1 = `${API_HOST}/v1`;
