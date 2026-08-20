import { Link } from 'react-router-dom';
import { API_V1 } from '../apiHost';

export default function NotFound() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 640, textAlign: 'center' }}>
        <header className="page-header" style={{ maxWidth: 'none', marginLeft: 'auto', marginRight: 'auto' }}>
          <span className="docs-kicker">404</span>
          <h1>No page here</h1>
          <p>
            You are on the public site, not the API. Start at the homepage, or call{' '}
            <code>{API_V1}</code> for completions.
          </p>
        </header>
        <p>
          <Link to="/" className="btn btn-primary">Home</Link>
          {' '}
          <Link to="/docs" className="btn btn-secondary">Docs</Link>
          {' '}
          <Link to="/v1" className="btn btn-secondary">Where is /v1?</Link>
        </p>
      </div>
    </div>
  );
}
