import type { VercelRequest, VercelResponse } from '@vercel/node';

function isChitHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'chit402.com' || h === 'www.chit402.com' || h.endsWith('.chit402.com');
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const host = (req.headers.host || req.headers['x-forwarded-host'] || '') as string;
  const domain = isChitHost(host) ? 'chit402.com' : 'www.xfuel.app';
  
  const content = `User-agent: *
Allow: /

Sitemap: https://${domain}/sitemap.xml
`;
  
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(content);
}
