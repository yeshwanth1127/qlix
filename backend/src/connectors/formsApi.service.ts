/**
 * Google Forms API v1 client. Pure functions — scope/JIT/audit live in formsTool.service.
 */
import { googleApiFetch, GoogleApiError } from './googleApiFetch.js';

export { GoogleApiError as FormsApiError };

const FORMS_API = 'https://forms.googleapis.com/v1';

export async function formsGetForm(params: {
  accessToken: string;
  formId: string;
}): Promise<{
  formId: string;
  title: string;
  description: string;
  responderUri: string;
  items: Array<{ itemId: string; title: string; type: string }>;
}> {
  const body = await googleApiFetch(
    params.accessToken,
    `${FORMS_API}/forms/${encodeURIComponent(params.formId)}`,
  );
  const info = (body.info as { title?: string; description?: string } | undefined) ?? {};
  const itemsRaw = Array.isArray(body.items) ? body.items : [];
  return {
    formId: String(body.formId ?? params.formId),
    title: String(info.title ?? ''),
    description: String(info.description ?? ''),
    responderUri: String(body.responderUri ?? ''),
    items: itemsRaw.map((raw) => {
      const item = raw as Record<string, unknown>;
      let type = 'unknown';
      if (item.questionItem) type = 'question';
      else if (item.pageBreakItem) type = 'pageBreak';
      else if (item.textItem) type = 'text';
      else if (item.imageItem) type = 'image';
      else if (item.videoItem) type = 'video';
      return {
        itemId: String(item.itemId ?? ''),
        title: String(item.title ?? ''),
        type,
      };
    }),
  };
}

export async function formsListResponses(params: {
  accessToken: string;
  formId: string;
  pageSize?: number;
  pageToken?: string;
}): Promise<{
  formId: string;
  responses: Array<{
    responseId: string;
    createTime: string;
    lastSubmittedTime: string;
    answers: Record<string, string[]>;
  }>;
  nextPageToken: string | null;
}> {
  const qs = new URLSearchParams();
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.pageToken) qs.set('pageToken', params.pageToken);
  const suffix = qs.toString() ? `?${qs}` : '';
  const body = await googleApiFetch(
    params.accessToken,
    `${FORMS_API}/forms/${encodeURIComponent(params.formId)}/responses${suffix}`,
  );
  const responsesRaw = Array.isArray(body.responses) ? body.responses : [];
  return {
    formId: params.formId,
    responses: responsesRaw.map((raw) => {
      const r = raw as {
        responseId?: string;
        createTime?: string;
        lastSubmittedTime?: string;
        answers?: Record<
          string,
          { textAnswers?: { answers?: Array<{ value?: string }> } }
        >;
      };
      const answers: Record<string, string[]> = {};
      for (const [qid, ans] of Object.entries(r.answers ?? {})) {
        answers[qid] = (ans.textAnswers?.answers ?? [])
          .map((a) => a.value)
          .filter((v): v is string => Boolean(v));
      }
      return {
        responseId: String(r.responseId ?? ''),
        createTime: String(r.createTime ?? ''),
        lastSubmittedTime: String(r.lastSubmittedTime ?? ''),
        answers,
      };
    }),
    nextPageToken: typeof body.nextPageToken === 'string' ? body.nextPageToken : null,
  };
}

export async function formsCreateForm(params: {
  accessToken: string;
  title: string;
  description?: string;
}): Promise<{ formId: string; title: string; responderUri: string }> {
  const body = await googleApiFetch(params.accessToken, `${FORMS_API}/forms`, {
    method: 'POST',
    body: JSON.stringify({ info: { title: params.title } }),
  });
  const formId = String(body.formId ?? '');
  if (!formId) throw new GoogleApiError('Forms create returned no formId');

  if (params.description?.trim()) {
    await formsUpdateInfo({
      accessToken: params.accessToken,
      formId,
      title: params.title,
      description: params.description.trim(),
    });
  }

  const fresh = await formsGetForm({ accessToken: params.accessToken, formId });
  return { formId, title: fresh.title, responderUri: fresh.responderUri };
}

export async function formsUpdateInfo(params: {
  accessToken: string;
  formId: string;
  title?: string;
  description?: string;
}): Promise<{ formId: string; title: string; description: string }> {
  const info: Record<string, string> = {};
  const paths: string[] = [];
  if (params.title !== undefined) {
    info.title = params.title;
    paths.push('info.title');
  }
  if (params.description !== undefined) {
    info.description = params.description;
    paths.push('info.description');
  }
  if (!paths.length) throw new GoogleApiError('title or description is required for update');

  await googleApiFetch(
    params.accessToken,
    `${FORMS_API}/forms/${encodeURIComponent(params.formId)}:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ updateFormInfo: { info, updateMask: paths.join(',') } }],
      }),
    },
  );
  const fresh = await formsGetForm({ accessToken: params.accessToken, formId: params.formId });
  return { formId: fresh.formId, title: fresh.title, description: fresh.description };
}

export async function formsAddTextQuestion(params: {
  accessToken: string;
  formId: string;
  title: string;
  required?: boolean;
}): Promise<{ formId: string; itemId: string }> {
  const body = await googleApiFetch(
    params.accessToken,
    `${FORMS_API}/forms/${encodeURIComponent(params.formId)}:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            createItem: {
              item: {
                title: params.title,
                questionItem: {
                  question: {
                    required: Boolean(params.required),
                    textQuestion: {},
                  },
                },
              },
              location: { index: 0 },
            },
          },
        ],
      }),
    },
  );
  const replies = Array.isArray(body.replies) ? body.replies : [];
  const first = replies[0] as { createItem?: { itemId?: string } } | undefined;
  return {
    formId: params.formId,
    itemId: String(first?.createItem?.itemId ?? ''),
  };
}
