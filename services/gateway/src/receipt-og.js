/**
 * Per-receipt Open Graph share card images (1200×630 PNG).
 */
import { mergeReceiptView } from './receipt.js';
import {
  buildReceiptOgMeta,
  displayTaskIdForShare,
} from './receipt-og-meta.js';

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

function escSvg(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** SVG share card (1200×630) — rasterized to PNG for crawlers. */
export function buildReceiptOgSvg(receipt) {
  const view = mergeReceiptView(receipt);
  const meta = buildReceiptOgMeta(receipt, view);
  const displayId = displayTaskIdForShare(receipt.task_id || view.task_id);
  const proof = view.proof?.outcome === 'valid' ? 'Proven' : 'Signed';
  const routeModel = view.route?.model ? String(view.route.model) : '';
  const modelLine = routeModel.length > 48 ? `${routeModel.slice(0, 45)}…` : routeModel;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b0e14"/>
      <stop offset="100%" stop-color="#131824"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect x="48" y="48" width="1104" height="534" rx="24" fill="#131824" stroke="#222a3a" stroke-width="2"/>
  <text x="88" y="130" fill="#6ea8fe" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="28" font-weight="700">Chit402</text>
  <text x="88" y="210" fill="#e6e9ef" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="52" font-weight="700">${escSvg(meta.title)}</text>
  <text x="88" y="280" fill="#8b95a7" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="26">${escSvg(displayId)}</text>
  <text x="88" y="350" fill="#aab2c0" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="30">${escSvg(meta.description)}</text>
  <text x="88" y="420" fill="#6b7488" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="24">${escSvg(proof)} receipt${modelLine ? ` · ${escSvg(modelLine)}` : ''}</text>
  <text x="88" y="520" fill="#5b6370" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="20">verify_url · no auth</text>
</svg>`;
}

let sharpLoader;
async function loadSharp() {
  if (!sharpLoader) {
    sharpLoader = import('sharp').then((m) => m.default).catch((err) => {
      sharpLoader = null;
      throw err;
    });
  }
  return sharpLoader;
}

/** @returns {Promise<Buffer>} PNG bytes (image/png) */
export async function renderReceiptOgPng(receipt) {
  const svg = buildReceiptOgSvg(receipt);
  const sharp = await loadSharp();
  return sharp(Buffer.from(svg), { density: 144 })
    .resize(OG_WIDTH, OG_HEIGHT)
    .png()
    .toBuffer();
}
