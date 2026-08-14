import {
  slidesCreatePresentation,
  slidesGetPresentation,
  slidesInsertTextBox,
  slidesReplaceAllText,
} from './slidesApi.service.js';
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

export type SlidesReadAction = 'get';
export type SlidesWriteAction = 'create' | 'replace_all' | 'insert_text';

export async function executeSlidesRead(params: {
  agentId: string;
  runId: string | null;
  input: { action: SlidesReadAction; presentationId?: string };
}): Promise<Record<string, unknown>> {
  return runGoogleWorkspaceRead({
    agentId: params.agentId,
    runId: params.runId,
    serviceId: 'slides',
    readScope: 'slides.read',
    writeScope: 'slides.write',
    action: params.input.action,
    dispatch: async (accessToken) => {
      if (!params.input.presentationId?.trim()) {
        throw new GoogleToolError('presentationId is required for action=get');
      }
      return {
        ...(await slidesGetPresentation({
          accessToken,
          presentationId: params.input.presentationId.trim(),
        })),
      };
    },
  });
}

export async function executeSlidesWrite(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: SlidesWriteAction;
    presentationId?: string;
    title?: string;
    text?: string;
    findText?: string;
    replaceText?: string;
    matchCase?: boolean;
    pageObjectId?: string;
    jitToken?: string | null;
  };
}): Promise<Record<string, unknown>> {
  return runGoogleWorkspaceWrite({
    agentId: params.agentId,
    runId: params.runId,
    serviceId: 'slides',
    writeScope: 'slides.write',
    action: params.input.action,
    jitToken: params.input.jitToken,
    dispatch: async (accessToken) => {
      if (params.input.action === 'create') {
        if (!params.input.title?.trim()) {
          throw new GoogleToolError('title is required for action=create');
        }
        return {
          ...(await slidesCreatePresentation({
            accessToken,
            title: params.input.title.trim(),
          })),
        };
      }
      if (!params.input.presentationId?.trim()) {
        throw new GoogleToolError('presentationId is required for this action');
      }
      if (params.input.action === 'insert_text') {
        if (!params.input.text?.trim()) {
          throw new GoogleToolError('text is required for action=insert_text');
        }
        return {
          ...(await slidesInsertTextBox({
            accessToken,
            presentationId: params.input.presentationId.trim(),
            text: params.input.text,
            pageObjectId: params.input.pageObjectId,
          })),
        };
      }
      if (!params.input.findText?.trim()) {
        throw new GoogleToolError('findText is required for action=replace_all');
      }
      return {
        ...(await slidesReplaceAllText({
          accessToken,
          presentationId: params.input.presentationId.trim(),
          findText: params.input.findText,
          replaceText: params.input.replaceText ?? '',
          matchCase: params.input.matchCase,
        })),
      };
    },
  });
}
