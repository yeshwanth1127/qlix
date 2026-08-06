/** Low-level Slack Web API helpers (user or bot token). */

export class SlackApiError extends Error {
  readonly code = 'slack_api_error';
  constructor(
    message: string,
    readonly slackError?: string,
  ) {
    super(message);
  }
}

async function parseSlackResponse(
  resp: Response,
  method: string,
): Promise<Record<string, unknown>> {
  const text = await resp.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new SlackApiError(`Slack ${method} returned non-JSON (${resp.status})`);
  }
  if (!resp.ok) {
    throw new SlackApiError(`Slack ${method} HTTP ${resp.status}: ${text.slice(0, 400)}`);
  }
  if (parsed.ok === false) {
    throw new SlackApiError(
      `Slack ${method} error: ${String(parsed.error ?? 'unknown')}`,
      String(parsed.error ?? ''),
    );
  }
  return parsed;
}

export async function slackApiGet(
  token: string,
  method: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    qs.set(k, String(v));
  }
  const url = `https://slack.com/api/${method}${qs.size ? `?${qs.toString()}` : ''}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseSlackResponse(resp, method);
}

export async function slackApiPostJson(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  return parseSlackResponse(resp, method);
}

export async function fetchSlackUserDisplayName(
  userToken: string,
  slackUserId: string | null,
): Promise<string | null> {
  if (!slackUserId) return null;
  try {
    const info = await slackApiGet(userToken, 'users.info', { user: slackUserId });
    const user = info.user as Record<string, unknown> | undefined;
    const profile = user?.profile as Record<string, unknown> | undefined;
    const email = profile?.email;
    if (typeof email === 'string' && email.trim()) return email.trim();
    const realName = profile?.real_name ?? user?.real_name ?? user?.name;
    if (typeof realName === 'string' && realName.trim()) return realName.trim();
    return null;
  } catch {
    return null;
  }
}
