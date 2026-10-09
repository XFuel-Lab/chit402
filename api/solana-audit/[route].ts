import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleSolanaAudit, sendSolanaAudit } from './_handler.mjs';

export const maxDuration = 15;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = typeof req.query.route === 'string' ? req.query.route : '';
  const host = String(req.headers.host || 'localhost');
  const url = req.url?.startsWith('http') ? req.url : `https://${host}${req.url || `/api/solana-audit/${route}`}`;
  const result = await handleSolanaAudit({
    method: req.method,
    url,
    headers: req.headers,
    route,
  });
  sendSolanaAudit(res, result);
}
