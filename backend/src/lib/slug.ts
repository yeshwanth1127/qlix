import { randomBytes } from 'node:crypto';

/** URL-safe slug from display text; falls back to `workspace`. */
export function slugifyBase(text: string): string {
  const cleaned = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : 'workspace';
}

/** Ensures a unique organization slug by appending short random suffixes. */
export async function allocateOrganizationSlug(
  exists: (slug: string) => Promise<boolean>,
  baseLabel: string,
): Promise<string> {
  let base = slugifyBase(baseLabel);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`;
    const taken = await exists(slug);
    if (!taken) {
      return slug;
    }
  }
  throw new Error('Unable to allocate unique organization slug');
}
