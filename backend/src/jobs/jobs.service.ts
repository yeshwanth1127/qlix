import type { Prisma } from '@prisma/client';
import { extractTextFromUpload } from '../aiBrain/brainExtractText.js';
import { storeSandboxFile } from '../sandbox/sandboxClient.js';
import { blockedApplyMessage, isBlockedApplyHost } from './atsBlocked.js';
import { detectAts } from './atsDetect.js';
import { listingFromApplyUrl, searchAtsBoard, type AtsJobListing } from './atsSearch.js';
import {
  jobsRepository,
  toApplicationDTO,
  toCampaignDTO,
  toProfileDTO,
} from './jobs.repository.js';
import { parseResumeText } from './resumeParse.js';
import type {
  AnswerBankItem,
  JobApplicationDTO,
  JobApplyCampaignDTO,
  JobCandidateProfileDTO,
} from './jobs.types.js';
import type { AtsKind } from './atsDetect.js';

export class JobProfileNotFoundError extends Error {
  constructor() {
    super('Candidate profile not found — upload a resume first');
    this.name = 'JobProfileNotFoundError';
  }
}

export class JobCampaignNotFoundError extends Error {
  constructor() {
    super('Job apply campaign not found');
    this.name = 'JobCampaignNotFoundError';
  }
}

export class JobApplicationNotFoundError extends Error {
  constructor() {
    super('Job application not found');
    this.name = 'JobApplicationNotFoundError';
  }
}

export class JobApplyBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobApplyBlockedError';
  }
}

function mimeForName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

export class JobsService {
  async getProfile(orgId: string, userId: string): Promise<JobCandidateProfileDTO | null> {
    const row = await jobsRepository.getProfile(orgId, userId);
    return row ? toProfileDTO(row) : null;
  }

  async upsertProfileFields(
    orgId: string,
    userId: string,
    fields: {
      fullName?: string | null;
      email?: string | null;
      phone?: string | null;
      location?: string | null;
      linkedinUrl?: string | null;
      githubUrl?: string | null;
      portfolioUrl?: string | null;
      workAuth?: string | null;
      salaryBand?: string | null;
      summary?: string | null;
      skills?: string[];
      answerBank?: AnswerBankItem[];
      experience?: unknown;
      education?: unknown;
    },
  ): Promise<JobCandidateProfileDTO> {
    const data: Prisma.JobCandidateProfileUpdateInput = {};
    if (fields.fullName !== undefined) data.fullName = fields.fullName;
    if (fields.email !== undefined) data.email = fields.email;
    if (fields.phone !== undefined) data.phone = fields.phone;
    if (fields.location !== undefined) data.location = fields.location;
    if (fields.linkedinUrl !== undefined) data.linkedinUrl = fields.linkedinUrl;
    if (fields.githubUrl !== undefined) data.githubUrl = fields.githubUrl;
    if (fields.portfolioUrl !== undefined) data.portfolioUrl = fields.portfolioUrl;
    if (fields.workAuth !== undefined) data.workAuth = fields.workAuth;
    if (fields.salaryBand !== undefined) data.salaryBand = fields.salaryBand;
    if (fields.summary !== undefined) data.summary = fields.summary;
    if (fields.skills !== undefined) data.skills = fields.skills;
    if (fields.answerBank !== undefined) data.answerBank = fields.answerBank as unknown as Prisma.InputJsonValue;
    if (fields.experience !== undefined) data.experience = fields.experience as Prisma.InputJsonValue;
    if (fields.education !== undefined) data.education = fields.education as Prisma.InputJsonValue;

    const row = await jobsRepository.upsertProfile(orgId, userId, data);
    return toProfileDTO(row);
  }

  async uploadResume(
    orgId: string,
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype?: string },
  ): Promise<JobCandidateProfileDTO> {
    const fileName = file.originalname || 'resume.pdf';
    const mime = file.mimetype || mimeForName(fileName);
    const stored = await storeSandboxFile(file.buffer, fileName, mime);

    let resumeText = '';
    try {
      resumeText = await extractTextFromUpload(file.buffer, fileName);
    } catch {
      resumeText = '';
    }
    const parsed = parseResumeText(resumeText);

    const existing = await jobsRepository.getProfile(orgId, userId);
    const row = await jobsRepository.upsertProfile(orgId, userId, {
      resumeSandboxId: stored.id,
      resumeFileName: fileName,
      resumeMimeType: mime,
      resumeUrl: stored.url,
      resumeText: resumeText.slice(0, 100_000) || null,
      fullName: existing?.fullName || parsed.fullName,
      email: existing?.email || parsed.email,
      phone: existing?.phone || parsed.phone,
      linkedinUrl: existing?.linkedinUrl || parsed.linkedinUrl,
      githubUrl: existing?.githubUrl || parsed.githubUrl,
      portfolioUrl: existing?.portfolioUrl || parsed.portfolioUrl,
      summary: existing?.summary || parsed.summary,
      skills:
        existing && existing.skills.length > 0
          ? existing.skills
          : parsed.skills,
    });
    return toProfileDTO(row);
  }

  /** Stage resume from agent chat: plain text or base64 bytes. */
  async stageResumeFromAgent(
    orgId: string,
    userId: string,
    input: { text?: string; base64?: string; fileName?: string },
  ): Promise<JobCandidateProfileDTO> {
    if (input.base64?.trim()) {
      const fileName = input.fileName?.trim() || 'resume.pdf';
      const buffer = Buffer.from(input.base64.trim(), 'base64');
      if (buffer.length < 16) throw new JobApplyBlockedError('base64 resume is empty or invalid');
      if (buffer.length > 10 * 1024 * 1024) throw new JobApplyBlockedError('Resume too large (max 10 MB)');
      return this.uploadResume(orgId, userId, {
        buffer,
        originalname: fileName,
        mimetype: mimeForName(fileName),
      });
    }
    const text = input.text?.trim();
    if (!text) throw new JobApplyBlockedError('Provide resume text or base64');
    const fileName = input.fileName?.trim() || 'resume.txt';
    const buffer = Buffer.from(text, 'utf8');
    return this.uploadResume(orgId, userId, {
      buffer,
      originalname: fileName.endsWith('.txt') ? fileName : `${fileName}.txt`,
      mimetype: 'text/plain',
    });
  }

  async listCampaigns(orgId: string): Promise<JobApplyCampaignDTO[]> {
    const rows = await jobsRepository.listCampaigns(orgId);
    return rows.map(toCampaignDTO);
  }

  async getCampaign(orgId: string, id: string): Promise<JobApplyCampaignDTO> {
    const row = await jobsRepository.getCampaign(orgId, id);
    if (!row) throw new JobCampaignNotFoundError();
    return toCampaignDTO(row);
  }

  async createCampaign(
    orgId: string,
    userId: string,
    input: {
      name: string;
      searchQuery?: string;
      boards?: Array<{ ats: AtsKind; board: string }>;
      applyUrls?: string[];
      agentId?: string;
    },
  ): Promise<{ campaign: JobApplyCampaignDTO; applications: JobApplicationDTO[]; skipped: string[] }> {
    const profile = await jobsRepository.getProfile(orgId, userId);
    if (!profile?.resumeSandboxId) {
      throw new JobProfileNotFoundError();
    }

    const campaign = await jobsRepository.createCampaign({
      orgId,
      createdById: userId,
      profileId: profile.id,
      name: input.name,
      searchQuery: input.searchQuery ?? null,
      boards: (input.boards ?? []) as Prisma.InputJsonValue,
      agentId: input.agentId ?? null,
    });

    const listings: AtsJobListing[] = [];
    const skipped: string[] = [];

    for (const board of input.boards ?? []) {
      if (board.ats === 'unknown') continue;
      try {
        const found = await searchAtsBoard({
          ats: board.ats,
          board: board.board,
          query: input.searchQuery,
        });
        listings.push(...found.slice(0, 50));
      } catch (err) {
        skipped.push(`${board.ats}/${board.board}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    for (const url of input.applyUrls ?? []) {
      const trimmed = url.trim();
      if (!trimmed) continue;
      if (isBlockedApplyHost(trimmed)) {
        skipped.push(blockedApplyMessage(trimmed));
        continue;
      }
      const ats = detectAts(trimmed);
      if (ats === 'unknown') {
        skipped.push(`Unsupported apply URL (need Greenhouse/Lever/Ashby): ${trimmed}`);
        continue;
      }
      listings.push(listingFromApplyUrl(trimmed));
    }

    await jobsRepository.createApplications(
      listings.map((l) => ({
        campaignId: campaign.id,
        orgId,
        company: l.company,
        title: l.title,
        location: l.location,
        applyUrl: l.applyUrl,
        ats: l.ats,
        externalJobId: l.externalJobId,
        status: 'queued',
      })),
    );

    const updated = await jobsRepository.recomputeCampaignStats(campaign.id);
    const applications = await jobsRepository.listApplications(campaign.id);
    return {
      campaign: toCampaignDTO(updated),
      applications: applications.map(toApplicationDTO),
      skipped,
    };
  }

  async queueApplyUrls(
    orgId: string,
    userId: string,
    campaignId: string,
    applyUrls: string[],
  ): Promise<{ applications: JobApplicationDTO[]; skipped: string[] }> {
    const campaign = await jobsRepository.getCampaign(orgId, campaignId);
    if (!campaign) throw new JobCampaignNotFoundError();
    if (campaign.createdById !== userId) {
      // org members can still queue for shared campaigns
    }

    const listings: AtsJobListing[] = [];
    const skipped: string[] = [];
    for (const url of applyUrls) {
      const trimmed = url.trim();
      if (!trimmed) continue;
      if (isBlockedApplyHost(trimmed)) {
        skipped.push(blockedApplyMessage(trimmed));
        continue;
      }
      const ats = detectAts(trimmed);
      if (ats === 'unknown') {
        skipped.push(`Unsupported apply URL (need Greenhouse/Lever/Ashby): ${trimmed}`);
        continue;
      }
      listings.push(listingFromApplyUrl(trimmed));
    }

    await jobsRepository.createApplications(
      listings.map((l) => ({
        campaignId,
        orgId,
        company: l.company,
        title: l.title,
        location: l.location,
        applyUrl: l.applyUrl,
        ats: l.ats,
        externalJobId: l.externalJobId,
      })),
    );
    await jobsRepository.recomputeCampaignStats(campaignId);
    const applications = await jobsRepository.listApplications(campaignId);
    return { applications: applications.map(toApplicationDTO), skipped };
  }

  async searchJobs(params: {
    ats: AtsKind;
    board: string;
    query?: string;
  }): Promise<AtsJobListing[]> {
    if (params.ats === 'unknown') throw new JobApplyBlockedError('ATS must be greenhouse, lever, or ashby');
    return searchAtsBoard(params);
  }

  async listApplications(
    orgId: string,
    campaignId: string,
    opts?: { status?: string },
  ): Promise<JobApplicationDTO[]> {
    const campaign = await jobsRepository.getCampaign(orgId, campaignId);
    if (!campaign) throw new JobCampaignNotFoundError();
    const rows = await jobsRepository.listApplications(campaignId, opts);
    return rows.map(toApplicationDTO);
  }

  async getApplyBrief(orgId: string, applicationId: string): Promise<{
    application: JobApplicationDTO;
    profile: JobCandidateProfileDTO;
    playbook: string;
  }> {
    const app = await jobsRepository.getApplication(orgId, applicationId);
    if (!app) throw new JobApplicationNotFoundError();
    const campaign = await jobsRepository.getCampaign(orgId, app.campaignId);
    if (!campaign?.profileId) throw new JobProfileNotFoundError();

    const { prisma } = await import('../lib/prisma.js');
    const profile = await prisma.jobCandidateProfile.findFirst({
      where: { id: campaign.profileId, orgId },
    });
    if (!profile?.resumeSandboxId) throw new JobProfileNotFoundError();

    await jobsRepository.updateApplication(app.id, { status: 'filling' });
    await jobsRepository.recomputeCampaignStats(app.campaignId);

    const playbook = buildPlaybook(app.ats as AtsKind);
    const refreshed = await jobsRepository.getApplication(orgId, applicationId);

    return {
      application: toApplicationDTO(refreshed!),
      profile: toProfileDTO(profile),
      playbook,
    };
  }

  async recordResult(
    orgId: string,
    applicationId: string,
    input: {
      outcome: 'submitted' | 'blocked' | 'failed' | 'skipped' | 'awaiting_jit';
      note?: string;
      confirmationUrl?: string;
      agentRunId?: string;
    },
  ): Promise<JobApplicationDTO> {
    const app = await jobsRepository.getApplication(orgId, applicationId);
    if (!app) throw new JobApplicationNotFoundError();

    const updated = await jobsRepository.updateApplication(applicationId, {
      status: input.outcome,
      resultNote: input.note ?? null,
      confirmationUrl: input.confirmationUrl ?? null,
      agentRunId: input.agentRunId ?? null,
      submittedAt: input.outcome === 'submitted' ? new Date() : undefined,
    });
    await jobsRepository.recomputeCampaignStats(app.campaignId);
    return toApplicationDTO(updated);
  }

  async nextQueuedApplication(orgId: string, campaignId: string): Promise<JobApplicationDTO | null> {
    const campaign = await jobsRepository.getCampaign(orgId, campaignId);
    if (!campaign) throw new JobCampaignNotFoundError();
    const queued = await jobsRepository.listApplications(campaignId, { status: 'queued', limit: 1 });
    return queued[0] ? toApplicationDTO(queued[0]) : null;
  }
}

function buildPlaybook(ats: AtsKind): string {
  const common = [
    '1. Call get_apply_brief for this applicationId to load profile + resume URL.',
    '2. browser_ab_open(applyUrl). browser_ab_snapshot to map fields.',
    '3. Fill only from candidate profile / answer bank — never invent facts.',
    '4. Download or stage resume if needed; browser_ab_upload to the file input using the runner-local path or fetch resumeUrl.',
    '5. Stop BEFORE final submit. Set status awaiting_jit via record_application_result.',
    '6. Wait for web.transaction JIT approval, then click Submit.',
    '7. Screenshot confirmation; record_application_result(outcome=submitted|blocked|failed).',
    '8. If CAPTCHA or unknown required field: pause and ask the user (live browser handoff).',
  ].join('\n');

  if (ats === 'greenhouse') {
    return `ATS: Greenhouse\n${common}\nTips: multi-page; look for Continue then Submit Application; custom questions often in iframes.`;
  }
  if (ats === 'lever') {
    return `ATS: Lever\n${common}\nTips: single-page form common; Submit Application at bottom; may email-verify.`;
  }
  if (ats === 'ashby') {
    return `ATS: Ashby\n${common}\nTips: modern SPA; wait for form hydrate; upload + required custom fields before submit.`;
  }
  return `ATS: unknown — refuse if not greenhouse/lever/ashby.\n${common}`;
}

export const jobsService = new JobsService();
