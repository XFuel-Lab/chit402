export const HOME_SNIPPET_API: string;
export const HOME_H1: string;
export const HOME_TITLE: string;
export const dropInSnippet: string;
export const partnerKeySnippet: string;

export type HomeLink = { href: string; label: string; internal?: boolean };

export const homeContent: {
  h1: string;
  subhead: string;
  pricingHref: string;
  pricingLabel: string;
  bookHref: string;
  bookLabel: string;
  verifyLabel: string;
  dropInDocsHref: string;
  dropInDocsLabel: string;
  checkYourself: string;
  checkLinks: HomeLink[];
  ninetyTitle: string;
  payPerCall: string;
  partnerKey: string;
  alsoWorksTitle: string;
  alsoWorksBody: string;
  adapters: HomeLink[];
  rowTitle: string;
  cards: { heading: string; body: string }[];
  doorsHref: string;
  doorsLabel: string;
  publicVerifyLabel: string;
  footerLinks: HomeLink[];
  githubLabel: string;
};

export function ninetyLead(verifyUrl: string): ReadonlyArray<
  | string
  | { link: { href: string; label: string; internal?: boolean; blank?: boolean } }
>;
