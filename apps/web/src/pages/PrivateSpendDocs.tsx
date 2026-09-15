import { Link } from 'react-router-dom';
import PrivateSpendCallout from '../components/PrivateSpendCallout';

export default function PrivateSpendDocs() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Product</span>
          <h1>Private Spend</h1>
          <p>
            Vendor-blind fulfillment for registered principals. Spend without briefing the frontier lab
            on your buyer topology — gateway-trusted, not prompt encryption.
          </p>
        </header>

        <PrivateSpendCallout />

        <div className="docs-panel">
          <h2>When it is on</h2>
          <p>
            Default for possession sessions: pass <code>X-XFuel-Session</code> (from{' '}
            <code>POST /v1/agents/register</code>) on <code>POST /v1/chat/completions</code> or book
            APIs. Demo keys never qualify.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Receipt signal</h2>
          <p>
            Collected receipts may include <code>privacy.mode: vendor_blind</code> and notes that
            clarify this is settlement / topology privacy — not encrypted prompts.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Content privacy</h2>
          <p>
            For prompt confidentiality, request a confidential / TEE-class provider tier when
            configured. Private Spend and content TEE are separate controls.
          </p>
        </div>

        <nav className="docs-actions">
          <Link to="/book" className="btn btn-primary btn-sm">Principal book →</Link>
          <Link to="/register" className="btn btn-secondary btn-sm">Register</Link>
          <Link to="/docs" className="btn btn-secondary btn-sm">Docs hub</Link>
        </nav>
      </div>
    </div>
  );
}
