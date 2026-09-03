/**
 * Brand mark served at GET /chit402-icon.svg (gateway) and apps/web/public/.
 * Discovery `iconUrl` uses the request's resolved base URL so the icon
 * host matches the API host (e.g. api.chit402.com → api.chit402.com/chit402-icon.svg).
 * Crawlers stay on the same host and do not follow the apex 307 into the SPA.
 *
 * Per naming law: public/searchable name is Chit402; Chit is spoken shorthand only.
 * No legacy XF art in directory-facing iconUrl.
 */

/** Fallback when no base URL is provided. */
export const CHIT402_ICON_URL = 'https://api.chit402.com/chit402-icon.svg';

/**
 * Build the icon URL from the resolved base URL.
 * @param {string} [baseUrl] - Resolved public base URL (e.g. https://api.chit402.com)
 * @returns {string} Absolute icon URL
 */
export function buildIconUrl(baseUrl) {
  if (!baseUrl) return CHIT402_ICON_URL;
  const base = String(baseUrl).replace(/\/$/, '');
  return `${base}/chit402-icon.svg`;
}

/** Legacy export for backward compatibility. */
export const XFUEL_ICON_URL = CHIT402_ICON_URL;

export const CHIT402_ICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Chit402">
  <rect width="64" height="64" rx="8" fill="#0b0b12"/>
  <text x="32" y="40" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="14" font-weight="700" fill="#00d4ff">Chit402</text>
</svg>
`;

/** Legacy export alias. */
export const XFUEL_ICON_SVG = CHIT402_ICON_SVG;
