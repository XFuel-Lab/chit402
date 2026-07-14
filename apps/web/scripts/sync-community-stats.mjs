/**
 * Refresh public/community-content.json with live GitHub stars + Discord invite member count.
 * Run from repo root: npm run sync:community --prefix xfuel-app
 * Or: cd xfuel-app && node scripts/sync-community-stats.mjs
 *
 * Discord + GitHub are fetched server-side (no browser CORS issues).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.join(__dirname, '..', 'public', 'community-content.json');

async function main() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (e) {
    console.error('Read failed:', jsonPath, e.message);
    process.exit(1);
  }

  const gh = data.github || { org: 'XFuel-Lab', repo: 'xfuel-protocol' };
  const org = gh.org || 'XFuel-Lab';
  const repo = gh.repo || 'xfuel-protocol';

  try {
    const r = await fetch(`https://api.github.com/repos/${org}/${repo}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'xfuel-community-sync' },
    });
    if (r.ok) {
      const j = await r.json();
      const n = j.stargazers_count;
      const label = typeof n === 'number' ? `${n.toLocaleString()} stars` : '—';
      const ghLink = data.socialLinks?.find((s) => s.kind === 'github');
      if (ghLink) ghLink.statLabel = label;
      console.log('GitHub stars:', label);
    } else {
      const body = await r.text();
      console.warn('GitHub API:', r.status, body.slice(0, 200));
    }
  } catch (e) {
    console.warn('GitHub fetch failed:', e.message);
  }

  const code = (data.discordInviteCode || '').trim();
  if (!code) {
    console.log('Discord: skipped (set discordInviteCode in community-content.json to the slug after discord.gg/)');
  } else try {
    const r = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`, {
      headers: { 'User-Agent': 'xfuel-community-sync' },
    });
    if (r.ok) {
      const j = await r.json();
      const n = j.approximate_member_count;
      const label = typeof n === 'number' ? `${n.toLocaleString()}+ members` : '—';
      const disc = data.socialLinks?.find((s) => s.platform === 'Discord');
      if (disc) disc.statLabel = label;
      console.log('Discord (invite):', label);
    } else {
      console.warn('Discord API:', r.status);
    }
  } catch (e) {
    console.warn('Discord fetch failed:', e.message);
  }

  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n');
  console.log('Wrote', jsonPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
