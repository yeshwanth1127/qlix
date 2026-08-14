import {
  docsAppendText,
  docsCreateDocument,
  docsGetDocument,
  docsReplaceAllText,
} from './docsApi.service.js';
import {
  GoogleConnectorNotConfiguredError,
  GoogleScopeDeniedError,
  GoogleToolError,
  runGoogleWorkspaceRead,
  runGoogleWorkspaceWrite,
} from './googleWorkspaceToolRunner.js';

export {
  GoogleConnectorNotConfiguredError,
  GoogleScopeDeniedError,
  GoogleToolError,
};

export type DocsReadAction = 'get';
export type DocsWriteAction = 'create' | 'append' | 'replace_all';

export async function executeDocsRead(params: {
  agentId: string;
  runId: string | null;
  input: { action: DocsReadAction; documentId?: string };
}): Promise<Record<string, unknown>> {
  return runGoogleWorkspaceRead({
    agentId: params.agentId,
    runId: params.runId,
    serviceId: 'docs',
    readScope: 'docs.read',
    writeScope: 'docs.write',
    action: params.input.action,
    dispatch: async (accessToken) => {
      if (!params.input.documentId?.trim()) {
        throw new GoogleToolError('documentId is required for action=get');
      }
      return {
        ...(await docsGetDocument({
          accessToken,
          documentId: params.input.documentId.trim(),
        })),
      };
    },
  });
}

export async function executeDocsWrite(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: DocsWriteAction;
    documentId?: string;
    title?: string;
    text?: string;
    findText?: string;
    replaceText?: string;
    matchCase?: boolean;
    jitToken?: string | null;
  };
}): Promise<Record<string, unknown>> {
  return runGoogleWorkspaceWrite({
    agentId: params.agentId,
    runId: params.runId,
    serviceId: 'docs',
    writeScope: 'docs.write',
    action: params.input.action,
    jitToken: params.input.jitToken,
    dispatch: async (accessToken) => {
      if (params.input.action === 'create') {
        if (!params.input.title?.trim()) {
          throw new GoogleToolError('title is required for action=create');
        }
        return {
          ...(await docsCreateDocument({
            accessToken,
            title: params.input.title.trim(),
            initialText: params.input.text,
          })),
        };
      }
      if (!params.input.documentId?.trim()) {
        throw new GoogleToolError('documentId is required for this action');
      }
      if (params.input.action === 'append') {
        if (!params.input.text?.trim()) {
          throw new GoogleToolError('text is required for action=append');
        }
        return {
          ...(await docsAppendText({
            accessToken,
            documentId: params.input.documentId.trim(),
            text: params.input.text,
          })),
        };
      }
      if (!params.input.findText?.trim()) {
        throw new GoogleToolError('findText is required for action=replace_all');
      }
      return {
        ...(await docsReplaceAllText({
          accessToken,
          documentId: params.input.documentId.trim(),
          findText: params.input.findText,
          replaceText: params.input.replaceText ?? '',
          matchCase: params.input.matchCase,
        })),
      };
    },
  });
}
