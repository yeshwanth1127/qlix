export type LeadCampaignStatus = 'draft' | 'scraping' | 'ready' | 'outreach' | 'completed' | 'failed';

export type LeadStatus = 'scraped' | 'no_email' | 'contacted' | 'skipped';

export type OutreachChannel = 'email' | 'whatsapp' | 'mcp' | 'n8n';

export interface LeadCampaignStats {
  totalLeads: number;
  withEmail: number;
  contacted: number;
  failed: number;
}

export interface OutreachConfig {
  channel?: OutreachChannel;
  provider?: string;
  template?: {
    subject?: string;
    bodyTemplate?: string;
  };
  skipWithoutEmail?: boolean;
  dailyLimit?: number;
  agentId?: string;
}

export interface LeadCampaignDTO {
  id: string;
  orgId: string;
  createdById: string;
  name: string;
  status: LeadCampaignStatus;
  searchQuery: string;
  location: string | null;
  maxResults: number;
  outreachConfig: OutreachConfig;
  agentRunId: string | null;
  scrapeJobId: string | null;
  stats: LeadCampaignStats;
  createdAt: string;
  updatedAt: string;
}

export interface LeadDTO {
  id: string;
  campaignId: string;
  orgId: string;
  businessName: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  categories: string[];
  rating: number | null;
  reviewCount: number | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  socialLinks: Record<string, unknown>;
  status: LeadStatus;
  /** How the email was obtained: none | mock | website | gmb */
  emailSource: string | null;
  /** True only when email is safe to use for outreach */
  emailVerified: boolean;
  createdAt: string;
}

export interface LeadOutreachDTO {
  id: string;
  campaignId: string;
  leadId: string;
  channel: string;
  provider: string;
  status: string;
  subject: string | null;
  bodyPreview: string | null;
  actionLogId: string | null;
  sentAt: string | null;
  error: string | null;
}

export interface CreateLeadCampaignInput {
  name: string;
  searchQuery: string;
  location?: string | null;
  maxResults?: number;
  requireWebsite?: boolean;
  outreachConfig?: OutreachConfig;
}

export interface BulkLeadInput {
  businessName: string;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  email?: string | null;
  categories?: string[];
  rating?: number | null;
  reviewCount?: number | null;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
  socialLinks?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}
