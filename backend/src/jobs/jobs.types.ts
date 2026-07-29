export interface AnswerBankItem {
  question: string;
  answer: string;
}

export interface JobCandidateProfileDTO {
  id: string;
  orgId: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  workAuth: string | null;
  salaryBand: string | null;
  summary: string | null;
  experience: unknown;
  education: unknown;
  skills: string[];
  answerBank: AnswerBankItem[];
  resumeSandboxId: string | null;
  resumeFileName: string | null;
  resumeMimeType: string | null;
  resumeUrl: string | null;
  resumeText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobApplyCampaignDTO {
  id: string;
  orgId: string;
  createdById: string;
  profileId: string | null;
  name: string;
  status: string;
  searchQuery: string | null;
  boards: unknown;
  agentId: string | null;
  stats: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface JobApplicationDTO {
  id: string;
  campaignId: string;
  orgId: string;
  company: string;
  title: string;
  location: string | null;
  applyUrl: string;
  ats: string;
  externalJobId: string | null;
  status: string;
  resultNote: string | null;
  confirmationUrl: string | null;
  agentRunId: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
