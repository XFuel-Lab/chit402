#!/usr/bin/env node
/**
 * validate-skills.cjs — Validate XFuel Agent Skills against the spec basics.
 *
 * Checks every skills/<name>/SKILL.md:
 *   - has YAML frontmatter delimited by --- ... ---
 *   - frontmatter has non-empty `name` and `description`
 *   - `name` matches the containing directory name
 *   - `name` is lowercase-kebab and <= 64 chars
 *   - `description` <= 1024 chars (progressive-disclosure guidance)
 *
 * Usage: node scripts/validate-skills.cjs [skillsDir]
 * Exit 0 if all valid, 1 otherwise.
 */
const fs = require('fs');
const path = require('path');

const skillsDir = process.argv[2] || path.join(__dirname, '..', 'packages', 'agent-skills');

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(3, end).trim();
  // Minimal YAML: support `key: value` and folded `key: >-` blocks.
  const out = {};
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val === '>-' || val === '>' || val === '|' || val === '') {
      // Gather indented continuation lines.
      const buf = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+\S/.test(lines[j])) { buf.push(lines[j].trim()); i = j; }
        else if (lines[j].trim() === '') { i = j; }
        else break;
      }
      val = buf.join(' ').trim();
    }
    out[key] = val;
  }
  return out;
}

function main() {
  if (!fs.existsSync(skillsDir)) {
    console.error(`skills dir not found: ${skillsDir}`);
    process.exit(1);
  }
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'));

  let errors = 0;
  let checked = 0;

  for (const dir of entries) {
    const skillFile = path.join(skillsDir, dir.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      console.error(`[FAIL] ${dir.name}: missing SKILL.md`);
      errors++;
      continue;
    }
    checked++;
    const text = fs.readFileSync(skillFile, 'utf-8');
    const fm = parseFrontmatter(text);
    const problems = [];
    if (!fm) {
      problems.push('no valid --- frontmatter ---');
    } else {
      if (!fm.name) problems.push('missing name');
      if (!fm.description) problems.push('missing description');
      if (fm.name && fm.name !== dir.name) problems.push(`name "${fm.name}" != dir "${dir.name}"`);
      if (fm.name && !/^[a-z0-9-]{1,64}$/.test(fm.name)) problems.push(`name not lowercase-kebab/<=64: "${fm.name}"`);
      if (fm.description && fm.description.length > 1024) problems.push(`description too long (${fm.description.length} > 1024)`);
    }
    if (problems.length) {
      console.error(`[FAIL] ${dir.name}: ${problems.join('; ')}`);
      errors++;
    } else {
      console.log(`[OK]   ${dir.name}`);
    }
  }

  console.log(`\nChecked ${checked} skill(s), ${errors} error(s).`);
  process.exit(errors ? 1 : 0);
}

main();
