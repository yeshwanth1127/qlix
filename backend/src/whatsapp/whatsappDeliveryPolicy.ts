/**
 * Where a finished agent run should land on WhatsApp.
 *
 * Contact auto-reply runs must never dump inference errors (e.g. HTTP 502)
 * into the lead's chat. The agent is expected to reply via whatsapp_send_message;
 * if that already happened, skip the completion dump entirely.
 */
export type WhatsAppRunDeliveryMode = 'contact' | 'self' | 'none';

export function resolveWhatsAppRunDelivery(input: {
  replyToJid?: string | null;
  success: boolean;
  alreadySentToContact?: boolean;
}): WhatsAppRunDeliveryMode {
  const jid = input.replyToJid?.trim();
  if (!jid) return 'self';
  if (!input.success) return 'self';
  if (input.alreadySentToContact) return 'none';
  return 'contact';
}

export function autoReplyOwnerFailureNotice(input: {
  agentName: string;
  contactJid: string;
}): { title: string; body: string } {
  const local = input.contactJid.split('@')[0]?.split(':')[0] || input.contactJid;
  return {
    title: `${input.agentName} auto-reply`,
    body:
      `Could not auto-reply to ${local}. The contact was not sent this error — ` +
      'open the agent chat for details.',
  };
}

/** Prefer OpenRouter for contact auto-reply when the agent home model is Exora. */
export function autoReplyInferenceOverride(agent: {
  llmModel?: string | null;
  llmProvider?: string | null;
}): string | null {
  const model = (agent.llmModel ?? '').trim().toLowerCase();
  const provider = (agent.llmProvider ?? '').trim().toLowerCase();
  if (provider === 'exora' || model.startsWith('exora/')) {
    return 'openrouter/openai/gpt-4o-mini';
  }
  return null;
}
