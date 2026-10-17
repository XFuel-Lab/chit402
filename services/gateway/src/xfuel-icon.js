/**
 * Brand mark served at GET /chit402-icon.svg (gateway) and apps/web/public/.
 * Discovery `iconUrl` uses the request's resolved base URL so the icon
 * host matches the API host (e.g. api.chit402.com → api.chit402.com/chit402-icon.svg).
 * Crawlers stay on the same host and do not follow the apex 307 into the SPA.
 *
 * Per naming law: public/searchable name is Chit402; Chit is spoken shorthand only.
 * No legacy XF art in directory-facing iconUrl.
 *
 * Artwork is the black/white/blue receipt. Regenerate with
 * scripts/render-chit402-brand.py so this string matches
 * apps/web/public/chit402-icon.svg.
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
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -23 662 662" width="662" height="662" role="img" aria-label="Chit402">
  <title>Chit402</title>
  <rect width="662" height="616" rx="130" fill="#202026"/>
<path fill="#ffffff" d="M67 93H83A14 14 0 0 0 111 93H135A14 14 0 0 0 163 93H187A14 14 0 0 0 215 93H239A14 14 0 0 0 267 93H291A14 14 0 0 0 319 93H343A14 14 0 0 0 371 93H395A14 14 0 0 0 423 93H447A14 14 0 0 0 475 93H499A14 14 0 0 0 527 93H551A14 14 0 0 0 579 93H595V512A12 12 0 0 1 583 524H79A12 12 0 0 1 67 512Z"/>
<path fill="#dfe3ea" d="M541 101H595V157Z"/>
<path fill="#16161c" fill-opacity=".18" d="M539.5 107V153A9 9 0 0 0 548.5 162H592.5Z"/>
<path fill="#ffffff" d="M541 103V149A9 9 0 0 0 550 158H594Z"/>
<path fill="#0095b8" d="M119 313.17V285.01L196.63 174.84H219.47V209.63H206.8L154.15 284.66V284.89H264.32V313.17ZM207.04 351.16V304.65V291.99V174.84H241.24V351.16ZM339.22 354Q317.1 354 301.12 342.94Q285.14 331.87 276.51 311.52Q267.87 291.16 267.87 263.12Q267.87 234.95 276.45 214.6Q285.03 194.25 301 183.12Q316.98 172 339.22 172Q361.35 172 377.39 183.06Q393.42 194.13 402 214.54Q410.58 234.95 410.58 263.12Q410.58 291.16 402 311.52Q393.42 331.87 377.39 342.94Q361.35 354 339.22 354ZM339.22 324.89Q350.7 324.89 358.99 317.43Q367.27 309.98 371.77 296.13Q376.26 282.29 376.26 263.12Q376.26 243.83 371.77 229.98Q367.27 216.14 358.99 208.62Q350.7 201.11 339.22 201.11Q327.75 201.11 319.4 208.62Q311.06 216.14 306.62 229.98Q302.19 243.83 302.19 263.12Q302.19 282.29 306.62 296.13Q311.06 309.98 319.4 317.43Q327.75 324.89 339.22 324.89ZM416.62 351.16V324.42L481.23 269.15Q489.04 262.29 495.19 256.25Q501.35 250.22 504.84 243.59Q508.33 236.97 508.33 228.8Q508.33 220.4 504.84 214.19Q501.35 207.97 494.96 204.54Q488.57 201.11 479.93 201.11Q470.46 201.11 463.66 205.25Q456.85 209.39 453.12 217.03Q449.4 224.66 449.4 235.43H415.91Q415.91 216.26 423.78 202Q431.65 187.74 445.96 179.87Q460.28 172 479.93 172Q498.03 172 512.11 178.75Q526.2 185.49 534.18 197.86Q542.17 210.22 542.17 226.91Q542.17 239.21 537.56 249.39Q532.94 259.57 524.24 269.09Q515.55 278.62 503.24 289.15L465.85 321.69V321.93H543V351.16Z"/>
<path fill="#5a5f6b" d="M101 388h460v9h-460zM101 445h460v9h-460z"/>
<path fill="#16161c" d="M124 412h104v13h-104zM489 412h72v13h-72zM124 469h104v13h-104zM489 469h72v13h-72z"/>
</svg>
`;

/** Legacy export alias. */
export const XFUEL_ICON_SVG = CHIT402_ICON_SVG;
