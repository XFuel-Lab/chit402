import { useEffect } from 'react';
import { getHostConfig } from '../hostConfig';

interface SeoHeadProps {
  title?: string;
  description?: string;
}

export default function SeoHead({ title, description }: SeoHeadProps) {
  const config = getHostConfig();
  const finalTitle = title ?? config.seo.title;
  const finalDescription = description ?? config.seo.description;

  useEffect(() => {
    document.title = finalTitle;

    const setMeta = (selector: string, content: string) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute('content', content);
    };

    setMeta('meta[name="description"]', finalDescription);
    setMeta('meta[property="og:title"]', title ?? config.seo.ogTitle);
    setMeta('meta[property="og:description"]', description ?? config.seo.ogDescription);
    setMeta('meta[property="og:image"]', config.ogImage);
    setMeta('meta[name="twitter:title"]', title ?? config.seo.ogTitle);
    setMeta('meta[name="twitter:description"]', description ?? config.seo.ogDescription);

    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      canonical.setAttribute('href', `https://${config.domain}${window.location.pathname}`);
    } else {
      const link = document.createElement('link');
      link.rel = 'canonical';
      link.href = `https://${config.domain}${window.location.pathname}`;
      document.head.appendChild(link);
    }
  }, [finalTitle, finalDescription, config, title, description]);

  return null;
}
