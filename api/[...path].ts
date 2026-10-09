import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Unknown /api routes. Specific api files keep their own handlers. */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.status(404).json({ v: 1, error: 'not_found' });
}
