/**
 * Shared read/write runner for Google Workspace product tools (Docs/Sheets/Slides/Forms).
 */
import { GoogleApiError } from './googleApiFetch.js';
import {
  appendGoogleActionLog,
  effectiveGoogleScopes,
  getFreshGoogleAccessToken,
  GoogleConnectorNotConfiguredError,
  GoogleScopeDeniedError,
  GoogleToolError,
  loadGoogleAgentRunContext,
  requireGoogleJitIfNeeded,
  type GoogleWorkspaceActionType,
} from './googleToolContext.js';
import type { GoogleServiceId } from './googleServices.js';

export {
  GoogleConnectorNotConfiguredError,
  GoogleScopeDeniedError,
  GoogleToolError,
};

export async function runGoogleWorkspaceRead(params: {
  agentId: string;
  runId: string | null;
  serviceId: GoogleServiceId;
  readScope: GoogleWorkspaceActionType;
  writeScope: GoogleWorkspaceActionType;
  action: string;
  dispatch: (accessToken: string) => Promise<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  const ctx = await loadGoogleAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveGoogleScopes(ctx);
  if (!scopes.has(params.readScope) && !scopes.has(params.writeScope)) {
    throw new GoogleScopeDeniedError(params.readScope);
  }
  if (!ctx.orgId) {
    throw new GoogleConnectorNotConfiguredError(
      params.serviceId,
      'Agent must belong to an organization',
    );
  }

  const accessToken = await getFreshGoogleAccessToken(ctx.orgId, params.serviceId);
  try {
    const result = await params.dispatch(accessToken);
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: params.readScope,
      status: 'success',
      riskLevel: 'low',
      teamRunId: ctx.teamRunId,
      payload: { action: params.action },
    });
    return result;
  } catch (err) {
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: params.readScope,
      status: 'failed',
      riskLevel: 'low',
      teamRunId: ctx.teamRunId,
      payload: { action: params.action, error: String((err as Error)?.message ?? err) },
    });
    if (
      err instanceof GoogleToolError ||
      err instanceof GoogleScopeDeniedError ||
      err instanceof GoogleConnectorNotConfiguredError
    ) {
      throw err;
    }
    throw new GoogleToolError(
      err instanceof GoogleApiError ? err.message : String((err as Error)?.message ?? err),
    );
  }
}

export async function runGoogleWorkspaceWrite(params: {
  agentId: string;
  runId: string | null;
  serviceId: GoogleServiceId;
  writeScope: GoogleWorkspaceActionType;
  action: string;
  jitToken?: string | null;
  dispatch: (accessToken: string) => Promise<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  const ctx = await loadGoogleAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveGoogleScopes(ctx);
  if (!scopes.has(params.writeScope)) throw new GoogleScopeDeniedError(params.writeScope);
  if (!ctx.orgId) {
    throw new GoogleConnectorNotConfiguredError(
      params.serviceId,
      'Agent must belong to an organization',
    );
  }

  await requireGoogleJitIfNeeded({
    agentId: params.agentId,
    runId: params.runId,
    ctx,
    actionType: params.writeScope,
    jitToken: params.jitToken,
  });

  const accessToken = await getFreshGoogleAccessToken(ctx.orgId, params.serviceId);
  try {
    const result = await params.dispatch(accessToken);
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: params.writeScope,
      status: 'success',
      riskLevel: 'medium',
      teamRunId: ctx.teamRunId,
      payload: { action: params.action },
    });
    return result;
  } catch (err) {
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: params.writeScope,
      status: 'failed',
      riskLevel: 'medium',
      teamRunId: ctx.teamRunId,
      payload: { action: params.action, error: String((err as Error)?.message ?? err) },
    });
    if (
      err instanceof GoogleToolError ||
      err instanceof GoogleScopeDeniedError ||
      err instanceof GoogleConnectorNotConfiguredError
    ) {
      throw err;
    }
    throw new GoogleToolError(
      err instanceof GoogleApiError ? err.message : String((err as Error)?.message ?? err),
    );
  }
}
