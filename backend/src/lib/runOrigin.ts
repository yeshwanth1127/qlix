import type { Request } from 'express';

export function inboundChannelFromAuth(authMethod?: 'session' | 'api_key'): 'web' | 'api' {
  return authMethod === 'api_key' ? 'api' : 'web';
}

export function inboundChannelFromRequest(request: Request): 'web' | 'api' {
  return inboundChannelFromAuth(request.auth?.authMethod);
}
