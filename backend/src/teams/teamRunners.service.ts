import type { AgentDTO } from '../agents/agents.types.js';
import {
  type DockerAgentIdentity,
  dockerContainerName,
  dockerTeamContainerName,
  type DockerTeamContext,
} from '../cloudRunners/dockerNaming.js';
import type { TeamDTO, TeamRunnerStatusEntry, TeamRunnersStatusDTO } from './teams.types.js';
import { isLlmProviderConfigured } from '../llm/inferenceRouter.js';

const HEARTBEAT_FRESH_MS = 20_000;

export function isHeartbeatFresh(lastHeartbeat: Date | null | undefined): boolean {
  if (!lastHeartbeat) return false;
  return Date.now() - lastHeartbeat.getTime() < HEARTBEAT_FRESH_MS;
}

export function buildRunnerStatusEntry(params: {
  agent: AgentDTO;
  role: 'supervisor' | 'worker';
  team?: { id: string; name: string } | null;
  inferenceReady?: boolean;
}): TeamRunnerStatusEntry {
  const { agent, role, team } = params;
  const inferenceReady =
    params.inferenceReady ?? isLlmProviderConfigured(agent.llmProvider);
  const heartbeatAt =
    agent.runtime === 'hybrid'
      ? agent.hybridLastHeartbeatAt
      : agent.cloudLastHeartbeatAt;
  const heartbeatFresh = isHeartbeatFresh(heartbeatAt ? new Date(heartbeatAt) : null);
  const provisioningStatus =
    agent.runtime === 'cloud' ? (agent.cloudProvisioningStatus ?? null) : null;
  const inferenceError =
    (agent.runtime === 'cloud' || agent.runtime === 'hybrid') &&
    agent.llmMode === 'proxy' &&
    !inferenceReady
      ? `Inference proxy is not configured for provider "${agent.llmProvider}".`
      : null;

  const identity: DockerAgentIdentity = { id: agent.id, name: agent.name, did: agent.did };
  const teamCtx: DockerTeamContext | null = team
    ? { id: team.id, name: team.name, role }
    : null;
  const containerName =
    agent.runtime === 'cloud' && teamCtx
      ? dockerTeamContainerName(identity, teamCtx)
      : agent.runtime === 'cloud'
        ? dockerContainerName(identity)
        : agent.runtime === 'hybrid'
          ? 'local-daemon'
          : null;

  const ready =
    (agent.runtime === 'cloud' || agent.runtime === 'hybrid') &&
    (agent.runtime !== 'cloud' || provisioningStatus !== 'failed') &&
    heartbeatFresh &&
    !inferenceError;

  return {
    agentId: agent.id,
    name: agent.name,
    did: agent.did,
    role,
    runtime: agent.runtime,
    provisioningStatus,
    heartbeatFresh,
    inferenceError,
    containerName,
    cloudRunnerId: agent.cloudRunnerId ?? null,
    ready,
  };
}

export function buildTeamRunnersStatus(
  team: TeamDTO,
  agents: Map<string, AgentDTO>,
  inferenceReady?: boolean,
): TeamRunnersStatusDTO {
  const runners: TeamRunnerStatusEntry[] = [];

  if (team.supervisorAgentId) {
    const sup = agents.get(team.supervisorAgentId);
    if (sup) {
      runners.push(
        buildRunnerStatusEntry({
          agent: sup,
          role: 'supervisor',
          team: { id: team.id, name: team.name },
          inferenceReady,
        }),
      );
    }
  }

  for (const m of team.members ?? []) {
    const agent = agents.get(m.agentId);
    if (agent) {
      runners.push(
        buildRunnerStatusEntry({
          agent,
          role: 'worker',
          team: { id: team.id, name: team.name },
          inferenceReady,
        }),
      );
    }
  }

  const allReady =
    runners.length > 0 &&
    runners.every((r) => r.ready) &&
    (team.members?.length ?? 0) > 0 &&
    Boolean(team.supervisorAgentId);

  return { teamId: team.id, allReady, runners };
}

export function assertRunnersReady(status: TeamRunnersStatusDTO): void {
  if (!status.runners.some((r) => r.role === 'supervisor')) {
    throw new Error('Team has no supervisor agent');
  }
  if (!status.runners.some((r) => r.role === 'worker')) {
    throw new Error('Team has no worker agents');
  }
  const notReady = status.runners.filter((r) => !r.ready);
  if (notReady.length > 0) {
    const names = notReady.map((r) => `${r.name} (${r.runtime}, hb=${r.heartbeatFresh})`).join(', ');
    throw new Error(`Team runners not ready: ${names}`);
  }
}
