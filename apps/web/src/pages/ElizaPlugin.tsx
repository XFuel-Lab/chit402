import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { getApiV1 } from '../apiHost';

const installExample = `npm install chit402-elizaos
# canonical: @xfuel/plugin-elizaos`;

const characterExample = `{
  "plugins": ["@xfuel/plugin-elizaos"],
  "settings": {
    "CHIT_API_URL": "https://api.chit402.com",
    "CHIT_API_KEY": "<partner-key-or-omit-for-x402>",
    "CHIT_MAX_USD_PER_CALL": "0.05",
    "CHIT_MAX_USD_SESSION": "1.00"
  }
}`;

export default function ElizaPlugin() {
  const apiV1 = getApiV1();

  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Framework</span>
          <h1>Eliza plugin</h1>
          <p>
            <code>@xfuel/plugin-elizaos</code> routes Eliza <code>TEXT_SMALL</code> /{' '}
            <code>TEXT_LARGE</code> through Chit at <code>{apiV1}</code> with USDC budget caps and
            collected <code>verify_url</code> receipts.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Install</h2>
          <pre className="docs-code">
            <code>{installExample}</code>
          </pre>
          <p style={styles.note}>
            Registers at priority 100 so Chit wins for text generation. Actions:{' '}
            <code>REGISTER_CHIT_AGENT</code>, <code>SHOW_CHIT_BOOK</code>.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Character snippet</h2>
          <pre className="docs-code">
            <code>{characterExample}</code>
          </pre>
        </div>

        <div className="docs-actions">
          <Link to="/docs/chit-in-15-lines" className="btn btn-primary btn-sm">
            Drop-in door
          </Link>
          <Link to="/docs/framework-adapters" className="btn btn-secondary btn-sm">
            LangChain + AI SDK
          </Link>
          <a
            href="https://github.com/XFuel-Lab/chit402/tree/main/packages/plugin-elizaos"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm"
          >
            Source
          </a>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  note: { marginTop: '0.75rem', fontSize: '0.9rem', opacity: 0.85 },
};
