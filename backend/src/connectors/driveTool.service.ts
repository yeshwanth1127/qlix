import {
  driveCreateFile,
  driveDeleteFile,
  driveGetFileContent,
  driveGetFileMeta,
  driveListFiles,
  driveUpdateFile,
  DriveApiError,
} from './driveApi.service.js';
import {
  DriveProviderNotAvailableError,
  DriveProviderSelectionRequiredError,
  resolveDriveSession,
  type DriveProviderId,
} from './driveConnector.service.js';
import {
  appendGoogleActionLog,
  effectiveGoogleScopes,
  GoogleConnectorNotConfiguredError,
  GoogleScopeDeniedError,
  GoogleToolError,
  loadGoogleAgentRunContext,
  requireGoogleJitIfNeeded,
} from './googleToolContext.js';
import { driveConnectorNotConnectedMessage } from './connectorUserMessages.js';
import {
  oneDriveCreateFile,
  oneDriveDeleteFile,
  oneDriveGetFileContent,
  oneDriveGetFileMeta,
  oneDriveListFiles,
  oneDriveUpdateFile,
  OneDriveApiError,
} from './onedriveApi.service.js';

export {
  GoogleConnectorNotConfiguredError,
  GoogleScopeDeniedError,
  GoogleToolError,
  DriveProviderSelectionRequiredError,
  DriveProviderNotAvailableError,
};

export type DriveReadAction = 'list' | 'get' | 'get_content';
export type DriveWriteAction = 'create' | 'update' | 'delete';

async function requireDriveSession(orgId: string | null, provider?: DriveProviderId) {
  if (!orgId) {
    throw new GoogleConnectorNotConfiguredError('drive', 'Agent must belong to an organization');
  }
  const session = await resolveDriveSession({ orgId, provider });
  if (!session) {
    throw new GoogleConnectorNotConfiguredError('drive', driveConnectorNotConnectedMessage());
  }
  return session;
}

export async function executeDriveRead(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: DriveReadAction;
    provider?: DriveProviderId;
    query?: string;
    fileId?: string;
    pageSize?: number;
    pageToken?: string | null;
  };
}): Promise<Record<string, unknown>> {
  const ctx = await loadGoogleAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveGoogleScopes(ctx);
  if (!scopes.has('drive.read') && !scopes.has('drive.write')) {
    throw new GoogleScopeDeniedError('drive.read');
  }

  const session = await requireDriveSession(ctx.orgId, params.input.provider);
  try {
    let result: Record<string, unknown>;
    const asRecord = (v: object): Record<string, unknown> => ({ ...v });

    if (session.provider === 'microsoft') {
      if (params.input.action === 'list') {
        result = asRecord(
          await oneDriveListFiles({
            accessToken: session.accessToken,
            query: params.input.query,
            pageSize: params.input.pageSize,
            pageToken: params.input.pageToken,
          }),
        );
      } else if (params.input.action === 'get') {
        if (!params.input.fileId?.trim()) throw new GoogleToolError('fileId is required for action=get');
        result = asRecord(
          await oneDriveGetFileMeta({
            accessToken: session.accessToken,
            fileId: params.input.fileId.trim(),
          }),
        );
      } else {
        if (!params.input.fileId?.trim()) {
          throw new GoogleToolError('fileId is required for action=get_content');
        }
        result = asRecord(
          await oneDriveGetFileContent({
            accessToken: session.accessToken,
            fileId: params.input.fileId.trim(),
          }),
        );
      }
    } else if (params.input.action === 'list') {
      result = asRecord(
        await driveListFiles({
          accessToken: session.accessToken,
          query: params.input.query,
          pageSize: params.input.pageSize,
          pageToken: params.input.pageToken,
        }),
      );
    } else if (params.input.action === 'get') {
      if (!params.input.fileId?.trim()) throw new GoogleToolError('fileId is required for action=get');
      result = asRecord(
        await driveGetFileMeta({
          accessToken: session.accessToken,
          fileId: params.input.fileId.trim(),
        }),
      );
    } else {
      if (!params.input.fileId?.trim()) {
        throw new GoogleToolError('fileId is required for action=get_content');
      }
      result = asRecord(
        await driveGetFileContent({
          accessToken: session.accessToken,
          fileId: params.input.fileId.trim(),
        }),
      );
    }

    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'drive.read',
      status: 'success',
      riskLevel: 'low',
      teamRunId: ctx.teamRunId,
      payload: {
        provider: session.provider,
        action: params.input.action,
        fileId: params.input.fileId ?? null,
      },
    });
    return { provider: session.provider, ...result };
  } catch (err) {
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'drive.read',
      status: 'failed',
      riskLevel: 'low',
      teamRunId: ctx.teamRunId,
      payload: {
        provider: session.provider,
        action: params.input.action,
        error: String((err as Error)?.message ?? err),
      },
    });
    if (
      err instanceof GoogleToolError ||
      err instanceof GoogleScopeDeniedError ||
      err instanceof GoogleConnectorNotConfiguredError ||
      err instanceof DriveProviderSelectionRequiredError ||
      err instanceof DriveProviderNotAvailableError
    ) {
      throw err;
    }
    throw new GoogleToolError(
      err instanceof DriveApiError || err instanceof OneDriveApiError
        ? err.message
        : String((err as Error)?.message ?? err),
    );
  }
}

export async function executeDriveWrite(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: DriveWriteAction;
    provider?: DriveProviderId;
    fileId?: string;
    name?: string;
    contentText?: string;
    mimeType?: string;
    parentId?: string | null;
    jitToken?: string | null;
  };
}): Promise<Record<string, unknown>> {
  const ctx = await loadGoogleAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveGoogleScopes(ctx);
  if (!scopes.has('drive.write')) throw new GoogleScopeDeniedError('drive.write');

  // Resolve provider first (may require user choice) — same order as email tools.
  const session = await requireDriveSession(ctx.orgId, params.input.provider);

  await requireGoogleJitIfNeeded({
    agentId: params.agentId,
    runId: params.runId,
    ctx,
    actionType: 'drive.write',
    jitToken: params.input.jitToken,
  });

  try {
    let result: Record<string, unknown>;
    const asRecord = (v: object): Record<string, unknown> => ({ ...v });

    if (session.provider === 'microsoft') {
      if (params.input.action === 'create') {
        if (!params.input.name?.trim()) throw new GoogleToolError('name is required for action=create');
        result = asRecord(
          await oneDriveCreateFile({
            accessToken: session.accessToken,
            name: params.input.name.trim(),
            contentText: params.input.contentText,
            mimeType: params.input.mimeType,
            parentId: params.input.parentId,
          }),
        );
      } else if (params.input.action === 'update') {
        if (!params.input.fileId?.trim()) throw new GoogleToolError('fileId is required for action=update');
        result = asRecord(
          await oneDriveUpdateFile({
            accessToken: session.accessToken,
            fileId: params.input.fileId.trim(),
            name: params.input.name,
            contentText: params.input.contentText,
            mimeType: params.input.mimeType,
          }),
        );
      } else {
        if (!params.input.fileId?.trim()) throw new GoogleToolError('fileId is required for action=delete');
        result = asRecord(
          await oneDriveDeleteFile({
            accessToken: session.accessToken,
            fileId: params.input.fileId.trim(),
          }),
        );
      }
    } else if (params.input.action === 'create') {
      if (!params.input.name?.trim()) throw new GoogleToolError('name is required for action=create');
      result = asRecord(
        await driveCreateFile({
          accessToken: session.accessToken,
          name: params.input.name.trim(),
          contentText: params.input.contentText,
          mimeType: params.input.mimeType,
          parentId: params.input.parentId,
        }),
      );
    } else if (params.input.action === 'update') {
      if (!params.input.fileId?.trim()) throw new GoogleToolError('fileId is required for action=update');
      result = asRecord(
        await driveUpdateFile({
          accessToken: session.accessToken,
          fileId: params.input.fileId.trim(),
          name: params.input.name,
          contentText: params.input.contentText,
          mimeType: params.input.mimeType,
        }),
      );
    } else {
      if (!params.input.fileId?.trim()) throw new GoogleToolError('fileId is required for action=delete');
      result = asRecord(
        await driveDeleteFile({
          accessToken: session.accessToken,
          fileId: params.input.fileId.trim(),
        }),
      );
    }

    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'drive.write',
      status: 'success',
      riskLevel: 'high',
      teamRunId: ctx.teamRunId,
      payload: {
        provider: session.provider,
        action: params.input.action,
        fileId: (result.id as string | undefined) ?? params.input.fileId ?? null,
        name: params.input.name ?? null,
      },
    });
    return { provider: session.provider, ...result };
  } catch (err) {
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'drive.write',
      status: 'failed',
      riskLevel: 'high',
      teamRunId: ctx.teamRunId,
      payload: {
        provider: session.provider,
        action: params.input.action,
        error: String((err as Error)?.message ?? err),
      },
    });
    if (
      err instanceof GoogleToolError ||
      err instanceof GoogleScopeDeniedError ||
      err instanceof GoogleConnectorNotConfiguredError ||
      err instanceof DriveProviderSelectionRequiredError ||
      err instanceof DriveProviderNotAvailableError
    ) {
      throw err;
    }
    throw new GoogleToolError(
      err instanceof DriveApiError || err instanceof OneDriveApiError
        ? err.message
        : String((err as Error)?.message ?? err),
    );
  }
}
