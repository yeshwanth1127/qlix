import { detectAts, type AtsKind } from './atsDetect.js';

export interface AtsJobListing {
  company: string;
  title: string;
  location: string | null;
  applyUrl: string;
  ats: AtsKind;
  externalJobId: string | null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function searchGreenhouseBoard(
  boardToken: string,
  query?: string,
): Promise<AtsJobListing[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Greenhouse board "${boardToken}" failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    jobs?: Array<{
      id: number;
      title: string;
      absolute_url?: string;
      location?: { name?: string };
      content?: string;
    }>;
  };
  const q = query?.trim().toLowerCase();
  const jobs = data.jobs ?? [];
  return jobs
    .filter((j) => {
      if (!q) return true;
      const hay = `${j.title} ${j.location?.name ?? ''} ${stripHtml(j.content ?? '')}`.toLowerCase();
      return hay.includes(q);
    })
    .map((j) => ({
      company: boardToken,
      title: j.title,
      location: j.location?.name ?? null,
      applyUrl: j.absolute_url || `https://boards.greenhouse.io/${boardToken}/jobs/${j.id}`,
      ats: 'greenhouse' as const,
      externalJobId: String(j.id),
    }));
}

export async function searchLeverBoard(company: string, query?: string): Promise<AtsJobListing[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Lever board "${company}" failed: HTTP ${res.status}`);
  const jobs = (await res.json()) as Array<{
    id: string;
    text: string;
    hostedUrl?: string;
    applyUrl?: string;
    categories?: { location?: string };
    descriptionPlain?: string;
  }>;
  const q = query?.trim().toLowerCase();
  return (Array.isArray(jobs) ? jobs : [])
    .filter((j) => {
      if (!q) return true;
      const hay = `${j.text} ${j.categories?.location ?? ''} ${j.descriptionPlain ?? ''}`.toLowerCase();
      return hay.includes(q);
    })
    .map((j) => ({
      company,
      title: j.text,
      location: j.categories?.location ?? null,
      applyUrl: j.applyUrl || j.hostedUrl || `https://jobs.lever.co/${company}/${j.id}`,
      ats: 'lever' as const,
      externalJobId: j.id,
    }));
}

export async function searchAshbyBoard(board: string, query?: string): Promise<AtsJobListing[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Ashby board "${board}" failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    jobs?: Array<{
      id: string;
      title: string;
      location?: string;
      jobUrl?: string;
      isListed?: boolean;
      descriptionHtml?: string;
    }>;
  };
  const q = query?.trim().toLowerCase();
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .filter((j) => {
      if (!q) return true;
      const hay = `${j.title} ${j.location ?? ''} ${stripHtml(j.descriptionHtml ?? '')}`.toLowerCase();
      return hay.includes(q);
    })
    .map((j) => ({
      company: board,
      title: j.title,
      location: j.location ?? null,
      applyUrl: j.jobUrl || `https://jobs.ashbyhq.com/${board}/${j.id}`,
      ats: 'ashby' as const,
      externalJobId: j.id,
    }));
}

export async function searchAtsBoard(params: {
  ats: AtsKind;
  board: string;
  query?: string;
}): Promise<AtsJobListing[]> {
  if (params.ats === 'greenhouse') return searchGreenhouseBoard(params.board, params.query);
  if (params.ats === 'lever') return searchLeverBoard(params.board, params.query);
  if (params.ats === 'ashby') return searchAshbyBoard(params.board, params.query);
  throw new Error(`Unsupported ATS: ${params.ats}`);
}

export function listingFromApplyUrl(applyUrl: string, overrides?: Partial<AtsJobListing>): AtsJobListing {
  const ats = detectAts(applyUrl);
  let company = 'unknown';
  try {
    const parts = new URL(applyUrl).pathname.split('/').filter(Boolean);
    company = parts[0] || company;
  } catch {
    /* ignore */
  }
  return {
    company: overrides?.company ?? company,
    title: overrides?.title ?? 'Application',
    location: overrides?.location ?? null,
    applyUrl,
    ats,
    externalJobId: overrides?.externalJobId ?? null,
  };
}
