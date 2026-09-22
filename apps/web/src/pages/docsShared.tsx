import { Link } from 'react-router-dom';

export type DocLink = {
  title: string;
  description: string;
  href: string;
  meta: string;
  external?: boolean;
  internal?: boolean;
};

export function DocDoorGrid({ items }: { items: DocLink[] }) {
  return (
    <div className="docs-door-grid">
      {items.map((item) =>
        item.internal ? (
          <Link key={item.title} to={item.href} className="docs-door-card">
            <div className="docs-door-card-title">{item.title}</div>
            <p className="docs-door-card-desc">{item.description}</p>
            <span className="docs-door-card-meta">{item.meta}</span>
          </Link>
        ) : (
          <a
            key={item.title}
            href={item.href}
            className="docs-door-card"
            target={item.external ? '_blank' : undefined}
            rel={item.external ? 'noreferrer' : undefined}
          >
            <div className="docs-door-card-title">{item.title}</div>
            <p className="docs-door-card-desc">{item.description}</p>
            <span className="docs-door-card-meta">{item.meta}</span>
          </a>
        ),
      )}
    </div>
  );
}

export function DocSection({ title, items }: { title: string; items: DocLink[] }) {
  return (
    <section className="docs-section">
      <h2 className="docs-section-title">{title}</h2>
      <div className="docs-list">
        {items.map((item) =>
          item.internal ? (
            <Link key={item.title} to={item.href} className="docs-row">
              <div>
                <div className="docs-row-title">{item.title}</div>
                <p className="docs-row-desc">{item.description}</p>
              </div>
              <span className="docs-row-meta">{item.meta}</span>
            </Link>
          ) : (
            <a
              key={item.title}
              href={item.href}
              className="docs-row"
              target={item.external ? '_blank' : undefined}
              rel={item.external ? 'noreferrer' : undefined}
            >
              <div>
                <div className="docs-row-title">{item.title}</div>
                <p className="docs-row-desc">{item.description}</p>
              </div>
              <span className="docs-row-meta">{item.meta}</span>
            </a>
          ),
        )}
      </div>
    </section>
  );
}
