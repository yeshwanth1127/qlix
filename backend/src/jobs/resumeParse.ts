/** Lightweight heuristic parse of resume plain text into profile fields. */

export interface ParsedResumeFields {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  skills: string[];
  summary: string | null;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/;
const LINKEDIN_RE = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s)]+/i;
const GITHUB_RE = /https?:\/\/(?:www\.)?github\.com\/[^\s)/]+/i;
const URL_RE = /https?:\/\/[^\s)]+/gi;

const SKILL_HINTS = [
  'python',
  'typescript',
  'javascript',
  'react',
  'node',
  'java',
  'go',
  'rust',
  'aws',
  'kubernetes',
  'docker',
  'sql',
  'postgres',
  'mongodb',
  'graphql',
  'next.js',
  'fastapi',
  'django',
  'machine learning',
  'llm',
];

export function parseResumeText(text: string): ParsedResumeFields {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const email = text.match(EMAIL_RE)?.[0] ?? null;
  const phoneMatch = text.match(PHONE_RE);
  const phone = phoneMatch && phoneMatch[0].replace(/\D/g, '').length >= 10 ? phoneMatch[0] : null;
  const linkedinUrl = text.match(LINKEDIN_RE)?.[0] ?? null;
  const githubUrl = text.match(GITHUB_RE)?.[0] ?? null;

  let portfolioUrl: string | null = null;
  const urls = text.match(URL_RE) ?? [];
  for (const u of urls) {
    const lower = u.toLowerCase();
    if (lower.includes('linkedin.com') || lower.includes('github.com')) continue;
    portfolioUrl = u;
    break;
  }

  let fullName: string | null = null;
  for (const line of lines.slice(0, 8)) {
    if (EMAIL_RE.test(line) || PHONE_RE.test(line) || /^https?:/i.test(line)) continue;
    if (line.length < 3 || line.length > 60) continue;
    if (/^(resume|curriculum|cv|experience|education|skills)/i.test(line)) continue;
    if (/^[A-Za-z][A-Za-z .'-]+$/.test(line) && line.split(/\s+/).length <= 5) {
      fullName = line;
      break;
    }
  }

  const lower = text.toLowerCase();
  const skills = SKILL_HINTS.filter((s) => lower.includes(s));

  const summary =
    lines
      .slice(0, 12)
      .filter((l) => l.length > 40 && !EMAIL_RE.test(l))
      .slice(0, 2)
      .join(' ')
      .slice(0, 500) || null;

  return { fullName, email, phone, linkedinUrl, githubUrl, portfolioUrl, skills, summary };
}
