const QLIX_URL = (process.env.QLIX_URL || 'http://localhost:4000').replace(/\/$/, '');
const SERVICE_SECRET = process.env.SERVICE_SECRET || '';

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-Service-Secret': SERVICE_SECRET,
  };
}

async function parseJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ─── Job apply copilot ────────────────────────────────────────────────────────

export async function getJobsAgentContext(agentId) {
  const res = await fetch(`${QLIX_URL}/api/v1/internal/jobs/agent/${encodeURIComponent(agentId)}/context`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Agent context failed (${res.status})`);
  return parseJson(res);
}

export async function jobsUpsertProfile(agentId, body) {
  const res = await fetch(`${QLIX_URL}/api/v1/internal/jobs/profile/upsert`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ agentId, ...body }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `Upsert profile failed (${res.status})`);
  return data;
}

export async function jobsStageResume(agentId, body) {
  const res = await fetch(`${QLIX_URL}/api/v1/internal/jobs/profile/stage-resume`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ agentId, ...body }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `Stage resume failed (${res.status})`);
  return data;
}

export async function jobsSearch(body) {
  const res = await fetch(`${QLIX_URL}/api/v1/internal/jobs/search`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `Search failed (${res.status})`);
  return data;
}

export async function jobsQueueCampaign(agentId, body) {
  const res = await fetch(`${QLIX_URL}/api/v1/internal/jobs/campaigns`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ agentId, ...body }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `Queue failed (${res.status})`);
  return data;
}

export async function jobsListApplications(orgId, campaignId, status) {
  const q = new URLSearchParams({ orgId });
  if (status) q.set('status', String(status));
  const res = await fetch(
    `${QLIX_URL}/api/v1/internal/jobs/campaigns/${encodeURIComponent(campaignId)}/applications?${q}`,
    { headers: headers() },
  );
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `List applications failed (${res.status})`);
  return data;
}

export async function jobsGetBrief(orgId, applicationId) {
  const res = await fetch(
    `${QLIX_URL}/api/v1/internal/jobs/applications/${encodeURIComponent(applicationId)}/brief?orgId=${encodeURIComponent(orgId)}`,
    { headers: headers() },
  );
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `Get brief failed (${res.status})`);
  return data;
}

export async function jobsRecordResult(orgId, applicationId, body) {
  const res = await fetch(
    `${QLIX_URL}/api/v1/internal/jobs/applications/${encodeURIComponent(applicationId)}/result`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ orgId, ...body }),
    },
  );
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `Record result failed (${res.status})`);
  return data;
}

// ─── Scheduled events ─────────────────────────────────────────────────────────

export async function getScheduleAgentContext(agentId) {
  const res = await fetch(
    `${QLIX_URL}/api/v1/internal/schedules/agent/${encodeURIComponent(agentId)}/context`,
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`Agent context failed (${res.status})`);
  return parseJson(res);
}

export async function schedulesCreate(agentId, body) {
  const res = await fetch(`${QLIX_URL}/api/v1/internal/schedules`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ agentId, ...body }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `Create schedule failed (${res.status})`);
  return data;
}

export async function schedulesList(agentId, opts = {}) {
  const q = new URLSearchParams({ agentId });
  if (opts.status) q.set('status', String(opts.status));
  if (opts.includeCancelled) q.set('includeCancelled', '1');
  const res = await fetch(`${QLIX_URL}/api/v1/internal/schedules?${q}`, { headers: headers() });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `List schedules failed (${res.status})`);
  return data;
}

export async function schedulesGet(agentId, scheduleId) {
  const q = new URLSearchParams({ agentId });
  const res = await fetch(
    `${QLIX_URL}/api/v1/internal/schedules/${encodeURIComponent(scheduleId)}?${q}`,
    { headers: headers() },
  );
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `Get schedule failed (${res.status})`);
  return data;
}

export async function schedulesUpdate(agentId, scheduleId, body) {
  const res = await fetch(`${QLIX_URL}/api/v1/internal/schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ agentId, ...body }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `Update schedule failed (${res.status})`);
  return data;
}

export async function schedulesCancel(agentId, scheduleId) {
  const res = await fetch(
    `${QLIX_URL}/api/v1/internal/schedules/${encodeURIComponent(scheduleId)}/cancel`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ agentId }),
    },
  );
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `Cancel schedule failed (${res.status})`);
  return data;
}
