/**
 * Home HTML for the chit edge. Path / only. No filesystem and no network.
 */
import { homeStaticModel } from '../src/content/homeContent.mjs';
import { injectStatic } from './static-render.mjs';

export function chitHomePage(verifyUrl, githubUrl) {
  return homeStaticModel({ verifyUrl, githubUrl });
}

export function injectHomeIfRoot(html, pathname, page) {
  if (pathname !== '/') return html;
  return injectStatic(html, page);
}
