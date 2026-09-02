/** Outreach plugin capability. `whatsapp.auto_reply` remains a compatibility alias. */
export const CONVERSATION_SCOPE = 'conversation';
export const CONVERSATION_ALIAS_SCOPE = 'whatsapp.auto_reply';
export const OUTREACH_PLUGIN_ID = 'outreach';

export function hasConversationCapability(scopes: Iterable<string>): boolean {
  const set = scopes instanceof Set ? scopes : new Set(scopes);
  return set.has(CONVERSATION_SCOPE) || set.has(CONVERSATION_ALIAS_SCOPE);
}
