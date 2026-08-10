import {
  calendarCreateEvent,
  calendarDeleteEvent,
  calendarGetEvent,
  calendarListEvents,
  calendarUpdateEvent,
  CalendarApiError,
} from './calendarApi.service.js';
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

export type CalendarReadAction = 'list' | 'get';
export type CalendarWriteAction = 'create' | 'update' | 'delete';

export async function executeCalendarRead(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: CalendarReadAction;
    eventId?: string;
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    query?: string;
    maxResults?: number;
  };
}): Promise<Record<string, unknown>> {
  const ctx = await loadGoogleAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveGoogleScopes(ctx);
  if (!scopes.has('calendar.read') && !scopes.has('calendar.write')) {
    throw new GoogleScopeDeniedError('calendar.read');
  }
  if (!ctx.orgId) {
    throw new GoogleConnectorNotConfiguredError('calendar', 'Agent must belong to an organization');
  }

  const accessToken = await getFreshGoogleAccessToken(ctx.orgId, 'calendar');
  try {
    let result: Record<string, unknown>;
    const asRecord = (v: object): Record<string, unknown> => ({ ...v });
    if (params.input.action === 'list') {
      result = asRecord(await calendarListEvents({
        accessToken,
        calendarId: params.input.calendarId,
        timeMin: params.input.timeMin,
        timeMax: params.input.timeMax,
        query: params.input.query,
        maxResults: params.input.maxResults,
      }));
    } else {
      if (!params.input.eventId?.trim()) {
        throw new GoogleToolError('eventId is required for action=get');
      }
      result = asRecord(await calendarGetEvent({
        accessToken,
        eventId: params.input.eventId.trim(),
        calendarId: params.input.calendarId,
      }));
    }
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'calendar.read',
      status: 'success',
      riskLevel: 'low',
      teamRunId: ctx.teamRunId,
      payload: { action: params.input.action, eventId: params.input.eventId ?? null },
    });
    return result;
  } catch (err) {
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'calendar.read',
      status: 'failed',
      riskLevel: 'low',
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
      err instanceof CalendarApiError ? err.message : String((err as Error)?.message ?? err),
    );
  }
}

export async function executeCalendarWrite(params: {
  agentId: string;
  runId: string | null;
  input: {
    action: CalendarWriteAction;
    eventId?: string;
    calendarId?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    attendees?: string[];
    createMeetLink?: boolean;
    jitToken?: string | null;
  };
}): Promise<Record<string, unknown>> {
  const ctx = await loadGoogleAgentRunContext(params.agentId, params.runId);
  const scopes = effectiveGoogleScopes(ctx);
  if (!scopes.has('calendar.write')) throw new GoogleScopeDeniedError('calendar.write');
  if (!ctx.orgId) {
    throw new GoogleConnectorNotConfiguredError('calendar', 'Agent must belong to an organization');
  }

  await requireGoogleJitIfNeeded({
    agentId: params.agentId,
    runId: params.runId,
    ctx,
    actionType: 'calendar.write',
    jitToken: params.input.jitToken,
  });

  // Meet link on create needs meet.manage when the agent wants a conference.
  if (params.input.action === 'create' && params.input.createMeetLink) {
    if (!scopes.has('meet.manage')) {
      throw new GoogleToolError(
        'createMeetLink requires the meet.manage scope (and GMeet connected). ' +
          'Create the event without a Meet link, or grant meet.manage.',
      );
    }
  }

  const accessToken = await getFreshGoogleAccessToken(ctx.orgId, 'calendar');
  // When adding Meet, also ensure meet OAuth is connected (calendar.events alone is enough for
  // conferenceData on create in practice, but we require GMeet connect for clarity).
  if (params.input.createMeetLink) {
    await getFreshGoogleAccessToken(ctx.orgId, 'meet').catch(() => {
      throw new GoogleConnectorNotConfiguredError(
        'meet',
        'GMeet must be connected to attach Meet links to calendar events.',
      );
    });
  }

  try {
    let result: Record<string, unknown>;
    const asRecord = (v: object): Record<string, unknown> => ({ ...v });
    if (params.input.action === 'create') {
      if (!params.input.summary?.trim()) {
        throw new GoogleToolError('summary is required for action=create');
      }
      if (!params.input.start?.trim() || !params.input.end?.trim()) {
        throw new GoogleToolError('start and end are required for action=create (ISO-8601)');
      }
      result = asRecord(await calendarCreateEvent({
        accessToken,
        summary: params.input.summary.trim(),
        description: params.input.description,
        location: params.input.location,
        start: params.input.start.trim(),
        end: params.input.end.trim(),
        attendees: params.input.attendees,
        calendarId: params.input.calendarId,
        createMeetLink: Boolean(params.input.createMeetLink),
      }));
    } else if (params.input.action === 'update') {
      if (!params.input.eventId?.trim()) {
        throw new GoogleToolError('eventId is required for action=update');
      }
      result = asRecord(await calendarUpdateEvent({
        accessToken,
        eventId: params.input.eventId.trim(),
        calendarId: params.input.calendarId,
        summary: params.input.summary,
        description: params.input.description,
        location: params.input.location,
        start: params.input.start,
        end: params.input.end,
        attendees: params.input.attendees,
      }));
    } else {
      if (!params.input.eventId?.trim()) {
        throw new GoogleToolError('eventId is required for action=delete');
      }
      result = asRecord(await calendarDeleteEvent({
        accessToken,
        eventId: params.input.eventId.trim(),
        calendarId: params.input.calendarId,
      }));
    }
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'calendar.write',
      status: 'success',
      riskLevel: 'high',
      teamRunId: ctx.teamRunId,
      payload: {
        action: params.input.action,
        eventId: (result.id as string | undefined) ?? params.input.eventId ?? null,
        summary: params.input.summary ?? null,
        createMeetLink: Boolean(params.input.createMeetLink),
      },
    });
    return result;
  } catch (err) {
    await appendGoogleActionLog({
      agentId: params.agentId,
      userId: ctx.userId,
      actionType: 'calendar.write',
      status: 'failed',
      riskLevel: 'high',
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
      err instanceof CalendarApiError ? err.message : String((err as Error)?.message ?? err),
    );
  }
}
