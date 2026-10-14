/**
 * Release gate for chit402-verify and the @xfuel/verify alias.
 * Fails when the versions differ or the alias dependency is a range.
 */
import { readFileSync } from 'node:fs';

const primary = JSON.parse(readFileSync(new URL('../packages/verify/package.json', import.meta.url), 'utf8'));
const alias = JSON.parse(readFileSync(new URL('../packages/aliases/chit402-verify/package.json', import.meta.url), 'utf8'));

const errors = [];
if (primary.name !== 'chit402-verify') errors.push(`primary name is ${primary.name}`);
if (alias.name !== '@xfuel/verify') errors.push(`alias name is ${alias.name}`);
if (primary.version !== alias.version) errors.push(`versions differ: ${primary.version} vs ${alias.version}`);
const dep = alias.dependencies?.['chit402-verify'];
if (dep !== primary.version) errors.push(`alias dependency must be the exact pin ${primary.version}, got ${dep}`);
if (/[\^~]/.test(String(dep))) errors.push('alias dependency must not use a caret or tilde');
if (primary.publishConfig?.provenance !== true) errors.push('chit402-verify publishConfig.provenance must be true');
if (alias.publishConfig?.provenance !== true) errors.push('@xfuel/verify publishConfig.provenance must be true');
const bins = primary.bin || {};
if (bins['chit402-verify'] == null || bins['xfuel-verify'] == null) {
  errors.push('chit402-verify must ship both chit402-verify and xfuel-verify bins');
}

if (errors.length) {
  for (const line of errors) console.error(line);
  process.exit(1);
}
console.log(`chit402-verify@${primary.version} alias pin ${dep}`);
