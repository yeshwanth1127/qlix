/**
 * Reject placeholder / fabricated recipient addresses for email send.
 * Used by email tools regardless of product vertical.
 */

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

/**
 * Domains that look auto-generated / hallucinated: a bare word immediately
 * followed by digits, e.g. `cafe1.com`, `business2.net`, `restaurant3.co`.
 */
const FABRICATED_DOMAIN_RE =
  /^(cafe|business|company|shop|store|restaurant|hotel|firm|vendor|client|customer|lead|example|sample|test|acme|demo|placeholder|yourcompany|mybusiness)\d*\.[a-z.]{2,}$/;

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
 * `info@cafe1.com`, `info@cafe2.com`, `info@cafe3.com`.
 */
export function isFabricatedRecipientBatch(recipients: string[]): boolean {
  const domains = recipients
    .map((r) => r.trim().toLowerCase().split('@')[1])
    .filter((d): d is string => Boolean(d));
  if (domains.length < 2) return false;

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
