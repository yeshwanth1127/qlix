/** Agent fields used to derive stable Docker container / image names. */
export interface DockerAgentIdentity {
  readonly id: string;
  readonly name: string;
  readonly did: string;
}

const DOCKER_NAME_MAX_LEN = 63;

/** Legacy container name (pre name+did labeling). */
export function legacyDockerContainerName(agentId: string): string {
  return `qlix-agent-${agentId}`;
}

function sanitizeSegment(input: string, maxLen: number): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/^did:[^:]*:/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const out = s.slice(0, maxLen);
  return out.length > 0 ? out : 'agent';
}

/** Compact DID segment for Docker names (first 8 + last 6 alnum, Qlix table convention). */
export function didDockerSegment(did: string): string {
  const alnum = did.replace(/[^a-zA-Z0-9]/g, '');
  if (alnum.length <= 18) return alnum.toLowerCase();
  return `${alnum.slice(0, 8)}-${alnum.slice(-6)}`.toLowerCase();
}

/**
 * Human-readable container name: qlix-{agent-name}--{did-segment}--{id-suffix}
 * Includes agent id suffix so names stay unique when display names collide.
 */
export function dockerContainerName(agent: DockerAgentIdentity): string {
  const namePart = sanitizeSegment(agent.name, 24);
  const didPart = didDockerSegment(agent.did);
  const idPart = sanitizeSegment(agent.id, 10);
  const composed = `qlix-${namePart}--${didPart}--${idPart}`;
  return composed.slice(0, DOCKER_NAME_MAX_LEN);
}

export function dockerImageRepository(agent: DockerAgentIdentity): string {
  const namePart = sanitizeSegment(agent.name, 22);
  const didPart = didDockerSegment(agent.did);
  return `qlix-agent-${namePart}-${didPart}`;
}

export function dockerImageRef(agent: DockerAgentIdentity, versionHash: string): string {
  const idPart = sanitizeSegment(agent.id, 10);
  return `${dockerImageRepository(agent)}:${idPart}-${versionHash}`;
}

export function dockerImageListPrefix(agent: DockerAgentIdentity): string {
  return `${dockerImageRepository(agent)}:`;
}

export function dockerAgentLabels(agent: DockerAgentIdentity): Record<string, string> {
  return {
    'com.qlix.agent.id': agent.id,
    'com.qlix.agent.name': agent.name,
    'com.qlix.agent.did': agent.did,
  };
}

export interface DockerTeamContext {
  readonly id: string;
  readonly name: string;
  readonly role: 'supervisor' | 'worker';
}

export function dockerTeamNetworkName(teamId: string): string {
  const short = sanitizeSegment(teamId, 20);
  return `qlix-team-${short}`.slice(0, DOCKER_NAME_MAX_LEN);
}

export function dockerTeamLabels(team: DockerTeamContext): Record<string, string> {
  return {
    'com.qlix.team.id': team.id,
    'com.qlix.team.name': team.name.slice(0, 120),
    'com.qlix.team.role': team.role,
  };
}

/** Team-prefixed container name for filterability: qlix-t-{team}--{agent}--{did}--{id} */
export function dockerTeamContainerName(
  agent: DockerAgentIdentity,
  team: DockerTeamContext,
): string {
  const teamPart = sanitizeSegment(team.name, 16) || sanitizeSegment(team.id, 12);
  const namePart = sanitizeSegment(agent.name, 18);
  const didPart = didDockerSegment(agent.did);
  const idPart = sanitizeSegment(agent.id, 8);
  const composed = `qlix-t-${teamPart}--${namePart}--${didPart}--${idPart}`;
  return composed.slice(0, DOCKER_NAME_MAX_LEN);
}

export function mergeDockerLabels(
  agent: DockerAgentIdentity,
  team?: DockerTeamContext | null,
): Record<string, string> {
  return team ? { ...dockerAgentLabels(agent), ...dockerTeamLabels(team) } : dockerAgentLabels(agent);
}
