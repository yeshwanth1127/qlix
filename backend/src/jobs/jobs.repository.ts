import type { JobApplication, JobApplyCampaign, JobCandidateProfile, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { AnswerBankItem, JobApplicationDTO, JobApplyCampaignDTO, JobCandidateProfileDTO } from './jobs.types.js';

function asAnswerBank(value: unknown): AnswerBankItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      question: String(x.question ?? ''),
      answer: String(x.answer ?? ''),
    }))
    .filter((x) => x.question);
}

export function toProfileDTO(row: JobCandidateProfile): JobCandidateProfileDTO {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    location: row.location,
    linkedinUrl: row.linkedinUrl,
    githubUrl: row.githubUrl,
    portfolioUrl: row.portfolioUrl,
    workAuth: row.workAuth,
    salaryBand: row.salaryBand,
    summary: row.summary,
    experience: row.experience,
    education: row.education,
    skills: row.skills,
    answerBank: asAnswerBank(row.answerBank),
    resumeSandboxId: row.resumeSandboxId,
    resumeFileName: row.resumeFileName,
    resumeMimeType: row.resumeMimeType,
    resumeUrl: row.resumeUrl,
    resumeText: row.resumeText,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCampaignDTO(row: JobApplyCampaign): JobApplyCampaignDTO {
  return {
    id: row.id,
    orgId: row.orgId,
    createdById: row.createdById,
    profileId: row.profileId,
    name: row.name,
    status: row.status,
    searchQuery: row.searchQuery,
    boards: row.boards,
    agentId: row.agentId,
    stats: (row.stats as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toApplicationDTO(row: JobApplication): JobApplicationDTO {
  return {
    id: row.id,
    campaignId: row.campaignId,
    orgId: row.orgId,
    company: row.company,
    title: row.title,
    location: row.location,
    applyUrl: row.applyUrl,
    ats: row.ats,
    externalJobId: row.externalJobId,
    status: row.status,
    resultNote: row.resultNote,
    confirmationUrl: row.confirmationUrl,
    agentRunId: row.agentRunId,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class JobsRepository {
  async getProfile(orgId: string, userId: string): Promise<JobCandidateProfile | null> {
    return prisma.jobCandidateProfile.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
  }

  async upsertProfile(
    orgId: string,
    userId: string,
    data: Prisma.JobCandidateProfileUpdateInput,
  ): Promise<JobCandidateProfile> {
    return prisma.jobCandidateProfile.upsert({
      where: { orgId_userId: { orgId, userId } },
      create: {
        orgId,
        userId,
        fullName: typeof data.fullName === 'string' ? data.fullName : null,
        email: typeof data.email === 'string' ? data.email : null,
        phone: typeof data.phone === 'string' ? data.phone : null,
        location: typeof data.location === 'string' ? data.location : null,
        linkedinUrl: typeof data.linkedinUrl === 'string' ? data.linkedinUrl : null,
        githubUrl: typeof data.githubUrl === 'string' ? data.githubUrl : null,
        portfolioUrl: typeof data.portfolioUrl === 'string' ? data.portfolioUrl : null,
        workAuth: typeof data.workAuth === 'string' ? data.workAuth : null,
        salaryBand: typeof data.salaryBand === 'string' ? data.salaryBand : null,
        summary: typeof data.summary === 'string' ? data.summary : null,
        experience: (data.experience as Prisma.InputJsonValue) ?? [],
        education: (data.education as Prisma.InputJsonValue) ?? [],
        skills: Array.isArray(data.skills) ? (data.skills as string[]) : [],
        answerBank: (data.answerBank as Prisma.InputJsonValue) ?? [],
        resumeSandboxId: typeof data.resumeSandboxId === 'string' ? data.resumeSandboxId : null,
        resumeFileName: typeof data.resumeFileName === 'string' ? data.resumeFileName : null,
        resumeMimeType: typeof data.resumeMimeType === 'string' ? data.resumeMimeType : null,
        resumeUrl: typeof data.resumeUrl === 'string' ? data.resumeUrl : null,
        resumeText: typeof data.resumeText === 'string' ? data.resumeText : null,
      },
      update: data,
    });
  }

  async listCampaigns(orgId: string): Promise<JobApplyCampaign[]> {
    return prisma.jobApplyCampaign.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getCampaign(orgId: string, id: string): Promise<JobApplyCampaign | null> {
    return prisma.jobApplyCampaign.findFirst({ where: { id, orgId } });
  }

  async createCampaign(data: {
    orgId: string;
    createdById: string;
    profileId?: string | null;
    name: string;
    searchQuery?: string | null;
    boards?: Prisma.InputJsonValue;
    agentId?: string | null;
  }): Promise<JobApplyCampaign> {
    return prisma.jobApplyCampaign.create({
      data: {
        orgId: data.orgId,
        createdById: data.createdById,
        profileId: data.profileId ?? null,
        name: data.name,
        searchQuery: data.searchQuery ?? null,
        boards: data.boards ?? [],
        agentId: data.agentId ?? null,
        status: 'draft',
        stats: {},
      },
    });
  }

  async updateCampaign(
    id: string,
    data: Prisma.JobApplyCampaignUpdateInput,
  ): Promise<JobApplyCampaign> {
    return prisma.jobApplyCampaign.update({ where: { id }, data });
  }

  async listApplications(
    campaignId: string,
    opts?: { status?: string; limit?: number; offset?: number },
  ): Promise<JobApplication[]> {
    return prisma.jobApplication.findMany({
      where: {
        campaignId,
        ...(opts?.status ? { status: opts.status } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: opts?.limit ?? 100,
      skip: opts?.offset ?? 0,
    });
  }

  async getApplication(orgId: string, id: string): Promise<JobApplication | null> {
    return prisma.jobApplication.findFirst({ where: { id, orgId } });
  }

  async createApplications(
    rows: Array<{
      campaignId: string;
      orgId: string;
      company: string;
      title: string;
      location?: string | null;
      applyUrl: string;
      ats: string;
      externalJobId?: string | null;
      status?: string;
      resultNote?: string | null;
    }>,
  ): Promise<number> {
    let created = 0;
    for (const row of rows) {
      try {
        await prisma.jobApplication.create({
          data: {
            campaignId: row.campaignId,
            orgId: row.orgId,
            company: row.company,
            title: row.title,
            location: row.location ?? null,
            applyUrl: row.applyUrl,
            ats: row.ats,
            externalJobId: row.externalJobId ?? null,
            status: row.status ?? 'queued',
            resultNote: row.resultNote ?? null,
          },
        });
        created += 1;
      } catch {
        // unique(campaignId, applyUrl) — skip duplicates
      }
    }
    return created;
  }

  async updateApplication(
    id: string,
    data: Prisma.JobApplicationUpdateInput,
  ): Promise<JobApplication> {
    return prisma.jobApplication.update({ where: { id }, data });
  }

  async recomputeCampaignStats(campaignId: string): Promise<JobApplyCampaign> {
    const apps = await prisma.jobApplication.findMany({
      where: { campaignId },
      select: { status: true },
    });
    const stats = {
      total: apps.length,
      queued: apps.filter((a) => a.status === 'queued').length,
      filling: apps.filter((a) => a.status === 'filling').length,
      awaitingJit: apps.filter((a) => a.status === 'awaiting_jit').length,
      submitted: apps.filter((a) => a.status === 'submitted').length,
      blocked: apps.filter((a) => a.status === 'blocked').length,
      failed: apps.filter((a) => a.status === 'failed').length,
      skipped: apps.filter((a) => a.status === 'skipped').length,
    };
    let status = 'draft';
    if (stats.submitted + stats.blocked + stats.failed + stats.skipped === stats.total && stats.total > 0) {
      status = 'completed';
    } else if (stats.filling + stats.awaitingJit > 0) {
      status = 'applying';
    } else if (stats.queued > 0) {
      status = 'queued';
    }
    return prisma.jobApplyCampaign.update({
      where: { id: campaignId },
      data: { stats, status },
    });
  }
}

export const jobsRepository = new JobsRepository();
