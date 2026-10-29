import { Link } from 'react-router-dom';
import { getApiHost, getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';
import { DocSection } from './docsShared';
import { RichText } from '../content/RichText';
import {
  auditors,
  builders,
  docsKicker,
  h1For,
  introParts,
  navLinks,
  operatorsFor,
  probeBody,
  probeFoot,
  probeLead,
  probeLinks,
  sdkLabel,
  sdkSnippet,
  openrouterKeepRouteParagraphs,
  openrouterKeepRouteTitle,
  sectionTitles,
  snippetFor,
  startHere,
  whatsNew,
} from '../content/docsContent.mjs';

export default function Docs() {
  const config = getHostConfig();
  const productName = config.name;
  const apiHost = getApiHost();
  const apiV1 = getApiV1();
  const apiDomain = config.apiDomain;
  const operators = operatorsFor(apiDomain);
  const snippet = snippetFor(apiV1);
  const news = whatsNew(apiHost);
  const links = navLinks(apiHost);

  return (
    <div className="page docs-page">
      <div className="container">
        <header className="page-header">
          <span className="docs-kicker">{docsKicker}</span>
          <h1>{h1For(productName)}</h1>
          <p>
            <RichText parts={introParts(apiDomain)} />
          </p>
        </header>

        <nav className="docs-rail" aria-label="Quick links">
          {links.map((link) => (
            link.internal ? (
              <Link key={link.href} to={link.href}>{link.label}</Link>
            ) : (
              <a key={link.href} href={link.href} target={link.blank ? '_blank' : undefined} rel={link.blank ? 'noreferrer' : undefined}>
                {link.label}
              </a>
            )
          ))}
        </nav>

        <div className="docs-panel">
          <h2>{openrouterKeepRouteTitle}</h2>
          {openrouterKeepRouteParagraphs().map((parts, index) => (
            <p key={index}>
              <RichText parts={parts} />
            </p>
          ))}
        </div>

        <DocSection title={sectionTitles.start} items={startHere} />

        <div className="docs-panel">
          <h2>{sectionTitles.news}</h2>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 1.7, paddingLeft: '1.2rem' }}>
            {news.map((parts, index) => (
              <li key={index}>
                <RichText parts={parts} />
              </li>
            ))}
          </ul>
        </div>
        <DocSection title={sectionTitles.builders} items={builders} />
        <DocSection title={sectionTitles.operators} items={operators} />
        <DocSection title={sectionTitles.auditors} items={auditors} />

        <div className="docs-panel">
          <h2>{sectionTitles.probe}</h2>
          <p>
            <RichText parts={probeLead()} />
          </p>
          <p>
            <RichText parts={probeBody()} />
          </p>
          <pre className="docs-code">
            <code>{snippet}</code>
          </pre>
          <p style={{ marginTop: '0.75rem' }}>{sdkLabel}</p>
          <pre className="docs-code">
            <code>{sdkSnippet}</code>
          </pre>
          <p style={{ marginTop: '0.75rem', fontSize: '0.9rem', opacity: 0.85 }}>
            <RichText parts={probeFoot()} />
          </p>
          <div className="docs-actions">
            {probeLinks().map((link) => (
              link.internal ? (
                <Link key={link.href} to={link.href} className={link.className}>
                  {link.label}
                </Link>
              ) : (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className={link.className}
                >
                  {link.label}
                </a>
              )
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
