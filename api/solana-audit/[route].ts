import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleSolanaAudit, sendSolanaAudit } from './_handler.mjs';

export const maxDuration = 15;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const host = String(req.headers.host || 'localhost');
  const url = req.url?.startsWith('http') ? req.url : `https://${host}${req.url || ''}`;
  const result = await handleSolanaAudit({
    method: req.method,
    url,
    headers: req.headers,
  });
  sendSolanaAudit(res, result);
}
