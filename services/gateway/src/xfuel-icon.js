/**
 * Brand mark served at GET /xfuel-icon.svg (gateway) and apps/web/public/.
 * Discovery `iconUrl` points at https://api.xfuel.app/xfuel-icon.svg so
 * crawlers do not follow the apex 307 into the marketing SPA.
 */

export const XFUEL_ICON_URL = 'https://api.xfuel.app/xfuel-icon.svg';

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
