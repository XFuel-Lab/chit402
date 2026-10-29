import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type RichLink = {
  href: string;
  label: string;
  internal?: boolean;
  blank?: boolean;
  style?: CSSProperties;
};

export type RichPart =
  | string
  | { code: string }
  | { strong: string; style?: CSSProperties }
  | { link: RichLink };

export function RichText({ parts }: { parts: readonly RichPart[] }): ReactNode {
  return parts.map((part, index) => {
    if (typeof part === 'string') return <Fragment key={index}>{part}</Fragment>;
    if ('code' in part) return <code key={index}>{part.code}</code>;
    if ('strong' in part) return <strong key={index} style={part.style}>{part.strong}</strong>;
    const link = part.link;
    if (link.internal) {
      return (
        <Link key={index} to={link.href} style={link.style}>
          {link.label}
        </Link>
      );
    }
    return (
      <a
        key={index}
        href={link.href}
        style={link.style}
        target={link.blank ? '_blank' : undefined}
        rel={link.blank ? 'noreferrer' : undefined}
      >
        {link.label}
      </a>
    );
  });
}
