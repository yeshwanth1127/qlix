const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export interface AnswerBankItem {
  question: string;
  answer: string;
}

export interface JobCandidateProfileDTO {
  id: string;
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
  skills: string[];
  answerBank: AnswerBankItem[];
  resumeSandboxId: string | null;
  resumeFileName: string | null;
  resumeUrl: string | null;
  updatedAt: string;
}

export interface JobApplyCampaignDTO {
  id: string;
  name: string;
  status: string;
  searchQuery: string | null;
  stats: Record<string, unknown>;
  agentId: string | null;
  createdAt: string;
}

export interface JobApplicationDTO {
  id: string;
  campaignId: string;
  company: string;
  title: string;
  location: string | null;
  applyUrl: string;
  ats: string;
  status: string;
  resultNote: string | null;
  submittedAt: string | null;
}

export interface AtsJobListing {
  company: string;
  title: string;
  location: string | null;
  applyUrl: string;
  ats: string;
  externalJobId: string | null;
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function getJobProfile(): Promise<JobCandidateProfileDTO | null> {
  const res = await fetch(`${apiBase()}/api/v1/jobs/profile`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load profile");
  const data = await parseJson<{ profile: JobCandidateProfileDTO | null }>(res);
  return data.profile;
}

export async function saveJobProfile(
  body: Partial<JobCandidateProfileDTO> & { answerBank?: AnswerBankItem[] },
): Promise<JobCandidateProfileDTO> {
  const res = await fetch(`${apiBase()}/api/v1/jobs/profile`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ profile: JobCandidateProfileDTO; error?: { message: string } }>(res);
  if (!res.ok) throw new Error(data.error?.message ?? "Failed to save profile");
  return data.profile;
}

export async function uploadJobResume(file: File): Promise<JobCandidateProfileDTO> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${apiBase()}/api/v1/jobs/profile/resume`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const data = await parseJson<{ profile: JobCandidateProfileDTO; error?: { message: string } }>(res);
  if (!res.ok) throw new Error(data.error?.message ?? "Failed to upload resume");
  return data.profile;
}

export async function listJobCampaigns(): Promise<JobApplyCampaignDTO[]> {
  const res = await fetch(`${apiBase()}/api/v1/jobs/campaigns`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load campaigns");
  const data = await parseJson<{ campaigns: JobApplyCampaignDTO[] }>(res);
  return data.campaigns;
}

export async function getJobCampaign(
  id: string,
): Promise<{ campaign: JobApplyCampaignDTO; applications: JobApplicationDTO[] }> {
  const res = await fetch(`${apiBase()}/api/v1/jobs/campaigns/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load campaign");
  return parseJson(res);
}

export async function createJobCampaign(body: {
  name: string;
  searchQuery?: string;
  boards?: Array<{ ats: "greenhouse" | "lever" | "ashby"; board: string }>;
  applyUrls?: string[];
  agentId?: string;
}): Promise<{
  campaign: JobApplyCampaignDTO;
  applications: JobApplicationDTO[];
  skipped: string[];
}> {
  const res = await fetch(`${apiBase()}/api/v1/jobs/campaigns`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson<{
    campaign: JobApplyCampaignDTO;
    applications: JobApplicationDTO[];
    skipped: string[];
    error?: { message: string };
  }>(res);
  if (!res.ok) throw new Error(data.error?.message ?? "Failed to create campaign");
  return data;
}

export async function searchAtsJobs(body: {
  ats: "greenhouse" | "lever" | "ashby";
  board: string;
  query?: string;
}): Promise<AtsJobListing[]> {
  const res = await fetch(`${apiBase()}/api/v1/jobs/search`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ jobs: AtsJobListing[]; error?: { message: string } }>(res);
  if (!res.ok) throw new Error(data.error?.message ?? "Search failed");
  return data.jobs;
}

export async function createJobApplyAgent(name?: string): Promise<{ agentId: string; name: string }> {
  const res = await fetch(`${apiBase()}/api/v1/jobs/agent-template`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await parseJson<{ agentId: string; name: string; error?: { message: string } }>(res);
  if (!res.ok) throw new Error(data.error?.message ?? "Failed to create agent");
  return data;
}
