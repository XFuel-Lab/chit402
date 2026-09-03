/**
 * Host-based configuration for dual-door deployment.
 * chit402.com → Chit branding
 * xfuel.app → XFuel branding (default)
 */

export type HostBrand = 'chit' | 'xfuel';

export interface HostConfig {
  brand: HostBrand;
  name: string;
  tagline: string;
  parent: string;
  domain: string;
  apiDomain: string;
  ogImage: string;
  twitterHandle: string;
  githubUrl: string;
  seo: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
  };
}

const CHIT_CONFIG: HostConfig = {
  brand: 'chit',
  name: 'Chit',
  tagline: 'The chit x402 doesn\'t leave you.',
  parent: 'XFuel Lab',
  domain: 'www.chit402.com',
  apiDomain: 'api.chit402.com',
  ogImage: 'https://www.chit402.com/og-image.png',
  twitterHandle: '@chit402',
  githubUrl: 'https://github.com/XFuel-Lab/xfuel-protocol',
  seo: {
    title: 'Chit402 — A receipt you still hold if the agent wallet moves.',
    description: 'Chit: the x402 receipt that doesn\'t leave you. Hub, model, amount — you hold the book. By XFuel Lab.',
    ogTitle: 'Chit402 — A receipt you still hold.',
    ogDescription: 'Chit: the x402 receipt that doesn\'t leave you. Hub, model, amount — you hold the book. By XFuel Lab.',
  },
};

const XFUEL_CONFIG: HostConfig = {
  brand: 'xfuel',
  name: 'XFuel',
  tagline: 'XFuel is the book.',
  parent: 'XFuel Lab',
  domain: 'xfuel.app',
  apiDomain: 'api.xfuel.app',
  ogImage: 'https://www.xfuel.app/og-image.png',
  twitterHandle: '@XFuelLab',
  githubUrl: 'https://github.com/XFuel-Lab/xfuel-protocol',
  seo: {
    title: 'XFuel — the book. Hub, model, amount.',
    description: 'XFuel is the book: hub, model, and amount. Signed receipt, verify_url, cost-plus. USDC on Base and Solana.',
    ogTitle: 'XFuel — the book. Hub, model, amount.',
    ogDescription: 'XFuel is the book: hub, model, and amount. Signed receipt, verify_url, cost-plus. USDC on Base and Solana.',
  },
};

function detectBrand(): HostBrand {
  if (typeof window === 'undefined') return 'chit';
  const host = window.location.hostname.toLowerCase();
  if (host === 'chit402.com' || host === 'www.chit402.com' || host.endsWith('.chit402.com')) {
    return 'chit';
  }
  return 'xfuel';
}

let cachedConfig: HostConfig | null = null;

export function getHostConfig(): HostConfig {
  if (cachedConfig) return cachedConfig;
  const brand = detectBrand();
  cachedConfig = brand === 'chit' ? CHIT_CONFIG : XFUEL_CONFIG;
  return cachedConfig;
}

export function isChitHost(): boolean {
  return getHostConfig().brand === 'chit';
}

export function isXFuelHost(): boolean {
  return getHostConfig().brand === 'xfuel';
}

export function resetHostConfig(): void {
  cachedConfig = null;
}

export function setHostConfigForTest(brand: HostBrand): void {
  cachedConfig = brand === 'chit' ? CHIT_CONFIG : XFUEL_CONFIG;
}
