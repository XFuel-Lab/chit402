#!/usr/bin/env node
/**
 * Lightweight validator for XFuel Agent Skills.
 *
 * Checks each skills/<name>/SKILL.md:
 *   - YAML frontmatter present with `name` + `description`
 *   - frontmatter `name` matches the directory name
 * And verifies every relative doc reference (../_shared/..., ./...) resolves to a
 * file that exists on disk. Exits non-zero on any failure.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');

const errors = [];
const info = [];

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  // minimal YAML: top-level `key:` scalars and `key: >-` folded blocks
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val === '>-' || val === '>' || val === '|') {
      const buf = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        buf.push(lines[++i].trim());
      }
      val = buf.join(' ');
    }
    out[key] = val.replace(/^["']|["']$/g, '');
  }
  return out;
}

const skillDirs = readdirSync(skillsDir).filter((d) => {
  const p = join(skillsDir, d);
  return statSync(p).isDirectory() && d !== '_shared' && existsSync(join(p, 'SKILL.md'));
});

for (const dir of skillDirs) {
  const file = join(skillsDir, dir, 'SKILL.md');
  const text = readFileSync(file, 'utf8');
  const fm = frontmatter(text);
  if (!fm) { errors.push(`${dir}/SKILL.md: missing YAML frontmatter`); continue; }
  if (!fm.name) errors.push(`${dir}/SKILL.md: frontmatter missing 'name'`);
  if (!fm.description) errors.push(`${dir}/SKILL.md: frontmatter missing 'description'`);
  if (fm.name && fm.name !== dir) errors.push(`${dir}/SKILL.md: name '${fm.name}' != dir '${dir}'`);
  if (fm.description && fm.description.length < 40)
    errors.push(`${dir}/SKILL.md: description suspiciously short (${fm.description.length} chars)`);

  // Referenced relative files (skip URLs and anchors)
  const refs = [...text.matchAll(/\]\((\.[^)]+)\)/g)].map((m) => m[1]);
  const inlineRefs = [...text.matchAll(/`(\.\.\/[\w./-]+\.(?:md|yaml|yml))`/g)].map((m) => m[1]);
  for (const ref of [...refs, ...inlineRefs]) {
    const clean = ref.split('#')[0];
    if (!clean || clean.startsWith('http')) continue;
    const target = resolve(join(skillsDir, dir), clean);
    if (!existsSync(target)) errors.push(`${dir}/SKILL.md: broken reference -> ${ref}`);
  }
  info.push(`ok: ${dir} (${fm.description.length} char desc)`);
}

// README references
const readme = join(skillsDir, 'README.md');
if (existsSync(readme)) {
  const text = readFileSync(readme, 'utf8');
  const refs = [...text.matchAll(/\]\((\.[^)]+)\)/g)].map((m) => m[1]);
  for (const ref of refs) {
    const clean = ref.split('#')[0];
    if (!clean || clean.startsWith('http')) continue;
    const target = resolve(skillsDir, clean);
    if (!existsSync(target)) errors.push(`README.md: broken reference -> ${ref}`);
  }
}

console.log(info.join('\n'));
console.log(`\nValidated ${skillDirs.length} skills.`);
if (errors.length) {
  console.error(`\n${errors.length} ERROR(S):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('All skills valid.');
