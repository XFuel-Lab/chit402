/**
 * HTML rendering for static pages. No filesystem and no network.
 */

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asParts(value) {
  if (value == null) return [];
  return typeof value === 'string' ? [value] : value;
}

function anchor(link) {
  const blank = link.blank ? ' target="_blank" rel="noreferrer"' : '';
  return `<a href="${escapeHtml(link.href)}"${blank}>${escapeHtml(link.label)}</a>`;
}

export function renderParts(parts) {
  let html = '';
  for (const part of asParts(parts)) {
    if (typeof part === 'string') html += escapeHtml(part);
    else if (part.code != null) html += `<code>${escapeHtml(part.code)}</code>`;
    else if (part.strong != null) html += `<strong>${escapeHtml(part.strong)}</strong>`;
    else if (part.link) html += anchor(part.link);
  }
  return html;
}

function paragraphHtml(paragraph) {
  return `<p>${renderParts(paragraph)}</p>`;
}

function renderCard(card) {
  let html = '';
  if (card.href) {
    const blank = card.blank ? ' target="_blank" rel="noreferrer"' : '';
    html += `<h3><a href="${escapeHtml(card.href)}"${blank}>${escapeHtml(card.heading)}</a></h3>`;
  } else if (card.heading) {
    html += `<h3>${escapeHtml(card.heading)}</h3>`;
  }
  if (card.body != null) html += paragraphHtml(card.body);
  for (const paragraph of card.paragraphs || []) html += paragraphHtml(paragraph);
  if (card.items && card.items.length) {
    html += '<ul>';
    for (const item of card.items) html += `<li>${renderParts(item)}</li>`;
    html += '</ul>';
  }
  if (card.meta) html += `<p>${escapeHtml(card.meta)}</p>`;
  for (const pre of card.pre || []) html += `<pre><code>${escapeHtml(pre)}</code></pre>`;
  return html;
}

function renderFlow(flow) {
  let html = '';
  for (const step of flow) {
    if (step.p != null) html += paragraphHtml(step.p);
    if (step.pre != null) html += `<pre><code>${escapeHtml(step.pre)}</code></pre>`;
    if (step.links) for (const link of step.links) html += anchor(link);
  }
  return html;
}

export function renderBlock(page) {
  const sections = page.sections || [];
  let html = `<h1>${escapeHtml(page.h1)}</h1>`;
  for (const section of sections) {
    html += '<section>';
    if (section.heading) html += `<h2>${escapeHtml(section.heading)}</h2>`;
    if (section.flow) html += renderFlow(section.flow);
    for (const paragraph of section.paragraphs || []) html += paragraphHtml(paragraph);
    for (const card of section.cards || []) html += renderCard(card);
    if (section.items && section.items.length) {
      html += '<ul>';
      for (const item of section.items) html += `<li>${renderParts(item)}</li>`;
      html += '</ul>';
    }
    for (const link of section.links || []) html += anchor(link);
    for (const pre of section.pre || []) html += `<pre><code>${escapeHtml(pre)}</code></pre>`;
    html += '</section>';
  }
  return html;
}

export function injectStatic(html, page) {
  const block = renderBlock(page);
  return html.replace('<div id="root"></div>', () => `<div id="root">${block}</div>`);
}
