import { ConversationPluginRegistry } from './conversationPlugins.js';
import { registerAssessmentConversationPlugins } from '../assessment/assessmentConversationPlugins.js';
import { registerWhatsAppConversationPlugins } from '../whatsapp/whatsappConversationChannel.js';

/**
 * App-wide composed registry for the conversation engine's generic outbox path.
 * Each domain registers its own actions/channels here; the registry itself stays
 * domain-free. Team wait follow-ups deliver through the same channel adapters.
 */
export const conversationPluginRegistry = new ConversationPluginRegistry();

registerAssessmentConversationPlugins(conversationPluginRegistry);
registerWhatsAppConversationPlugins(conversationPluginRegistry);
