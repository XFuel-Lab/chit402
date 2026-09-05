import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';

export default function ElizaPlugin() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Framework</span>
          <h1>Eliza plugin</h1>
          <p>
            Coming soon: <code>@xfuel/plugin-elizaos</code> — route Eliza agent LLM spend through
            Chit402 with USDC budget and collected <code>verify_url</code> receipts.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Status</h2>
          <p>
            The Eliza plugin is in a separate PR. Until it lands, point your agent at the wire
            directly or use the SDK.
          </p>
          <div className="docs-actions">
            <Link to="/docs/chit-in-15-lines" className="btn btn-primary btn-sm">
              Chit in 15 lines
            </Link>
            <a
              href="https://github.com/XFuel-Lab/chit402"
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
            >
              GitHub
            </a>
            <Link to="/" className="btn btn-secondary btn-sm">
              Home
            </Link>
          </div>
        </div>

        <p style={styles.footer}>
          Package path will be <code>packages/plugin-elizaos</code> when shipped.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  footer: {
    textAlign: 'center',
    color: '#8a8a9a',
    fontSize: '0.9rem',
    marginTop: '2rem',
  },
};
