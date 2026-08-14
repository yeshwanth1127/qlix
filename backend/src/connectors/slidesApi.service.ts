/**
 * Google Slides API v1 client. Pure functions — scope/JIT/audit live in slidesTool.service.
 */
import { googleApiFetch, GoogleApiError } from './googleApiFetch.js';

export { GoogleApiError as SlidesApiError };

const SLIDES_API = 'https://slides.googleapis.com/v1';

export async function slidesGetPresentation(params: {
  accessToken: string;
  presentationId: string;
}): Promise<{
  presentationId: string;
  title: string;
  slideCount: number;
  slides: Array<{ objectId: string; texts: string[] }>;
}> {
  const body = await googleApiFetch(
    params.accessToken,
    `${SLIDES_API}/presentations/${encodeURIComponent(params.presentationId)}`,
  );
  const slidesRaw = Array.isArray(body.slides) ? body.slides : [];
  return {
    presentationId: String(body.presentationId ?? params.presentationId),
    title: String(body.title ?? ''),
    slideCount: slidesRaw.length,
    slides: slidesRaw.map((s) => {
      const slide = s as {
        objectId?: string;
        pageElements?: Array<{ shape?: { text?: { textElements?: Array<{ textRun?: { content?: string } }> } } }>;
      };
      const texts: string[] = [];
      for (const el of slide.pageElements ?? []) {
        for (const te of el.shape?.text?.textElements ?? []) {
          const c = te.textRun?.content?.trim();
          if (c) texts.push(c);
        }
      }
      return { objectId: String(slide.objectId ?? ''), texts };
    }),
  };
}

export async function slidesCreatePresentation(params: {
  accessToken: string;
  title: string;
}): Promise<{ presentationId: string; title: string }> {
  const body = await googleApiFetch(params.accessToken, `${SLIDES_API}/presentations`, {
    method: 'POST',
    body: JSON.stringify({ title: params.title }),
  });
  const presentationId = String(body.presentationId ?? '');
  if (!presentationId) throw new GoogleApiError('Slides create returned no presentationId');
  return { presentationId, title: String(body.title ?? params.title) };
}

export async function slidesReplaceAllText(params: {
  accessToken: string;
  presentationId: string;
  findText: string;
  replaceText: string;
  matchCase?: boolean;
}): Promise<{ presentationId: string; occurrencesChanged: number }> {
  const body = await googleApiFetch(
    params.accessToken,
    `${SLIDES_API}/presentations/${encodeURIComponent(params.presentationId)}:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            replaceAllText: {
              containsText: {
                text: params.findText,
                matchCase: Boolean(params.matchCase),
              },
              replaceText: params.replaceText,
            },
          },
        ],
      }),
    },
  );
  const replies = Array.isArray(body.replies) ? body.replies : [];
  const first = replies[0] as { replaceAllText?: { occurrencesChanged?: number } } | undefined;
  return {
    presentationId: params.presentationId,
    occurrencesChanged: Number(first?.replaceAllText?.occurrencesChanged ?? 0),
  };
}

export async function slidesInsertTextBox(params: {
  accessToken: string;
  presentationId: string;
  text: string;
  pageObjectId?: string;
}): Promise<{ presentationId: string; objectId: string }> {
  let pageObjectId = params.pageObjectId?.trim();
  if (!pageObjectId) {
    const meta = await slidesGetPresentation({
      accessToken: params.accessToken,
      presentationId: params.presentationId,
    });
    pageObjectId = meta.slides[0]?.objectId;
  }
  if (!pageObjectId) throw new GoogleApiError('Presentation has no slides to insert into');

  const objectId = `textbox_${Date.now().toString(36)}`;
  await googleApiFetch(
    params.accessToken,
    `${SLIDES_API}/presentations/${encodeURIComponent(params.presentationId)}:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            createShape: {
              objectId,
              shapeType: 'TEXT_BOX',
              elementProperties: {
                pageObjectId,
                size: {
                  width: { magnitude: 400, unit: 'PT' },
                  height: { magnitude: 100, unit: 'PT' },
                },
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  translateX: 50,
                  translateY: 50,
                  unit: 'PT',
                },
              },
            },
          },
          {
            insertText: {
              objectId,
              insertionIndex: 0,
              text: params.text,
            },
          },
        ],
      }),
    },
  );
  return { presentationId: params.presentationId, objectId };
}
