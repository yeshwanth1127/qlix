import type { TeamRunDTO, TeamRunEventDTO } from './teams.types.js';

export type TeamRunFailureCode =
  | 'missing_attachment'
  | 'missing_input_reference'
  | 'team_runners_not_ready'
  | 'email_connector_required'
  | 'invalid_continues_run'
  | 'worker_timeout'
  | 'worker_no_result'
  | 'worker_validation_failed'
  | 'worker_run_failed'
  | 'stage_aborted'
  | 'run_canceled'
  | 'run_stalled'
  | 'upload_error'
  | 'gateway_rejected'
  | 'pipeline_error';

export interface TeamRunFailure {
  code: TeamRunFailureCode;
  title: string;
  message: string;
  reason?: string;
  hint?: string;
  stage?: string;
  agentName?: string;
}

const FAILURE_PAYLOAD_KEY = 'failure';

export function teamRunFailure(params: TeamRunFailure): TeamRunFailure {
  return params;
}

export function teamRunFailureSummary(failure: TeamRunFailure): string {
  return failure.message;
}

export function teamRunFailurePayload(failure: TeamRunFailure): {
  error: string;
  failure: TeamRunFailure;
} {
  return { error: teamRunFailureSummary(failure), failure };
}

export function parseTeamRunFailurePayload(payload: unknown): TeamRunFailure | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const raw = record[FAILURE_PAYLOAD_KEY] ?? record.failure;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const failure = raw as TeamRunFailure;
  if (typeof failure.code !== 'string' || typeof failure.title !== 'string' || typeof failure.message !== 'string') {
    return null;
  }
  return failure;
}

export function resolveTeamRunFailure(
  run: Pick<TeamRunDTO, 'errorMessage' | 'status'>,
  events: Pick<TeamRunEventDTO, 'eventType' | 'payload'>[] = [],
): TeamRunFailure | null {
  if (run.status !== 'failed') return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.eventType !== 'run_failed') continue;
    const parsed = parseTeamRunFailurePayload(event.payload);
    if (parsed) return parsed;
  }
  if (run.errorMessage?.trim()) {
    return teamRunFailureFromMessage(run.errorMessage);
  }
  return teamRunFailure({
    code: 'pipeline_error',
    title: 'Team run failed',
    message: 'The team run failed before producing a result.',
    reason: 'No detailed failure record was stored for this run.',
    hint: 'Try again. If the problem persists, start a new chat and re-attach any required files.',
  });
}

export function teamRunFailureFromMessage(
  message: string,
  context: { agentName?: string; stage?: string } = {},
): TeamRunFailure {
  const text = message.trim();
  if (!text) {
    return teamRunFailure({
      code: 'pipeline_error',
      title: 'Team run failed',
      message: 'The team run failed before producing a result.',
      hint: 'Try again with the same goal and attachments.',
      ...context,
    });
  }

  if (/no valid input reference|Dispatch refers to a provided file/i.test(text)) {
    return missingInputReferenceFailure();
  }
  if (/no uploaded spreadsheet|missing_attachment|no file was uploaded/i.test(text)) {
    return missingAttachmentFailure();
  }
  if (/timed out after/i.test(text)) {
    return teamRunFailure({
      code: 'worker_timeout',
      title: 'Worker timed out',
      message: text,
      reason: 'The worker did not finish within the configured stage timeout.',
      hint: 'Try a smaller input, a faster model, or increase the team timeout in settings.',
      ...context,
    });
  }
  if (/did not return a Result envelope|Result JSON was cut off|missing summary/i.test(text)) {
    return teamRunFailure({
      code: 'worker_no_result',
      title: 'Worker did not return a valid Result',
      message: text,
      reason: 'The worker finished without the structured JSON Result the pipeline requires.',
      hint: 'Retry the run. If it keeps happening, switch models or simplify the stage goal.',
      ...context,
    });
  }
  if (/Result cites|provenance|validation/i.test(text)) {
    return teamRunFailure({
      code: 'worker_validation_failed',
      title: 'Worker Result was rejected',
      message: text,
      reason: 'The worker returned output that did not pass Luna-Teams validation.',
      hint: 'Check that the stage used the attached source file and returned the required JSON fields.',
      ...context,
    });
  }
  if (/Pipeline aborted/i.test(text)) {
    const stageMatch = text.match(/stage "([^"]+)"/i);
    const agentName = stageMatch?.[1] ?? context.agentName;
    return teamRunFailure({
      code: 'stage_aborted',
      title: agentName ? `Stage "${agentName}" failed` : 'Pipeline stage failed',
      message: text,
      reason: 'A worker stage failed, so downstream stages were skipped.',
      hint: 'Fix the issue in the failed stage, then start a new run or send a follow-up.',
      agentName,
      ...context,
    });
  }
  if (/Run was canceled|Team run stopped/i.test(text)) {
    return teamRunFailure({
      code: 'run_canceled',
      title: 'Run canceled',
      message: text,
      reason: 'The run was stopped before completion.',
    });
  }
  if (/stalled|backend restarted/i.test(text)) {
    return teamRunFailure({
      code: 'run_stalled',
      title: 'Run interrupted',
      message: text,
      reason: 'The backend lost track of this run before it could finish.',
      hint: 'Start a new run and re-attach any required files.',
    });
  }
  if (/runners not ready|runner/i.test(text)) {
    return teamRunnersNotReadyFailure(text);
  }

  return teamRunFailure({
    code: 'pipeline_error',
    title: 'Team run failed',
    message: text,
    reason: 'The orchestrator reported an unexpected failure.',
    hint: 'Try again. If the issue repeats, start a new chat and confirm attachments and connectors are set up.',
    ...context,
  });
}

export function teamRunFailureFromError(
  error: unknown,
  context: { agentName?: string; stage?: string } = {},
): TeamRunFailure {
  const coded = error as { code?: string; message?: string };
  if (coded.code === 'missing_attachment') return missingAttachmentFailure();
  if (coded.code === 'missing_input_reference') return missingInputReferenceFailure();
  if (coded.code === 'team_runners_not_ready') {
    return teamRunnersNotReadyFailure(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (coded.code === 'email_connector_required') {
    const message = error instanceof Error ? error.message : String(error);
    return teamRunFailure({
      code: 'email_connector_required',
      title: 'Email connector required',
      message,
      reason: 'This team includes a worker that sends email, but no mailbox is connected.',
      hint: 'Connect Gmail or Microsoft 365 in workspace settings, then retry.',
    });
  }
  if (coded.code === 'invalid_continues_run') {
    const message = error instanceof Error ? error.message : String(error);
    return teamRunFailure({
      code: 'invalid_continues_run',
      title: 'Cannot continue that run',
      message,
      reason: 'The follow-up target run is missing, still active, or belongs to another team.',
      hint: 'Start a fresh run instead of continuing this one.',
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return teamRunFailureFromMessage(message, context);
}

export function missingAttachmentFailure(): TeamRunFailure {
  return teamRunFailure({
    code: 'missing_attachment',
    title: 'Spreadsheet not attached',
    message: 'This run needs a lead spreadsheet, but no file was uploaded with the request.',
    reason:
      'Team runs do not read lead lists from Brain. Brain is only used later for brochures and knowledge.',
    hint: 'Click the paperclip, attach your Excel/CSV file, confirm the attachment chip appears, then send again.',
  });
}

export function missingInputReferenceFailure(): TeamRunFailure {
  return teamRunFailure({
    code: 'missing_input_reference',
    title: 'Spreadsheet not attached to this run',
    message: 'The first stage was asked to read an attached spreadsheet, but this run has no uploaded file.',
    reason:
      'Each new team run needs its own file attachment unless you send a follow-up on a previous run that already had the file.',
    hint: 'Attach the Excel file in the composer, or reply as a follow-up on the earlier run that already included it.',
  });
}

function teamRunnersNotReadyFailure(message: string): TeamRunFailure {
  return teamRunFailure({
    code: 'team_runners_not_ready',
    title: 'Team runners not ready',
    message,
    reason: 'One or more team agent containers are still starting or unhealthy.',
    hint: 'Wait a moment, refresh the team page, and try again once all runners show ready.',
  });
}

export function workerFailureFromResult(
  failed: { agentName?: string; errorMessage?: string | null },
): TeamRunFailure {
  const message = failed.errorMessage?.trim() || 'The worker produced no usable output.';
  const base = teamRunFailureFromMessage(message, { agentName: failed.agentName });
  return teamRunFailure({
    ...base,
    agentName: failed.agentName ?? base.agentName,
    stage: failed.agentName ?? base.stage,
  });
}

export function apiErrorBodyFromFailure(failure: TeamRunFailure): {
  code: string;
  message: string;
  title: string;
  reason?: string;
  hint?: string;
} {
  return {
    code: failure.code,
    message: failure.message,
    title: failure.title,
    ...(failure.reason ? { reason: failure.reason } : {}),
    ...(failure.hint ? { hint: failure.hint } : {}),
  };
}
