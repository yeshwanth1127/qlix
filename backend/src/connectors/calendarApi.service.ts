/**
 * Google Calendar v3 REST client. Pure functions — scope/JIT/audit live in calendarTool.service.
 */
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export class CalendarApiError extends Error {
  readonly code = 'calendar_api_failed';
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function calendarFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${CALENDAR_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await resp.text();
  if (resp.status === 204 || !text) {
    if (!resp.ok) throw new CalendarApiError(`Calendar API ${resp.status}`, resp.status);
    return {};
  }
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text.slice(0, 4000) };
  }
  if (!resp.ok) {
    const apiMsg =
      (body.error as { message?: string } | undefined)?.message ?? text.slice(0, 300);
    throw new CalendarApiError(`Calendar API ${resp.status}: ${apiMsg}`, resp.status);
  }
  return body;
}

export interface CalendarEventSummary {
  id: string;
  status: string;
  summary: string;
  description: string;
  location: string;
  htmlLink: string;
  start: string;
  end: string;
  attendees: string[];
  hangoutLink: string;
  conferenceUri: string;
}

function eventTime(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const v = value as { dateTime?: string; date?: string };
  return v.dateTime || v.date || '';
}

function toEvent(e: Record<string, unknown>): CalendarEventSummary {
  const conf =
    (e.conferenceData as { entryPoints?: Array<{ entryPointType?: string; uri?: string }> })
      ?.entryPoints ?? [];
  const video = conf.find((p) => p.entryPointType === 'video');
  const attendees = Array.isArray(e.attendees)
    ? (e.attendees as Array<{ email?: string }>)
        .map((a) => a.email)
        .filter((x): x is string => Boolean(x))
    : [];
  return {
    id: String(e.id ?? ''),
    status: String(e.status ?? ''),
    summary: String(e.summary ?? ''),
    description: String(e.description ?? ''),
    location: String(e.location ?? ''),
    htmlLink: String(e.htmlLink ?? ''),
    start: eventTime(e.start),
    end: eventTime(e.end),
    attendees,
    hangoutLink: String(e.hangoutLink ?? ''),
    conferenceUri: video?.uri ? String(video.uri) : String(e.hangoutLink ?? ''),
  };
}

function timePayload(value: string): { dateTime?: string; date?: string; timeZone?: string } {
  // All-day: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value };
  return { dateTime: value };
}

export async function calendarListEvents(params: {
  accessToken: string;
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  query?: string;
  maxResults?: number;
}): Promise<{ events: CalendarEventSummary[] }> {
  const calendarId = encodeURIComponent(params.calendarId?.trim() || 'primary');
  const search = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(Math.min(50, Math.max(1, params.maxResults ?? 20))),
  });
  if (params.timeMin) search.set('timeMin', params.timeMin);
  if (params.timeMax) search.set('timeMax', params.timeMax);
  if (params.query?.trim()) search.set('q', params.query.trim());
  if (!params.timeMin) search.set('timeMin', new Date().toISOString());

  const result = await calendarFetch(
    params.accessToken,
    `/calendars/${calendarId}/events?${search}`,
  );
  const events = Array.isArray(result.items)
    ? (result.items as Record<string, unknown>[]).map(toEvent)
    : [];
  return { events };
}

export async function calendarGetEvent(params: {
  accessToken: string;
  eventId: string;
  calendarId?: string;
}): Promise<CalendarEventSummary> {
  const calendarId = encodeURIComponent(params.calendarId?.trim() || 'primary');
  const result = await calendarFetch(
    params.accessToken,
    `/calendars/${calendarId}/events/${encodeURIComponent(params.eventId)}`,
  );
  return toEvent(result);
}

export async function calendarCreateEvent(params: {
  accessToken: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  attendees?: string[];
  calendarId?: string;
  /** When true, attach a Google Meet conference link. */
  createMeetLink?: boolean;
}): Promise<CalendarEventSummary> {
  const calendarId = encodeURIComponent(params.calendarId?.trim() || 'primary');
  const body: Record<string, unknown> = {
    summary: params.summary,
    description: params.description ?? '',
    location: params.location ?? '',
    start: timePayload(params.start),
    end: timePayload(params.end),
  };
  if (params.attendees?.length) {
    body.attendees = params.attendees.map((email) => ({ email }));
  }
  if (params.createMeetLink) {
    body.conferenceData = {
      createRequest: {
        requestId: `qlix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const confQ = params.createMeetLink ? '?conferenceDataVersion=1' : '';
  const result = await calendarFetch(
    params.accessToken,
    `/calendars/${calendarId}/events${confQ}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return toEvent(result);
}

export async function calendarUpdateEvent(params: {
  accessToken: string;
  eventId: string;
  calendarId?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  attendees?: string[];
}): Promise<CalendarEventSummary> {
  const calendarId = encodeURIComponent(params.calendarId?.trim() || 'primary');
  const patch: Record<string, unknown> = {};
  if (params.summary != null) patch.summary = params.summary;
  if (params.description != null) patch.description = params.description;
  if (params.location != null) patch.location = params.location;
  if (params.start) patch.start = timePayload(params.start);
  if (params.end) patch.end = timePayload(params.end);
  if (params.attendees) patch.attendees = params.attendees.map((email) => ({ email }));

  const result = await calendarFetch(
    params.accessToken,
    `/calendars/${calendarId}/events/${encodeURIComponent(params.eventId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return toEvent(result);
}

export async function calendarDeleteEvent(params: {
  accessToken: string;
  eventId: string;
  calendarId?: string;
}): Promise<{ eventId: string; status: 'deleted' }> {
  const calendarId = encodeURIComponent(params.calendarId?.trim() || 'primary');
  await calendarFetch(
    params.accessToken,
    `/calendars/${calendarId}/events/${encodeURIComponent(params.eventId)}`,
    { method: 'DELETE' },
  );
  return { eventId: params.eventId, status: 'deleted' };
}
