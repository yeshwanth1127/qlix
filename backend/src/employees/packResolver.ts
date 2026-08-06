import { ConnectorsRepository } from '../connectors/connectors.repository.js';
import type { ConnectorProvider } from '../connectors/connectors.types.js';
import { prisma } from '../lib/prisma.js';
import type { PermissionScope } from '../agents/agents.types.js';
import {
  getBuildableScopes,
  reconcileRuntimeWithScopes,
} from '../agents/scopeCatalog.js';
import type {
  EmployeeKnowledgeRequirement,
  EmployeeRoleManifest,
  PreflightReadiness,
  PreflightResult,
  RoleCatalogEntry,
} from './employees.types.js';
import { providersForConnectorsPage, resolveSelectedPlatforms } from './platformWiring.js';
import { getRoleManifest, listRoleManifests } from './rolePacks.js';

const connectorsRepo = new ConnectorsRepository();

async function connectedProviders(orgId: string): Promise<Set<ConnectorProvider>> {
  const accounts = await connectorsRepo.listForOrg(orgId);
  return new Set(
    accounts.filter((a) => a.status === 'connected').map((a) => a.provider),
  );
}

async function missingKnowledge(
  orgId: string,
  requirements: EmployeeKnowledgeRequirement[],
): Promise<EmployeeKnowledgeRequirement[]> {
  const required = requirements.filter((r) => r.required);
  if (required.length === 0) return [];

  const collections = await prisma.brainKnowledgeCollection.findMany({
    where: { orgId },
    include: { documents: { select: { id: true, title: true } } },
  });
  const titles = new Set(
    collections.flatMap((c) => c.documents.map((d) => d.title.toLowerCase())),
  );

  return required.filter((r) => !titles.has(r.label.toLowerCase()));
}

function mergeScopes(
  base: readonly string[],
  extra: readonly PermissionScope[],
  buildableIds: Set<string>,
): PermissionScope[] {
  const merged = [...new Set([...base, ...extra])];
  return merged.filter((s) => buildableIds.has(s)) as PermissionScope[];
}

export async function resolvePreflight(
  orgId: string,
  manifest: EmployeeRoleManifest,
  selectedPlatformIds: readonly string[] = [],
): Promise<PreflightResult> {
  const buildable = await getBuildableScopes(orgId);
  const buildableIds = new Set(buildable.map((s) => s.id));

  const platform = resolveSelectedPlatforms(selectedPlatformIds);
  const resolvedScopes = mergeScopes(manifest.permissionScopes, platform.scopes, buildableIds);

  const baseJit = manifest.jitScopes.filter(
    (s) => buildableIds.has(s as PermissionScope) && resolvedScopes.includes(s as PermissionScope),
  ) as PermissionScope[];
  const resolvedJitScopes = [
    ...new Set([...baseJit, ...platform.jitScopes.filter((s) => resolvedScopes.includes(s))]),
  ] as PermissionScope[];

  const missingCapabilityScopes = manifest.minimumCapabilityScopes.filter(
    (s) => !buildableIds.has(s as PermissionScope),
  );

  const connectorsRequired = platform.providers;
  const connected = await connectedProviders(orgId);
  const connectorsMissing = connectorsRequired.filter((p) => !connected.has(p));
  const connectorsConnected = connectorsRequired.filter((p) => connected.has(p));

  const missingKnowledgeItems = await missingKnowledge(orgId, manifest.knowledgeRequirements);

  const hasMinimumCapabilities = missingCapabilityScopes.length === 0;

  let hireMode: PreflightResult['hireMode'] = 'unavailable';
  if (hasMinimumCapabilities) {
    hireMode = connectorsMissing.length === 0 ? 'full' : 'limited';
  } else if (manifest.allowLimitedHire) {
    hireMode = 'limited';
  }

  let readiness: PreflightReadiness = 'ready';
  const messages: string[] = [];

  if (missingCapabilityScopes.length > 0) {
    readiness = 'needs_capability';
    messages.push(`Enable skills: ${missingCapabilityScopes.join(', ')}`);
  }
  if (connectorsMissing.length > 0) {
    readiness = readiness === 'ready' ? 'needs_connector' : readiness;
    messages.push(
      `Connect ${providersForConnectorsPage(connectorsMissing).replace(/,/g, ', ')} on the Connectors page`,
    );
  }
  if (platform.soonPlatformIds.length > 0) {
    messages.push(
      `${platform.soonPlatformIds.join(', ')} — connect flow coming soon; saved for when available`,
    );
  }
  if (missingKnowledgeItems.length > 0) {
    readiness = readiness === 'ready' ? 'needs_knowledge' : readiness;
    messages.push(`Upload: ${missingKnowledgeItems.map((k) => k.label).join(', ')}`);
  }

  const resolvedRuntime = reconcileRuntimeWithScopes(manifest.runtime, resolvedScopes);

  return {
    readiness,
    roleSlug: manifest.slug,
    packVersion: manifest.version,
    hireMode,
    resolvedScopes,
    resolvedJitScopes,
    resolvedRuntime,
    connectorsRequired,
    connectorsConnected,
    connectorsMissing,
    missingCapabilityScopes,
    missingKnowledge: missingKnowledgeItems,
    selectedPlatformIds: [...selectedPlatformIds],
    soonPlatformIds: platform.soonPlatformIds,
    messages,
  };
}

export async function buildRoleCatalogEntry(
  orgId: string,
  manifest: EmployeeRoleManifest,
): Promise<RoleCatalogEntry> {
  const preflight = await resolvePreflight(orgId, manifest, []);
  let limitationSummary: string | undefined;
  if (preflight.hireMode === 'unavailable') {
    limitationSummary =
      preflight.messages.filter((m) => !m.includes('Connect')).join(' · ') ||
      'Required capabilities are not enabled for this workspace.';
  }

  return {
    slug: manifest.slug,
    version: manifest.version,
    status: manifest.status,
    label: manifest.label,
    mission: manifest.mission,
    outcomes: manifest.outcomes,
    connectorsRequired: [],
    connectorsOptional: [],
    knowledgeRequirements: manifest.knowledgeRequirements,
    platformSuggestions: manifest.platformSuggestions,
    hireable: preflight.hireMode !== 'unavailable',
    hireMode: preflight.hireMode,
    limitationSummary,
  };
}

export async function listRoleCatalog(orgId: string): Promise<RoleCatalogEntry[]> {
  return Promise.all(listRoleManifests().map((m) => buildRoleCatalogEntry(orgId, m)));
}

export async function getRoleCatalogEntry(
  orgId: string,
  slug: string,
): Promise<RoleCatalogEntry | null> {
  const manifest = getRoleManifest(slug);
  if (!manifest) return null;
  return buildRoleCatalogEntry(orgId, manifest);
}

export { getRoleManifest };
