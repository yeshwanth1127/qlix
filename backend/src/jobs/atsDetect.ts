export type AtsKind = 'greenhouse' | 'lever' | 'ashby' | 'unknown';

export function detectAts(url: string): AtsKind {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes('greenhouse.io') || host.includes('boards.greenhouse')) return 'greenhouse';
    if (host.includes('lever.co') || host.includes('jobs.lever')) return 'lever';
    if (host.includes('ashbyhq.com') || host.includes('jobs.ashby')) return 'ashby';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Parse board token from common ATS apply / board URLs. */
export function parseAtsBoard(url: string): { ats: AtsKind; board: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);

    if (host.includes('greenhouse.io')) {
      // boards.greenhouse.io/{token}/jobs/...
      const board = parts[0];
      if (board) return { ats: 'greenhouse', board };
    }
    if (host.includes('lever.co')) {
      // jobs.lever.co/{company}/...
      const board = parts[0];
      if (board) return { ats: 'lever', board };
    }
    if (host.includes('ashbyhq.com')) {
      // jobs.ashbyhq.com/{board}/...
      const board = parts[0];
      if (board) return { ats: 'ashby', board };
    }
    return null;
  } catch {
    return null;
  }
}
