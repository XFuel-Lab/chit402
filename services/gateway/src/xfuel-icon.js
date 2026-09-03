/**
 * Brand mark served at GET /xfuel-icon.svg (gateway) and apps/web/public/.
 * Discovery `iconUrl` uses the request's resolved base URL so the icon
 * host matches the API host (e.g. api.chit402.com → api.chit402.com/xfuel-icon.svg).
 * Crawlers stay on the same host and do not follow the apex 307 into the SPA.
 * Filename stays xfuel-icon.svg (internal).
 */

/** Fallback when no base URL is provided. */
export const XFUEL_ICON_URL = 'https://api.xfuel.app/xfuel-icon.svg';

/**
 * Build the icon URL from the resolved base URL.
 * @param {string} [baseUrl] - Resolved public base URL (e.g. https://api.chit402.com)
 * @returns {string} Absolute icon URL
 */
export function buildIconUrl(baseUrl) {
  if (!baseUrl) return XFUEL_ICON_URL;
  const base = String(baseUrl).replace(/\/$/, '');
  return `${base}/xfuel-icon.svg`;
}

export const XFUEL_ICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="Chit">
  <circle cx="16" cy="16" r="14" fill="#0b0b12" stroke="url(#xfuel-g)" stroke-width="2.5"/>
  <path d="M10 16l4 4 8-8" fill="none" stroke="#00d4ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <defs>
    <linearGradient id="xfuel-g" x1="0" y1="0" x2="32" y2="32">
      <stop stop-color="#00d4ff"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
</svg>
`;
