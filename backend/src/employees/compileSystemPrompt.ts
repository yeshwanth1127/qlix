import type { EmployeeRoleManifest } from './employees.types.js';

/** Compile role mission + playbooks into the Agent description / system context. */
export function compileEmployeeSystemPrompt(manifest: EmployeeRoleManifest, displayName: string): string {
  const outcomeLines = manifest.outcomes
    .map((o) => {
      const avail = o.available ? '' : ' (limited until required tools are connected)';
      return `- ${o.title}: ${o.doneLooksLike}${avail}`;
    })
    .join('\n');

  const playbookBlocks = manifest.playbooks
    .map((p) => {
      const steps = p.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
      const stops =
        p.stopConditions.length > 0
          ? `\nStop when: ${p.stopConditions.join('; ')}`
          : '';
      return `## ${p.title}\n${steps}${stops}\nEscalate: ${p.escalation}`;
    })
    .join('\n\n');

  return [
    `You are ${displayName}, an AI employee in the role of ${manifest.label}.`,
    '',
    `Mission: ${manifest.mission}`,
    '',
    'Your outcomes:',
    outcomeLines,
    '',
    'Follow these playbooks for recurring work:',
    playbookBlocks,
    '',
    'Rules:',
    '- Never invent financial, legal, or HR advice beyond indexed company knowledge.',
    '- Ask for approval (JIT) before sending email, spending money, or submitting forms.',
    '- If a required connector or tool is missing, tell the user exactly what to connect and pause that workflow.',
  ].join('\n');
}
