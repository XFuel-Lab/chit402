/**
 * Build-time HTML for readers that do not run JavaScript.
 * Copy comes from the same modules the React pages render.
 * This module does not fetch.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeStaticModel } from '../src/content/homeContent.mjs';
import { checkStaticModel } from '../src/content/checkContent.mjs';
import { docsStaticModel } from '../src/content/docsContent.mjs';
import { pricingStaticModel } from '../src/content/pricingContent.mjs';
import { injectStatic } from './static-render.mjs';

export { escapeHtml, renderParts, renderBlock, injectStatic } from './static-render.mjs';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** dist/index.html is the fallback shell. Home copy is injected at the edge for / only. */
export function indexHtmlForBuild(shell) {
  return shell;
}

export const STATIC_ROUTES = ['/', '/check', '/docs', '/pricing'];

export function readChitStaticEnv(hostConfigSrc) {
  const block = hostConfigSrc.match(/const CHIT_CONFIG: HostConfig = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('CHIT_CONFIG missing');
  const pick = (key) => {
    const found = block[1].match(new RegExp(`${key}: '([^']*)'`));
    if (!found) throw new Error(`CHIT_CONFIG.${key} missing`);
    return found[1];
  };
  const apiDomain = pick('apiDomain');
  const apiHost = `https://${apiDomain}`;
  return {
    productName: pick('name'),
    apiDomain,
    apiHost,
    apiV1: `${apiHost}/v1`,
    githubUrl: pick('githubUrl'),
  };
}

export function readLiveReceiptVerifyUrl(specimenSrc) {
  const id = specimenSrc.match(/export const LIVE_RECEIPT_TASK_ID = '([^']+)';/);
  const tmpl = specimenSrc.match(/export const LIVE_RECEIPT_VERIFY_URL = `([^`]+)`;/);
  if (!id || !tmpl || !tmpl[1].includes('${LIVE_RECEIPT_TASK_ID}')) {
    throw new Error('LIVE_RECEIPT_VERIFY_URL missing');
  }
  return tmpl[1].replace('${LIVE_RECEIPT_TASK_ID}', id[1]);
}

export function loadChitStaticEnv() {
  const host = readFileSync(join(webRoot, 'src/hostConfig.ts'), 'utf8');
  const specimen = readFileSync(join(webRoot, 'src/lib/liveReceiptSpecimen.ts'), 'utf8');
  return { env: readChitStaticEnv(host), verifyUrl: readLiveReceiptVerifyUrl(specimen) };
}

export function contentForRoute(route, env, verifyUrl) {
  switch (route) {
    case '/':
      return homeStaticModel({ verifyUrl, githubUrl: env.githubUrl });
    case '/check':
      return checkStaticModel();
    case '/docs':
      return docsStaticModel(env);
    case '/pricing':
      return pricingStaticModel(env);
    default:
      return null;
  }
}

export function renderRouteHtml(shell, route, page, meta, transformHtml) {
  const html = meta ? transformHtml(shell, route, meta) : shell;
  return injectStatic(html, page);
}
