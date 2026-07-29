/** Job boards / aggregators blocked in v1 (copilot targets company ATS only). */

const BLOCKED_HOST_SUFFIXES = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'monster.com',
  'simplyhired.com',
  'dice.com',
  'wellfound.com',
  'angel.co',
] as const;

export function isBlockedApplyHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return BLOCKED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
  } catch {
    return true;
  }
}

export function blockedApplyMessage(url: string): string {
  return (
    `Apply URL is not supported in v1 (job boards like LinkedIn/Indeed are out of scope): ${url}. ` +
    `Use a company Greenhouse, Lever, or Ashby careers apply link.`
  );
}
