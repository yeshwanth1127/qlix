import { prisma } from '../lib/prisma.js';
import { ConnectorsRepository } from '../connectors/connectors.repository.js';
import type { ConnectorAccountDTO } from '../connectors/connectors.types.js';
import { addInjection } from './runInjectionStore.js';
import { TeamsRepository } from './teams.repository.js';
import { TeamsService, TeamNotFoundError } from './teams.service.js';
import { launchTeamRun } from './teamsRunLauncher.js';
import type { TeamRunDTO } from './teams.types.js';

const connectorsRepo = new ConnectorsRepository();
const teamsRepo = new TeamsRepository();
const teamsService = new TeamsService();

export type ParsedAtCommand = {
  targetName: string | null;
  body: string;
  hasAtPrefix: boolean;
};

/** `@goal` (default team) or `@TeamName: goal` / `@TeamName goal`. */
export function parsePrefixedTarget(text: string): ParsedAtCommand {
  const trimmed = text.trim();
  if (!trimmed.startsWith('@')) {
    return { targetName: null, body: trimmed, hasAtPrefix: false };
  }

  const colon = trimmed.match(/^@([^:]+):\s*([\s\S]*)$/);
  if (colon) {
    return {
      targetName: colon[1]!.trim() || null,
      body: colon[2]!.trim(),
      hasAtPrefix: true,
    };
  }

  return { targetName: null, body: trimmed.slice(1).trim(), hasAtPrefix: true };
}

/** If message starts with `@`, match longest team name prefix before the goal text. */
async function parseTeamAtCommand(
  connector: ConnectorAccountDTO,
  text: string,
): Promise<ParsedAtCommand> {
  const parsed = parsePrefixedTarget(text);
  if (!parsed.hasAtPrefix || parsed.targetName) return parsed;

  const teams = await prisma.team.findMany({
    where: { orgId: connector.orgId },
    select: { name: true },
  });
  const byLength = [...teams].sort((a, b) => b.name.length - a.name.length);

  for (const t of byLength) {
    const rest = parsed.body;
    if (!rest) continue;
    if (rest.toLowerCase() === t.name.toLowerCase()) {
      return { targetName: t.name, body: '', hasAtPrefix: true };
    }
    const prefix = `${t.name} `;
    if (rest.toLowerCase().startsWith(prefix.toLowerCase())) {
      return {
        targetName: t.name,
        body: rest.slice(prefix.length).trim(),
        hasAtPrefix: true,
      };
    }
  }

  return parsed;
}

async function resolveTeamByName(
  connector: ConnectorAccountDTO,
  teamName: string,
): Promise<{ id: string; name: string }> {
  const team = await prisma.team.findFirst({
    where: {
      orgId: connector.orgId,
      name: { equals: teamName, mode: 'insensitive' },
    },
    select: { id: true, name: true },
  });
  if (!team) throw new Error(`No team named "${teamName}"`);
  return team;
}

async function resolveDefaultTeam(
  connector: ConnectorAccountDTO,
): Promise<{ id: string; name: string } | null> {
  if (connector.whatsappDefaultTeamId) {
    const team = await prisma.team.findFirst({
      where: { id: connector.whatsappDefaultTeamId, orgId: connector.orgId },
      select: { id: true, name: true },
    });
    if (team) return team;
  }

  return null;
}

export async function injectTeamRunMessage(
  run: TeamRunDTO,
  teamId: string,
  message: string,
): Promise<{ ok: boolean; reason?: string }> {
  const task = await prisma.a2ATask.findFirst({
    where: { runId: run.id, teamId, status: 'working' },
    select: { agentRunId: true, toAgentId: true },
  });
  if (!task?.agentRunId) {
    return { ok: false, reason: 'No active worker — run may be between stages' };
  }
  await addInjection(task.agentRunId, message);
  await teamsRepo.appendEvent(run.id, teamId, task.toAgentId, 'user_injection', {
    message,
    channel: 'whatsapp',
  });
  return { ok: true };
}

export async function cancelTeamRunForConnector(connectorId: string): Promise<string> {
  const active = await teamsRepo.findActiveRunForConnector(connectorId);
  if (!active) return 'No active team run for this WhatsApp session.';
  if (!['queued', 'running'].includes(active.status)) {
    return `Team run is already ${active.status}.`;
  }
  await teamsRepo.updateRunStatus(active.id, 'canceled');
  await teamsRepo.clearChannelSession(connectorId);
  const team = await prisma.team.findUnique({ where: { id: active.teamId }, select: { name: true } });
  return `Canceled team run for ${team?.name ?? 'team'} (${active.id.slice(0, 8)}…).`;
}

export async function formatTeamRunStatus(connectorId: string): Promise<string | null> {
  const active = await teamsRepo.findActiveRunForConnector(connectorId);
  if (!active) return null;

  const team = await prisma.team.findUnique({
    where: { id: active.teamId },
    select: { name: true },
  });
  const working = await prisma.a2ATask.findFirst({
    where: { runId: active.id, status: 'working' },
    select: { toAgentId: true },
  });
  let worker = 'between stages';
  if (working?.toAgentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: working.toAgentId },
      select: { name: true },
    });
    worker = agent?.name ?? working.toAgentId.slice(0, 8);
  }
  return `*Team run active*\n${team?.name ?? 'Team'} · ${active.status}\nWorker: ${worker}\nRun: ${active.id.slice(0, 12)}…`;
}

export async function tryHandleTeamWhatsAppInbound(
  connector: ConnectorAccountDTO,
  text: string,
): Promise<{ reply: string; handled: boolean }> {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === '!cancel' || lower === '!stop team' || lower.startsWith('!stop team')) {
    const reply = await cancelTeamRunForConnector(connector.id);
    return { reply, handled: true };
  }

  const { targetName, body, hasAtPrefix } = await parseTeamAtCommand(connector, trimmed);

  if (!hasAtPrefix) {
    return { reply: '', handled: false };
  }

  const active = await teamsRepo.findActiveRunForConnector(connector.id);
  if (active && body) {
    const injected = await injectTeamRunMessage(active, active.teamId, body);
    if (injected.ok) {
      return {
        reply: `Added guidance to active team run (${active.id.slice(0, 8)}…).`,
        handled: true,
      };
    }
    return { reply: '', handled: true };
  }

  let team: { id: string; name: string } | null = null;
  if (targetName) {
    try {
      team = await resolveTeamByName(connector, targetName);
    } catch {
      return {
        reply: `No team named "${targetName}". Use @TeamName: your goal or check team names in Qlix.`,
        handled: true,
      };
    }
  } else {
    team = await resolveDefaultTeam(connector);
    if (!team) {
      return {
        reply:
          'Set a default team in Connectors, then send @ your goal. Or use @TeamName: your goal for a specific team.',
        handled: true,
      };
    }
  }

  const goal = body.trim();
  if (!goal) {
    return {
      reply: 'Add a goal after @ (default team) or use @TeamName: your goal',
      handled: true,
    };
  }

  try {
    await teamsService.getTeam(team.id, connector.orgId);
  } catch (err) {
    if (err instanceof TeamNotFoundError) {
      return { reply: 'Team not found in this workspace.', handled: true };
    }
    throw err;
  }

  const { run } = await launchTeamRun({
    teamId: team.id,
    orgId: connector.orgId,
    userId: connector.userId,
    goal,
    source: { channel: 'whatsapp', connectorId: connector.id },
  });

  return {
    reply: `Queued — ${team.name} (run ${run.id.slice(0, 10)}…). Reply here to steer mid-run; !status · !cancel`,
    handled: true,
  };
}
