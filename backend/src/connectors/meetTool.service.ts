import {
  meetCreateSpace,
  meetEndActiveConference,
  meetGetSpace,
  MeetApiError,
} from './meetApi.service.js';
import {
  appendGoogleActionLog,
  effectiveGoogleScopes,
  getFreshGoogleAccessToken,
  GoogleConnectorNotConfiguredError,
  GoogleScopeDeniedError,
  GoogleToolError,
  loadGoogleAgentRunContext,
  requireGoogleJitIfNeeded,
} from './googleToolContext.js';

export {
  GoogleConnectorNotConfiguredError,
  GoogleScopeDeniedError,
  GoogleToolError,
};

export type MeetManageAction = 'create' | 'get' | 'end';

export async function executeMeetManage(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: MeetManageAction;
    name?: string;
    jitToken?: string | null;
  };
}): Promise<Record<string, unknown>> {
  const ctx = await loadGoogleAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveGoogleScopes(ctx);
  if (!scopes.has('meet.manage')) throw new GoogleScopeDeniedError('meet.manage');
  if (!ctx.orgId) throw new GoogleConnectorNotConfiguredError('meet', 'Agent must belong to an organization');

  // create/end are mutating; get is read-only but still under meet.manage (single scope).
  if (params.input.action !== 'get') {
    await requireGoogleJitIfNeeded({
      agentId: params.agentId,
      runId: params.runId,
      ctx,
      actionType: 'meet.manage',
      jitToken: params.input.jitToken,
    });
  }

  const accessToken = await getFreshGoogleAccessToken(ctx.orgId, 'meet');
  try {
    let result: Record<string, unknown>;
    const asRecord = (v: object): Record<string, unknown> => ({ ...v });
    if (params.input.action === 'create') {
      result = asRecord(await meetCreateSpace({ accessToken }));
    } else if (params.input.action === 'get') {
      if (!params.input.name?.trim()) throw new GoogleToolError('name is required for action=get');
      result = asRecord(await meetGetSpace({ accessToken, name: params.input.name.trim() }));
    } else {
      if (!params.input.name?.trim()) throw new GoogleToolError('name is required for action=end');
      result = asRecord(await meetEndActiveConference({
        accessToken,
        name: params.input.name.trim(),
      }));
    }
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'meet.manage',
      status: 'success',
      riskLevel: params.input.action === 'get' ? 'low' : 'high',
      teamRunId: ctx.teamRunId,
      payload: {
        action: params.input.action,
        name: (result.name as string | undefined) ?? params.input.name ?? null,
        meetingUri: (result.meetingUri as string | undefined) ?? null,
      },
    });
    return result;
  } catch (err) {
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'meet.manage',
      status: 'failed',
      riskLevel: params.input.action === 'get' ? 'low' : 'high',
      teamRunId: ctx.teamRunId,
      payload: { action: params.input.action, error: String((err as Error)?.message ?? err) },
    });
    if (
      err instanceof GoogleToolError ||
      err instanceof GoogleScopeDeniedError ||
      err instanceof GoogleConnectorNotConfiguredError
    ) {
      throw err;
    }
    throw new GoogleToolError(
      err instanceof MeetApiError ? err.message : String((err as Error)?.message ?? err),
    );
  }
}
