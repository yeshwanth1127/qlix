import { webChatAdapter } from './adapters/webChat.adapter.js';
import { whatsappAdapter } from './adapters/whatsapp.adapter.js';
import { slackAdapter } from './adapters/slack.adapter.js';
import { telegramAdapter } from './adapters/telegram.adapter.js';
import { localAdapter } from './adapters/local.adapter.js';
import { gatewayService } from './gatewayService.js';
import { replyDispatcher } from './replyDispatcher.js';
import { registerChannelAdapter } from './pluginSdk.js';

let adaptersRegistered = false;

/** Idempotent adapter registration — call from HTTP bootstrap. */
export function ensureGatewayAdapters(): void {
  if (adaptersRegistered) return;
  registerChannelAdapter(webChatAdapter);
  registerChannelAdapter(whatsappAdapter);
  registerChannelAdapter(slackAdapter);
  registerChannelAdapter(telegramAdapter);
  registerChannelAdapter(localAdapter);
  adaptersRegistered = true;
}

export { gatewayService, replyDispatcher };
export { registerChannelAdapter, getChannelAdapter, listChannelAdapters } from './pluginSdk.js';
export { beginGatewayDrain, isGatewayDraining, GatewayDrainingError } from './drain.js';
export { runEventBus } from './runEventBus.js';
export { buildSessionKey, buildSessionKeyFromInbound, parseSessionKey } from './sessionKey.js';
export { withSessionLane, setActiveRun, clearActiveRun, getActiveRun } from './sessionLane.js';
export { admitTurn } from './admission.js';
export { resolveRoute, GatewayRouteError } from './resolveRoute.js';
export { buildWebChatInbound } from './adapters/webChat.adapter.js';
export { buildWhatsAppInbound, whatsappAdapter } from './adapters/whatsapp.adapter.js';
export { buildTelegramInbound, telegramAdapter } from './adapters/telegram.adapter.js';
export { buildLocalInbound, localAdapter } from './adapters/local.adapter.js';
export { buildTeamInbound } from './adapters/team.adapter.js';
export type {
  InboundMessage,
  GatewayTurnResult,
  DeliveryTarget,
  ResolvedRoute,
  ReplyPayload,
  GatewayChannel,
} from './types.js';
