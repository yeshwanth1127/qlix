import {
  formsAddTextQuestion,
  formsCreateForm,
  formsGetForm,
  formsListResponses,
  formsUpdateInfo,
} from './formsApi.service.js';
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

export type FormsReadAction = 'get' | 'list_responses';
export type FormsWriteAction = 'create' | 'update_info' | 'add_question';

export async function executeFormsRead(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: FormsReadAction;
    formId?: string;
    pageSize?: number;
    pageToken?: string;
  };
}): Promise<Record<string, unknown>> {
  return runGoogleWorkspaceRead({
    agentId: params.agentId,
    runId: params.runId,
    serviceId: 'forms',
    readScope: 'forms.read',
    writeScope: 'forms.write',
    action: params.input.action,
    dispatch: async (accessToken) => {
      if (!params.input.formId?.trim()) {
        throw new GoogleToolError('formId is required');
      }
      if (params.input.action === 'get') {
        return {
          ...(await formsGetForm({
            accessToken,
            formId: params.input.formId.trim(),
          })),
        };
      }
      return {
        ...(await formsListResponses({
          accessToken,
          formId: params.input.formId.trim(),
          pageSize: params.input.pageSize,
          pageToken: params.input.pageToken,
        })),
      };
    },
  });
}

export async function executeFormsWrite(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: FormsWriteAction;
    formId?: string;
    title?: string;
    description?: string;
    questionTitle?: string;
    required?: boolean;
    jitToken?: string | null;
  };
}): Promise<Record<string, unknown>> {
  return runGoogleWorkspaceWrite({
    agentId: params.agentId,
    runId: params.runId,
    serviceId: 'forms',
    writeScope: 'forms.write',
    action: params.input.action,
    jitToken: params.input.jitToken,
    dispatch: async (accessToken) => {
      if (params.input.action === 'create') {
        if (!params.input.title?.trim()) {
          throw new GoogleToolError('title is required for action=create');
        }
        return {
          ...(await formsCreateForm({
            accessToken,
            title: params.input.title.trim(),
            description: params.input.description,
          })),
        };
      }
      if (!params.input.formId?.trim()) {
        throw new GoogleToolError('formId is required for this action');
      }
      if (params.input.action === 'update_info') {
        return {
          ...(await formsUpdateInfo({
            accessToken,
            formId: params.input.formId.trim(),
            title: params.input.title,
            description: params.input.description,
          })),
        };
      }
      if (!params.input.questionTitle?.trim()) {
        throw new GoogleToolError('questionTitle is required for action=add_question');
      }
      return {
        ...(await formsAddTextQuestion({
          accessToken,
          formId: params.input.formId.trim(),
          title: params.input.questionTitle.trim(),
          required: params.input.required,
        })),
      };
    },
  });
}
