/**
 * Parse optional flags on WhatsApp inbound text before @Agent routing.
 * Example: `@local #brain: check logs per policy and open AgentDebug.log`
 */

export type WhatsAppRunModifiers = {
  useBrain: boolean;
  /** Text after stripping modifier tokens (may still include @Agent: prefix). */
  text: string;
};

const BRAIN_FLAG = /(?:^|\s)(?:#brain|\+brain)\b/gi;

export function parseWhatsAppRunModifiers(raw: string): WhatsAppRunModifiers {
  let useBrain = false;
  let text = raw.trim();
  if (BRAIN_FLAG.test(text)) {
    useBrain = true;
    text = text.replace(BRAIN_FLAG, ' ').replace(/\s+/g, ' ').trim();
    // `@local #brain:` → `@local : …` — normalize before @Agent: parsing
    text = text.replace(/@(\S+)\s+:/g, '@$1:');
  }
  return { useBrain, text };
}

/** Enable brain when explicitly flagged or agent has scope and prompt asks for policy/brain context. */
export function resolveUseBrainForWhatsAppRun(input: {
  modifierFlag: boolean;
  prompt: string;
  permissionScopes: string[];
}): boolean {
  if (input.modifierFlag) return true;
  if (!input.permissionScopes.includes('brain.query')) return false;
  return /\b(brain|policy|policies|playbook|compliance|underwriting|knowledge base)\b/i.test(
    input.prompt,
  );
}
