import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';

export type SeedEvidenceKind =
  | 'file_snapshot'
  | 'git_event'
  | 'terminal_event'
  | 'dependency_event'
  | 'test_result'
  | 'build_result'
  | 'lint_result'
  | 'manual_note';

export interface SeedEvidenceEvent {
  kind: SeedEvidenceKind;
  occurredAt: Date;
  payload: Record<string, unknown>;
  redacted?: boolean;
}

function sha(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function at(day: string, time: string): Date {
  return new Date(`${day}T${time}+05:30`);
}

const FILES_START: Array<{ path: string; sizeBytes: number }> = [
  { path: 'README.md', sizeBytes: 420 },
  { path: 'package.json', sizeBytes: 380 },
];

const FILES_SUBMIT: Array<{ path: string; sizeBytes: number }> = [
  { path: 'README.md', sizeBytes: 2400 },
  { path: 'package.json', sizeBytes: 920 },
  { path: 'apps/web/package.json', sizeBytes: 640 },
  { path: 'apps/web/app/page.tsx', sizeBytes: 1800 },
  { path: 'apps/web/app/listings/page.tsx', sizeBytes: 2600 },
  { path: 'apps/web/app/listings/[id]/page.tsx', sizeBytes: 2100 },
  { path: 'apps/web/app/login/page.tsx', sizeBytes: 1200 },
  { path: 'apps/web/lib/api.ts', sizeBytes: 980 },
  { path: 'apps/api/package.json', sizeBytes: 580 },
  { path: 'apps/api/src/index.ts', sizeBytes: 900 },
  { path: 'apps/api/src/routes/auth.ts', sizeBytes: 2400 },
  { path: 'apps/api/src/routes/listings.ts', sizeBytes: 4100 },
  { path: 'apps/api/src/routes/orders.ts', sizeBytes: 3200 },
  { path: 'apps/api/prisma/schema.prisma', sizeBytes: 1600 },
  { path: 'apps/api/.env.example', sizeBytes: 220 },
  { path: 'apps/api/src/lib/db.ts', sizeBytes: 400 },
  { path: 'apps/api/src/__tests__/listings.test.ts', sizeBytes: 1900 },
];

function fileHashes(files: Array<{ path: string; sizeBytes: number }>) {
  return files.map((f) => ({
    path: f.path,
    sha256: sha(`${f.path}:${f.sizeBytes}`),
    sizeBytes: f.sizeBytes,
  }));
}

/** Raw VS Code-style observations for a 4-day Campus Market full-stack build. */
export function campusMarketObservationLog(): {
  evidence: SeedEvidenceEvent[];
  snapshots: Array<{
    label: string;
    fileTreeHash: string;
    fileHashes: ReturnType<typeof fileHashes>;
    createdAt: Date;
  }>;
} {
  const startFiles = fileHashes(FILES_START);
  const submitFiles = fileHashes(FILES_SUBMIT);

  const evidence: SeedEvidenceEvent[] = [
    {
      kind: 'manual_note',
      occurredAt: at('2026-08-11', '09:02:00'),
      payload: { text: 'Session started. Workspace /Users/priya/campus-market bound.' },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-11', '09:15:00'),
      payload: { path: 'README.md', changeType: 'created', lineCount: 12, sizeBytes: 420 },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-11', '09:18:00'),
      payload: {
        path: 'package.json',
        changeType: 'created',
        lineCount: 18,
        sizeBytes: 380,
        isDependencyManifest: true,
      },
    },
    {
      kind: 'terminal_event',
      occurredAt: at('2026-08-11', '09:20:00'),
      payload: { command: 'npm init -y', exitCode: 0, success: true },
    },
    {
      kind: 'dependency_event',
      occurredAt: at('2026-08-11', '09:28:00'),
      payload: {
        manager: 'npm',
        command: 'npm install express prisma @prisma/client jsonwebtoken bcrypt',
        exitCode: 0,
      },
    },
    {
      kind: 'terminal_event',
      occurredAt: at('2026-08-11', '09:28:00'),
      payload: {
        command: 'npm install express prisma @prisma/client jsonwebtoken bcrypt',
        exitCode: 0,
        success: true,
      },
    },
    {
      kind: 'dependency_event',
      occurredAt: at('2026-08-11', '09:36:00'),
      payload: {
        manager: 'npm',
        command: 'npx create-next-app@latest apps/web --typescript --app --yes',
        exitCode: 0,
      },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-11', '10:05:00'),
      payload: {
        path: 'apps/api/prisma/schema.prisma',
        changeType: 'created',
        lineCount: 48,
        sizeBytes: 1100,
      },
    },
    {
      kind: 'git_event',
      occurredAt: at('2026-08-11', '10:12:00'),
      payload: {
        hash: 'a1b2c3d4e5f6789012345678901234567890aaa1',
        subject: 'chore: scaffold monorepo with Next app and Prisma schema',
        authorName: 'Priya R',
      },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-11', '14:40:00'),
      payload: {
        path: 'apps/api/src/routes/auth.ts',
        changeType: 'created',
        lineCount: 86,
        sizeBytes: 2400,
      },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-11', '15:10:00'),
      payload: {
        path: 'apps/api/.env',
        changeType: 'created',
        pathSensitive: true,
        sensitive: true,
      },
      redacted: true,
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-11', '15:12:00'),
      payload: {
        path: 'apps/api/.env.example',
        changeType: 'created',
        lineCount: 6,
        sizeBytes: 220,
      },
    },
    {
      kind: 'git_event',
      occurredAt: at('2026-08-11', '16:02:00'),
      payload: {
        hash: 'b2c3d4e5f6789012345678901234567890bbb2',
        subject: 'feat: email/password auth with JWT',
        authorName: 'Priya R',
      },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-12', '10:20:00'),
      payload: {
        path: 'apps/api/src/routes/listings.ts',
        changeType: 'created',
        lineCount: 140,
        sizeBytes: 3800,
      },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-12', '11:05:00'),
      payload: {
        path: 'apps/web/app/listings/page.tsx',
        changeType: 'created',
        lineCount: 92,
        sizeBytes: 2600,
      },
    },
    {
      kind: 'terminal_event',
      occurredAt: at('2026-08-12', '11:30:00'),
      payload: { command: 'npx prisma migrate dev --name listings', exitCode: 0, success: true },
    },
    {
      kind: 'git_event',
      occurredAt: at('2026-08-12', '12:15:00'),
      payload: {
        hash: 'c3d4e5f6789012345678901234567890ccc3',
        subject: 'feat: textbook listings CRUD and listings page',
        authorName: 'Priya R',
      },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-12', '16:40:00'),
      payload: {
        path: 'apps/api/src/routes/orders.ts',
        changeType: 'created',
        lineCount: 110,
        sizeBytes: 3200,
      },
    },
    {
      kind: 'git_event',
      occurredAt: at('2026-08-12', '17:55:00'),
      payload: {
        hash: 'd4e5f6789012345678901234567890dddd4',
        subject: 'feat: checkout flow and order records',
        authorName: 'Priya R',
      },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-13', '09:50:00'),
      payload: {
        path: 'apps/api/src/__tests__/listings.test.ts',
        changeType: 'created',
        lineCount: 64,
        sizeBytes: 1900,
      },
    },
    {
      kind: 'test_result',
      occurredAt: at('2026-08-13', '10:02:00'),
      payload: {
        command: 'npm test -w apps/api',
        exitCode: 1,
        success: false,
        durationMs: 4200,
      },
    },
    {
      kind: 'terminal_event',
      occurredAt: at('2026-08-13', '10:02:00'),
      payload: { command: 'npm test -w apps/api', exitCode: 1, success: false },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-13', '10:25:00'),
      payload: {
        path: 'apps/api/src/routes/listings.ts',
        changeType: 'saved',
        lineCount: 148,
        sizeBytes: 4100,
      },
    },
    {
      kind: 'test_result',
      occurredAt: at('2026-08-13', '10:28:00'),
      payload: {
        command: 'npm test -w apps/api',
        exitCode: 0,
        success: true,
        durationMs: 3100,
      },
    },
    {
      kind: 'lint_result',
      occurredAt: at('2026-08-13', '10:40:00'),
      payload: { command: 'npm run lint', exitCode: 0, success: true, durationMs: 1800 },
    },
    {
      kind: 'git_event',
      occurredAt: at('2026-08-13', '11:05:00'),
      payload: {
        hash: 'e5f6789012345678901234567890eeeee5',
        subject: 'test: listings route tests; fix pagination off-by-one',
        authorName: 'Priya R',
      },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-13', '15:20:00'),
      payload: {
        path: 'apps/web/app/login/page.tsx',
        changeType: 'created',
        lineCount: 40,
        sizeBytes: 1200,
      },
    },
    {
      kind: 'build_result',
      occurredAt: at('2026-08-13', '16:10:00'),
      payload: { command: 'npm run build -w apps/web', exitCode: 1, success: false, durationMs: 22000 },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-13', '16:35:00'),
      payload: {
        path: 'apps/web/lib/api.ts',
        changeType: 'saved',
        lineCount: 34,
        sizeBytes: 980,
      },
    },
    {
      kind: 'build_result',
      occurredAt: at('2026-08-13', '16:48:00'),
      payload: { command: 'npm run build -w apps/web', exitCode: 0, success: true, durationMs: 18500 },
    },
    {
      kind: 'git_event',
      occurredAt: at('2026-08-13', '17:10:00'),
      payload: {
        hash: 'f6789012345678901234567890ffffff6',
        subject: 'fix: next build — env URL for API client',
        authorName: 'Priya R',
      },
    },
    {
      kind: 'terminal_event',
      occurredAt: at('2026-08-14', '09:40:00'),
      payload: { command: 'npx prisma migrate deploy', exitCode: 0, success: true },
    },
    {
      kind: 'file_snapshot',
      occurredAt: at('2026-08-14', '10:15:00'),
      payload: {
        path: 'README.md',
        changeType: 'saved',
        lineCount: 78,
        sizeBytes: 2400,
      },
    },
    {
      kind: 'git_event',
      occurredAt: at('2026-08-14', '10:22:00'),
      payload: {
        hash: '0123456789abcdef0123456789aaaaaaa7',
        subject: 'docs: run instructions and demo accounts',
        authorName: 'Priya R',
      },
    },
  ];

  return {
    evidence,
    snapshots: [
      {
        label: 'start',
        fileTreeHash: sha('start-tree'),
        fileHashes: startFiles,
        createdAt: at('2026-08-11', '09:10:00'),
      },
      {
        label: 'submission',
        fileTreeHash: sha('submit-tree'),
        fileHashes: submitFiles,
        createdAt: at('2026-08-14', '10:30:00'),
      },
    ],
  };
}

export const CAMPUS_MARKET_BRIEF = {
  subjectRef: 'demo-student-priya',
  projectDescription:
    'Build Campus Market: a full-stack web app where students list used textbooks, other students browse and buy, and sellers see their orders. Must include accounts, listings, and a checkout/order path. PostgreSQL is required.',
  expectedStack: ['React', 'Next.js', 'Express', 'PostgreSQL', 'Prisma'],
  aiUsagePolicy:
    'GitHub Copilot is allowed for boilerplate. Do not paste the whole assignment into a chat model. Do not commit secrets. Disclose AI use in the README if you used more than autocomplete.',
  checklist: [
    { id: 'req-auth', text: 'Users can sign up / log in' },
    { id: 'req-listings', text: 'Authenticated users can create and browse textbook listings' },
    { id: 'req-orders', text: 'A buyer can place an order; a seller can see it' },
    { id: 'req-db', text: 'Data is stored in PostgreSQL (not only mock JSON)' },
    { id: 'req-readme', text: 'README explains how to run the app' },
  ],
  requiredDeliverables: ['Source code', 'README with run steps', 'At least one automated test'],
  criteria: [
    { criterion_id: 'process-pacing', text: 'Work unfolded over time in the diary, not a single dump', category: 'process' },
    { criterion_id: 'process-git', text: 'Git history matches file and terminal activity', category: 'process' },
    { criterion_id: 'stack-fit', text: 'Project uses the expected full-stack (Next/React, Express, Postgres/Prisma)', category: 'code' },
    { criterion_id: 'structure', text: 'Client, API, and data layer are present as distinct parts of the tree', category: 'code' },
    { criterion_id: 'tests-run', text: 'Automated tests were actually executed in the diary', category: 'tests' },
    { criterion_id: 'build-run', text: 'The web app was built (or an equivalent compile) in the diary', category: 'tests' },
    { criterion_id: 'secrets', text: 'Secrets were not captured in plaintext; env files handled safely', category: 'security' },
    { criterion_id: 'ai-policy', text: 'Observed AI use is consistent with the stated AI policy', category: 'security' },
    { criterion_id: 'req-auth', text: 'Users can sign up / log in', category: 'requirements' },
    { criterion_id: 'req-listings', text: 'Listings can be created and browsed', category: 'requirements' },
    { criterion_id: 'req-orders', text: 'Orders / checkout path exists', category: 'requirements' },
    { criterion_id: 'req-db', text: 'PostgreSQL / Prisma is in the project', category: 'requirements' },
    { criterion_id: 'req-readme', text: 'README explains how to run the app', category: 'requirements' },
  ],
} as const;

export function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
