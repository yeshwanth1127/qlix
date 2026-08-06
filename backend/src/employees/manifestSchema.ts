import { z } from 'zod';
import { ALL_PERMISSION_SCOPES } from '../agents/scopeCatalog.js';

const scopeId = z.enum(ALL_PERMISSION_SCOPES as [string, ...string[]]).or(z.string().regex(/^mcp\.[a-z0-9-]+\.[a-z0-9_]+$/));

export const employeeRoleSlugSchema = z.enum([
  'sales-executive',
  'accountant',
  'receptionist',
  'recruiter',
  'customer-support',
  'hr-manager',
]);

export const employeeManifestSchema = z.object({
  slug: employeeRoleSlugSchema,
  version: z.string().min(1),
  status: z.enum(['preview', 'beta', 'ga', 'deprecated']),
  label: z.string().min(1),
  mission: z.string().min(1),
  changelog: z.string(),
  outcomes: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        doneLooksLike: z.string().min(1),
        playbookId: z.string().optional(),
        available: z.boolean(),
        limitation: z.string().optional(),
      }),
    )
    .min(1),
  permissionScopes: z.array(scopeId).min(1),
  jitScopes: z.array(scopeId),
  runtime: z.enum(['cloud', 'hybrid', 'local']),
  model: z.string().min(1),
  mcpRequirements: z.array(
    z.object({
      serverSlug: z.string().min(1),
      tools: z.union([z.literal('*'), z.array(z.string().min(1))]),
      ensureRegistered: z.boolean(),
    }),
  ),
  connectorsRequired: z.array(z.enum(['google', 'whatsapp_baileys', 'orbit'])),
  connectorsOptional: z.array(z.enum(['google', 'whatsapp_baileys', 'orbit'])),
  knowledgeRequirements: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      required: z.boolean(),
    }),
  ),
  playbooks: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      steps: z.array(z.string().min(1)).min(1),
      stopConditions: z.array(z.string()),
      escalation: z.string(),
    }),
  ),
  platformSuggestions: z.array(
    z.object({
      platformId: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  allowLimitedHire: z.boolean(),
  minimumCapabilityScopes: z.array(scopeId),
});
