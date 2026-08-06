/**
 * Gateway drain mode — reject new ingress during deploy shutdown (OpenClaw drain).
 */

let draining = false;

export function isGatewayDraining(): boolean {
  return draining;
}

export function beginGatewayDrain(): void {
  draining = true;
  console.info('[gateway] drain mode ON — rejecting new inbound turns');
}

export function endGatewayDrain(): void {
  draining = false;
}

export class GatewayDrainingError extends Error {
  readonly code = 'gateway_draining';
  constructor() {
    super('Gateway is draining for deploy — retry shortly');
  }
}
