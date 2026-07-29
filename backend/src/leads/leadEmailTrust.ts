/**
 * Trust rules for lead emails — GMB rarely lists emails; mock scraper data must not outreach.
 */
import type { BulkLeadInput } from './leads.types.js';

const PLACEHOLDER_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'localhost',
  'email.com',
  'domain.com',
  'yoursite.com',
  'mysite.com',
  'wixsite.com',
  'wixstudio.com',
  'godaddysites.com',
  'squarespace.com',
  'wordpress.com',
  'sentry.io',
];

export type LeadEmailSource = 'none' | 'mock' | 'website' | 'gmb' | 'browser_enrich';

/** Extract normalized hostname from a website URL or bare domain. */
export function hostnameFromWebsite(website: string | null | undefined): string | null {
  if (!website?.trim()) return null;
  try {
    const url = /^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`;
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when the email domain matches (or is a subdomain of) the lead website hostname. */
export function emailDomainMatchesWebsite(
  email: string,
  website: string | null | undefined,
): boolean {
  const host = hostnameFromWebsite(website);
  if (!host) return false;
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 1) return false;
  const emailHost = email
    .slice(at + 1)
    .toLowerCase()
    .replace(/^www\./, '');
  return emailHost === host || emailHost.endsWith(`.${host}`);
}

/**
 * Domains that look auto-generated / hallucinated: a bare word immediately
 * followed by digits, e.g. `cafe1.com`, `business2.net`, `restaurant3.co`.
 * Real businesses effectively never use these; LLMs invent them constantly when
 * they skip a real lead lookup. Kept deliberately narrow to avoid false positives
 * (e.g. `web3.io`, `formula1.com` are allowed because the word part is long enough
 * OR is a real brand — here we only flag short generic words + a trailing number).
 */
const FABRICATED_DOMAIN_RE = /^(cafe|business|company|shop|store|restaurant|hotel|firm|vendor|client|customer|lead|example|sample|test|acme|demo|placeholder|yourcompany|mybusiness)\d*\.[a-z.]{2,}$/;

export function isPlaceholderEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return true;
  const domain = e.slice(at + 1);
  if (PLACEHOLDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  if (FABRICATED_DOMAIN_RE.test(domain)) return true;
  return false;
}

/**
 * True when a batch of recipients shows a fabricated sequential pattern, e.g.
 * `info@cafe1.com`, `info@cafe2.com`, `info@cafe3.com`. This is the classic
 * signature of an agent inventing recipients instead of using real lead data.
 */
export function isFabricatedRecipientBatch(recipients: string[]): boolean {
  const domains = recipients
    .map((r) => r.trim().toLowerCase().split('@')[1])
    .filter((d): d is string => Boolean(d));
  if (domains.length < 2) return false;

  // Strip trailing digits from each domain's first label and see if the
  // non-numeric stems collapse to a single value with distinct numbers.
  const stems = new Set<string>();
  const numbers = new Set<string>();
  let numbered = 0;
  for (const domain of domains) {
    const label = domain.split('.')[0] ?? '';
    const m = /^([a-z]+?)(\d+)$/.exec(label);
    if (m) {
      numbered += 1;
      stems.add(m[1]);
      numbers.add(m[2]);
    }
  }
  return numbered >= 2 && stems.size === 1 && numbers.size >= 2;
}

export function isTrustworthyLeadEmail(
  email: string | null | undefined,
  raw?: Record<string, unknown> | null,
  website?: string | null,
): boolean {
  if (!email?.trim()) return false;
  if (isPlaceholderEmail(email)) return false;
  const source = raw?.source;
  if (source === 'mock') return false;
  const emailSource = raw?.emailSource as LeadEmailSource | undefined;
  if (emailSource === 'mock' || emailSource === 'none') return false;
  const site =
    website ?? (typeof raw?.website === 'string' ? raw.website : null);
  // Website-sourced emails must match the business domain (blocks Wix mysite.com etc.).
  if (site && !emailDomainMatchesWebsite(email, site)) return false;
  return true;
}

/** Normalize scraped lead rows before persistence. Strips mock/placeholder emails. */
export function sanitizeBulkLead(lead: BulkLeadInput): BulkLeadInput {
  const raw: Record<string, unknown> = { ...(lead.raw ?? {}) };
  let email = lead.email?.trim() || null;

  if (raw.source === 'mock') {
    email = null;
    raw.emailSource = 'mock';
  } else if (email) {
    if (isPlaceholderEmail(email)) {
      email = null;
      raw.emailSource = 'none';
    } else if (lead.website && !emailDomainMatchesWebsite(email, lead.website)) {
      email = null;
      raw.emailSource = 'none';
    } else if (!raw.emailSource) {
      raw.emailSource = raw.source === 'playwright' ? 'gmb' : 'website';
    }
  } else {
    raw.emailSource = raw.emailSource ?? 'none';
  }

  return { ...lead, email, raw };
}

export function sanitizeBulkLeads(leads: BulkLeadInput[]): BulkLeadInput[] {
  return leads.map(sanitizeBulkLead);
}
