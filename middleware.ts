export const config = {
  matcher: [
    '/',
    '/v1',
    '/v1/:path*',
  ],
};

const CHIT_SEO = {
  title: 'Chit — A receipt you still hold if the agent wallet moves.',
  description: 'Chit: the x402 receipt that doesn\'t leave you. Hub, model, amount — you hold the book. By XFuel Lab.',
  ogTitle: 'Chit — A receipt you still hold.',
  ogDescription: 'Chit: the x402 receipt that doesn\'t leave you. Hub, model, amount — you hold the book. By XFuel Lab.',
  ogImage: 'https://chit402.com/og-image.png',
  domain: 'chit402.com',
};

const CHIT_V1_SEO = {
  title: 'Pay /v1/chat/completions | Chit',
  description: 'Bot drop-in. Wallet pays. You hold the book. The wire is api.xfuel.app/v1.',
  ogTitle: 'Pay /v1/chat/completions | Chit',
  ogDescription: 'Bot drop-in. Wallet pays. You hold the book. The wire is api.xfuel.app/v1.',
  ogImage: 'https://chit402.com/og-image.png',
  domain: 'chit402.com',
};

function isChitHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'chit402.com' || h === 'www.chit402.com' || h.endsWith('.chit402.com');
}

interface SeoConfig {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  domain: string;
  h1: string;
  lede: string;
}

const CHIT_HOME_SEO: SeoConfig = {
  ...CHIT_SEO,
  h1: 'Chit — the x402 receipt that doesn\'t leave you.',
  lede: 'A receipt you still hold if the agent wallet moves. Hub, model, amount — you hold the book. POST /v1/chat/completions returns a signed receipt. Cost-plus, quoted, receipted — USDC on Base and Solana. The wire is api.xfuel.app/v1. By XFuel Lab.',
};

const CHIT_V1_SEO_FULL: SeoConfig = {
  ...CHIT_V1_SEO,
  h1: 'Bot drop-in. Wallet pays. You hold the book.',
  lede: 'Exact product: baseURL https://api.xfuel.app/v1. POST /v1/chat/completions is cost-plus, quoted, receipted — USDC on Base and Solana. Without payment or a demo key, the gateway returns HTTP 402. By XFuel Lab.',
};

function transformHtml(html: string, seo: SeoConfig, pathname: string): string {
  const canonicalUrl = `https://${seo.domain}${pathname}`;
  
  let result = html
    .replace(/<title>[^<]*<\/title>/, `<title>${seo.title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${seo.description}" />`
    )
    .replace(
      /<meta property="og:title" content="[^"]*" \/>/,
      `<meta property="og:title" content="${seo.ogTitle}" />`
    )
    .replace(
      /<meta property="og:description" content="[^"]*" \/>/,
      `<meta property="og:description" content="${seo.ogDescription}" />`
    )
    .replace(
      /<meta property="og:image" content="[^"]*" \/>/,
      `<meta property="og:image" content="${seo.ogImage}" />`
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*" \/>/,
      `<meta name="twitter:title" content="${seo.ogTitle}" />`
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*" \/>/,
      `<meta name="twitter:description" content="${seo.ogDescription}" />`
    );

  if (!result.includes('rel="canonical"')) {
    result = result.replace(/<\/head>/, `  <link rel="canonical" href="${canonicalUrl}" />\n</head>`);
  } else {
    result = result.replace(
      /<link rel="canonical" href="[^"]*" \/>/,
      `<link rel="canonical" href="${canonicalUrl}" />`
    );
  }

  const chitNoscript = `
  <noscript>
    <article style="max-width:640px;margin:2rem auto;padding:1rem;font-family:system-ui,sans-serif;">
      <h1>${seo.h1}</h1>
      <p>${seo.lede}</p>
    </article>
  </noscript>`;

  if (result.includes('<noscript>')) {
    result = result.replace(/<noscript>[\s\S]*?<\/noscript>/, chitNoscript.trim());
  } else {
    result = result.replace(
      /<div id="root"><\/div>/,
      `<div id="root"></div>${chitNoscript}`
    );
  }

  return result;
}

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const host = request.headers.get('host') || '';
  
  if (!isChitHost(host)) {
    return fetch(request);
  }
  
  const response = await fetch(request);
  const contentType = response.headers.get('content-type') || '';
  
  if (!contentType.includes('text/html')) {
    return response;
  }
  
  const html = await response.text();
  const pathname = url.pathname;
  const seo = pathname.startsWith('/v1') ? CHIT_V1_SEO_FULL : CHIT_HOME_SEO;
  const transformedHtml = transformHtml(html, seo, pathname);
  
  return new Response(transformedHtml, {
    status: response.status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
