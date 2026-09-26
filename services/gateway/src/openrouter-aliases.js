/**
 * Familiar names → an OpenRouter catalog row, only when that hub is listed.
 *
 * When no `hub: 'openrouter'` row is present the function returns null and the
 * open-model alias table (and any resolver registered later) keeps the request.
 * A specific name that is not actually listed does not fall through onto a
 * different closed model.
 */

function normToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function openrouterRows(models) {
  return (models || []).filter((m) => m && m.hub === 'openrouter' && m.alias && !String(m.alias).includes(':'));
}

function vendorRows(rows, vendor, family) {
  const prefix = `${vendor}/`;
  return rows.filter((m) => {
    const alias = String(m.alias);
    return alias.startsWith(prefix) && alias.includes(family);
  });
}

function exactSuffix(rows, requested) {
  const want = normToken(requested);
  const hits = rows.filter((m) => {
    const alias = String(m.alias);
    const suffix = alias.includes('/') ? alias.slice(alias.indexOf('/') + 1) : alias;
    return normToken(suffix) === want || normToken(alias) === want;
  });
  if (!hits.length) return null;
  hits.sort((a, b) => String(a.alias).length - String(b.alias).length);
  return hits[0];
}

function preferredFamily(rows, token) {
  const preferred = rows.filter((m) => String(m.alias).includes(token));
  const pool = preferred.length ? preferred : rows;
  if (!pool.length) return null;
  pool.sort((a, b) => String(a.alias).length - String(b.alias).length);
  return pool[0];
}

/**
 * @param {string} name caller model string
 * @param {object[]} models live catalog rows
 * @returns {object|null} catalog row, or null to keep the open-model aliases
 */
export function resolveOpenRouterFamiliar(name, models) {
  const rows = openrouterRows(models);
  if (!rows.length) return null;
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;

  if (key === 'gpt-4o-mini' || key === 'gpt-4o') {
    return exactSuffix(vendorRows(rows, 'openai', 'gpt-4o'), key);
  }

  const claude = key === 'claude' || key.startsWith('claude-') || key.startsWith('claude.');
  if (claude) {
    const list = vendorRows(rows, 'anthropic', 'claude');
    if (key === 'claude') return preferredFamily(list, 'sonnet');
    return exactSuffix(list, key);
  }

  const gemini = key === 'gemini' || key.startsWith('gemini-') || key.startsWith('gemini.');
  if (gemini) {
    const list = vendorRows(rows, 'google', 'gemini');
    if (key === 'gemini') return preferredFamily(list, 'flash');
    return exactSuffix(list, key);
  }

  // Native OpenRouter id without our prefix: `openai/gpt-4o-mini`.
  if (key.includes('/')) {
    return rows.find((m) => String(m.alias).toLowerCase() === key) || null;
  }
  return null;
}
