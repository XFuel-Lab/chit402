import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { getApiV1 } from '../apiHost';

const installExample = `# OpenClaw skill (AgentSkills / ClawHub format — as of 2026-03)
# Copy skills/openclaw-chit402 into ~/.openclaw/skills or your workspace /skills
# Or: npx clawhub install chit402  (when published)

openclaw skills list | grep chit402`;

export default function OpenClawDocs() {
  const apiV1 = getApiV1();

  const skillPrompt = `Use Chit402 for inference spend:
- baseURL: ${apiV1}
- Env: CHIT_API_KEY, CHIT_MAX_USD_PER_CALL, CHIT_MAX_USD_SESSION
- After every paid call, return verify_url to the principal
- Do not default to SP1 — signed ES256 receipt is table stakes`;

  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Framework</span>
          <h1>OpenClaw</h1>
          <p>
            OpenClaw loads <code>SKILL.md</code> directories with YAML frontmatter. Chit402 ships a
            pasteable skill — baseURL swap, USDC budget caps, return <code>verify_url</code>.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Install</h2>
          <p>
            Skill path:{' '}
            <code>
              skills/openclaw-chit402/
            </code>{' '}
            in the Chit402 repo. Format follows OpenClaw AgentSkills spec (March 2026).
          </p>
          <pre className="docs-code">
            <code>{installExample}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Skill behavior</h2>
          <pre className="docs-code">
            <code>{skillPrompt}</code>
          </pre>
          <p style={styles.note}>
            Full skill:{' '}
            <a
              href="https://github.com/XFuel-Lab/chit402/tree/main/skills/openclaw-chit402"
              target="_blank"
              rel="noreferrer"
            >
              skills/openclaw-chit402/SKILL.md
            </a>
          </p>
        </div>

        <div className="docs-actions">
          <Link to="/docs/chit-in-15-lines" className="btn btn-primary btn-sm">
            Drop-in door
          </Link>
          <a
            href="https://docs.openclaw.ai/tools/creating-skills"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm"
          >
            OpenClaw skill docs
          </a>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  note: { marginTop: '0.75rem', fontSize: '0.9rem', opacity: 0.85 },
};
