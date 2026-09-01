"use client";

import { useState } from "react";
import { API_KEY_SCOPE_OPTIONS, developerApiBaseUrl } from "@/lib/api-keys-api";
import { CopyTextButton } from "@/components/qlix/api-keys/CopyTextButton";
import { sketchButton } from "@/components/qlix/sketch";
import { PortalCodeBlock } from "./PortalCodeBlock";
import { portalBody, portalLabel, portalTabActive, portalTabIdle, type PortalVariant } from "./portalTheme";

export type GuideSectionId =
  | "start"
  | "auth"
  | "recipes"
  | "jit"
  | "scopes"
  | "errors"
  | "limits"
  | "not-in-api";

export const GUIDE_SECTIONS: { id: GuideSectionId; label: string }[] = [
  { id: "start", label: "Get started" },
  { id: "auth", label: "Authentication" },
  { id: "recipes", label: "Recipes" },
  { id: "jit", label: "JIT approvals" },
  { id: "scopes", label: "Scopes" },
  { id: "errors", label: "Errors" },
  { id: "limits", label: "Limits & RBAC" },
  { id: "not-in-api", label: "Not in the API" },
];

const SCOPE_BLURB: Record<string, string> = {
  "agents:read": "List and read agents, the scope catalog, and org members.",
  "agents:write": "Create, update, and delete agents (scopes, description, tool profile).",
  "audit:read": "Read the audit log. Compliance export still requires owner/admin.",
  "credentials:read": "List credentials and passports.",
  "runs:write": "Conversations, enqueue runs, SSE stream, stop, and inject.",
  "teams:read": "List teams, runs, runner status, and team SSE.",
  "teams:write": "Create teams and start / mutate team runs.",
  "brain:read": "Brain status, documents, collections, policy signals, and query.",
  "brain:write": "Create and mutate brain collections and other /ai-brain writes.",
  "builder:read": "List AI Builder sessions, prompt history, and visual canvases.",
  "builder:write": "Parse a prompt, create agents/teams from a plan, and mutate builder sessions and canvases.",
  "jit:decide": "Approve or deny JIT requests; list and revoke grants.",
  "usage:read": "Usage summary, per-agent usage, and subscription status.",
};

export function GuideCreateKeyCta({ variant }: { readonly variant: PortalVariant }) {
  if (variant !== "docs") return null;
  return (
    <p className="rounded-lg border border-black/10 bg-[#E2F0CC]/50 p-3 text-[13px] text-black/65">
      Create a <code className="font-mono text-[12px]">qlix_live_…</code> key in the console under{" "}
      <a href="/sign-in" className="underline underline-offset-2">
        API
      </a>
      . The secret is shown once.
    </p>
  );
}

export function GuideSectionContent({
  section,
  apiBase,
  variant,
}: {
  readonly section: GuideSectionId;
  readonly apiBase: string;
  readonly variant: PortalVariant;
}) {
  const body = portalBody[variant];
  const label = portalLabel[variant];

  const meCurl = `curl -sS \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  "${apiBase}/api/v1/auth/me"`;

  const listAgentsCurl = `export QLIX_API_KEY="qlix_live_YOUR_KEY_HERE"

curl -sS \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  "${apiBase}/api/v1/agents"`;

  const createConversationCurl = `# 1) Create / open a conversation (returns conversation id)
curl -sS -X POST \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  -H "Content-Type: application/json" \\
  "${apiBase}/api/v1/agents/AGENT_ID/conversations"

# 2) Send a message to start a run
curl -sS -X POST \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"Hello — summarize my inbox"}' \\
  "${apiBase}/api/v1/agents/AGENT_ID/conversations/CONVERSATION_ID/messages"

# 3) Stream events (SSE)
curl -sS -N \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  "${apiBase}/api/v1/agents/AGENT_ID/runs/RUN_ID/stream"`;

  const brainCurl = `curl -sS -X POST \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"question":"What is our refund policy?"}' \\
  "${apiBase}/api/v1/ai-brain/query"`;

  const auditCurl = `curl -sS \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  "${apiBase}/api/v1/dashboard/audit?limit=100"`;

  const teamRunCurl = `curl -sS -H "Authorization: Bearer $QLIX_API_KEY" \\
  "${apiBase}/api/v1/teams"

curl -sS -X POST \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"goal":"Research competitors and draft a summary"}' \\
  "${apiBase}/api/v1/teams/TEAM_ID/runs"`;

  const jitCurl = `# Watch the run stream — a jit_approval_pending event includes jitRequestId
curl -sS -N \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  "${apiBase}/api/v1/agents/AGENT_ID/runs/RUN_ID/stream"

# Or poll pending approvals for this workspace (optional ?runId= / ?agentId=)
curl -sS -H "Authorization: Bearer $QLIX_API_KEY" \\
  "${apiBase}/api/v1/jit/pending"

curl -sS -X POST \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"jitRequestId":"JIT_REQUEST_UUID","approved":true}' \\
  "${apiBase}/api/v1/jit/decide"`;

  const usageCurl = `curl -sS -H "Authorization: Bearer $QLIX_API_KEY" \\
  "${apiBase}/api/v1/usage/summary"`;

  const builderCurl = `# 1) Parse a prompt into a plan
curl -sS -X POST \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"Build a research agent that can search the web and draft a briefing"}' \\
  "${apiBase}/api/v1/agents/nl-parse"

# 2) Create the agent or team from that plan (workspace comes from the API key)
curl -sS -X POST \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"plan":PLAN_JSON}' \\
  "${apiBase}/api/v1/agents/nl-create"`;

  const pythonSnippet = `import os
import requests

API_BASE = "${apiBase}"
API_KEY = os.environ["QLIX_API_KEY"]

headers = {"Authorization": f"Bearer {API_KEY}"}
agents = requests.get(f"{API_BASE}/api/v1/agents", headers=headers, timeout=30)
agents.raise_for_status()
print(agents.json())`;

  const jsSnippet = `const API_BASE = "${apiBase}";
const API_KEY = process.env.QLIX_API_KEY;

const res = await fetch(\`\${API_BASE}/api/v1/agents\`, {
  headers: { Authorization: \`Bearer \${API_KEY}\` },
});
if (!res.ok) throw new Error(await res.text());
console.log(await res.json());`;

  if (section === "start") {
    return (
      <div className={`flex flex-col gap-4 ${body}`}>
        <GuideCreateKeyCta variant={variant} />
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <strong className="text-black">Create a key</strong> in the console API page. Label it (e.g.{" "}
            <em>CI pipeline</em>) and choose scopes.
          </li>
          <li>
            <strong className="text-black">Copy the secret immediately.</strong> Qlix shows the full{" "}
            <code className="rounded bg-black/5 px-1 font-mono text-[12px]">qlix_live_…</code> string only
            once.
          </li>
          <li>
            <strong className="text-black">Put it in your environment:</strong>
            <div className="mt-2">
              <PortalCodeBlock
                variant={variant}
                code={`export QLIX_API_KEY="qlix_live_paste_your_key_here"`}
                copyLabel="Copy export"
              />
            </div>
          </li>
          <li>
            <strong className="text-black">List agents</strong> in your workspace:
            <div className="mt-2">
              <PortalCodeBlock variant={variant} code={listAgentsCurl} copyLabel="Copy curl" />
            </div>
          </li>
        </ol>
        <p className="rounded-lg border border-black/10 bg-black/[0.02] p-3 text-[12px] text-black/60">
          Base URL: <code className="font-mono text-black/80">{apiBase}</code>
          <span className="ml-2 inline-block align-middle">
            <CopyTextButton value={apiBase} label="Copy base URL" />
          </span>
        </p>
      </div>
    );
  }

  if (section === "auth") {
    return (
      <div className={`flex flex-col gap-4 ${body}`}>
        <p>
          Developer API requests identify your account with a <code className="font-mono">qlix_live_*</code>{" "}
          key — not your password, and not the browser session cookie. Each key is created in a workspace and
          stored with that org. Sends need only the key; Qlix attaches the linked org on every request. Optional{" "}
          <code className="font-mono">GET /api/v1/auth/me</code> shows which workspace the key belongs to.
        </p>
        <div>
          <span className={label}>Recommended — Authorization header</span>
          <div className="mt-2">
            <PortalCodeBlock
              variant={variant}
              code={`Authorization: Bearer qlix_live_YOUR_KEY_HERE`}
              copyLabel="Copy header"
            />
          </div>
        </div>
        <div>
          <span className={label}>Alternative — X-Api-Key header</span>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={`X-Api-Key: qlix_live_YOUR_KEY_HERE`} copyLabel="Copy header" />
          </div>
        </div>
        <div>
          <span className={label}>Four auth modes in Qlix</span>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-[13px]">
            <li>
              <strong className="text-black">API key</strong> — this Developer API. Scoped. Acts as the creating
              user.
            </li>
            <li>
              <strong className="text-black">Session JWT</strong> — console cookie. Unrestricted by API-key scopes.
              Required to create or revoke keys.
            </li>
            <li>
              <strong className="text-black">Agent-signed</strong> Ed25519 payloads —{" "}
              <code className="font-mono">POST /actions/*</code> and <code className="font-mono">POST /jit/request</code>{" "}
              via the Python agent SDK (<code className="font-mono">agent.json</code>).
            </li>
            <li>
              <strong className="text-black">Runner token</strong> —{" "}
              <code className="font-mono">X-QLIX-Runner-Token</code> for cloud/hybrid runtime, not account scripts.
            </li>
          </ul>
        </div>
        <div>
          <span className={label}>Python</span>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={pythonSnippet} copyLabel="Copy Python" />
          </div>
        </div>
        <div>
          <span className={label}>Node / fetch</span>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={jsSnippet} copyLabel="Copy JS" />
          </div>
        </div>
      </div>
    );
  }

  if (section === "recipes") {
    return (
      <div className={`flex flex-col gap-5 ${body}`}>
        <p>
          Developer API calls need only the key. The key is already bound to your user and workspace — do not
          send <code className="font-mono">orgId</code> in bodies or query strings.
        </p>
        <div>
          <span className={label}>Who am I / which workspace</span>
          <p className="mt-1 text-[12px] text-black/50">
            Optional. Any valid key can call this. The org is already linked; you do not copy it into later
            requests.
          </p>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={meCurl} />
          </div>
        </div>
        <div>
          <span className={label}>List agents (Layer 3)</span>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={listAgentsCurl} />
          </div>
        </div>
        <div>
          <span className={label}>Start an agent run + SSE</span>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={createConversationCurl} />
          </div>
        </div>
        <div>
          <span className={label}>Query AI Brain</span>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={brainCurl} />
          </div>
        </div>
        <div>
          <span className={label}>Start a team run</span>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={teamRunCurl} />
          </div>
        </div>
        <div>
          <span className={label}>JIT approve / deny</span>
          <p className="mt-1 text-[12px] text-black/50">
            Approvals go back to wherever the run started. An API-started run waits on the SSE stream and{" "}
            <code className="font-mono">GET /jit/pending</code> — it is not sent to WhatsApp. Requires{" "}
            <code className="font-mono">jit:decide</code>.
          </p>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={jitCurl} />
          </div>
        </div>
        <div>
          <span className={label}>Read audit log (Layer 5)</span>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={auditCurl} />
          </div>
        </div>
        <div>
          <span className={label}>AI Builder — parse then create</span>
          <p className="mt-1 text-[12px] text-black/50">
            Requires <code className="font-mono">builder:write</code>. Keys created before this scope existed
            need a new key with it selected.
          </p>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={builderCurl} />
          </div>
        </div>
        <div>
          <span className={label}>Usage summary</span>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={usageCurl} />
          </div>
        </div>
      </div>
    );
  }

  if (section === "jit") {
    return (
      <div className={`flex flex-col gap-4 ${body}`}>
        <p>
          When an agent hits a gated action (a JIT scope), it pauses until a human approves. The approval
          request is sent <strong className="text-black">back to the same place the run started</strong> — not
          to every connected channel. The source then sends the decision on that same channel.
        </p>
        <div>
          <span className={label}>How the source decides</span>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-[13px]">
            <li>
              <strong className="text-black">Developer API</strong> — watch{" "}
              <code className="font-mono">jit_approval_pending</code> on the run SSE stream, or poll{" "}
              <code className="font-mono">GET /jit/pending</code>. Send the decision with{" "}
              <code className="font-mono">POST /jit/decide</code>{" "}
              <code className="font-mono">{'{ "jitRequestId": "…", "approved": true }'}</code>. Requires{" "}
              <code className="font-mono">jit:decide</code>.
            </li>
            <li>
              <strong className="text-black">Console chat</strong> — Approve / Deny on the in-conversation card.
              That calls the same <code className="font-mono">POST /jit/decide</code> using the signed-in
              session.
            </li>
            <li>
              <strong className="text-black">WhatsApp</strong> — Qlix texts the linked phone. Reply{" "}
              <code className="font-mono">yes</code> / <code className="font-mono">approve</code> /{" "}
              <code className="font-mono">ok</code> to allow, or <code className="font-mono">no</code> /{" "}
              <code className="font-mono">deny</code> to reject. Times out if there is no reply.
            </li>
            <li>
              <strong className="text-black">Slack</strong> — a notice is posted in the thread that started the
              run. Decide from that Qlix link, or with <code className="font-mono">POST /jit/decide</code>.
            </li>
          </ul>
        </div>
        <p>
          The API key does not create the JIT request. The running agent does, then polls until you decide.
          Your key only lists and decides.
        </p>
        <div>
          <span className={label}>Listen, then decide</span>
          <div className="mt-2">
            <PortalCodeBlock variant={variant} code={jitCurl} copyLabel="Copy curl" />
          </div>
        </div>
        <div>
          <span className={label}>How it is managed</span>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-[13px]">
            <li>
              Status is <code className="font-mono">pending</code> until approved, denied, or expired. Pending
              rows include <code className="font-mono">jitRequestId</code>,{" "}
              <code className="font-mono">scope</code>, <code className="font-mono">runId</code>, and{" "}
              <code className="font-mono">sourceChannel</code>.
            </li>
            <li>
              Unanswered requests expire (about two minutes; five on WhatsApp). The agent then treats the
              action as denied.
            </li>
            <li>
              Some write scopes (for example send-email) are granted for the rest of that conversation after
              one yes. <code className="font-mono">GET /jit/grants</code> lists those;{" "}
              <code className="font-mono">DELETE /jit/grants/{"{id}"}</code> revokes.
            </li>
          </ul>
        </div>
      </div>
    );
  }

  if (section === "scopes") {
    return (
      <div className={`flex flex-col gap-3 ${body}`}>
        <p>
          Scopes limit what a key can do. Session login in the console is unrestricted; API keys are not. Pick
          the minimum your integration needs.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-black/15">
                <th className="py-2 pr-3 font-medium text-black">Scope</th>
                <th className="py-2 font-medium text-black">Allows</th>
              </tr>
            </thead>
            <tbody>
              {API_KEY_SCOPE_OPTIONS.map((scope) => (
                <tr key={scope.id} className="border-b border-black/8">
                  <td className="py-2 pr-3 font-mono text-[11px] text-black/80">{scope.id}</td>
                  <td className="py-2 text-black/65">{SCOPE_BLURB[scope.id] ?? scope.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (section === "errors") {
    return (
      <div className={`flex flex-col gap-3 ${body}`}>
        <p>
          Responses use JSON shaped like{" "}
          <code className="rounded bg-black/5 px-1 font-mono text-[12px]">
            {'{ "error": { "code": "…", "message": "…" } }'}
          </code>
          .
        </p>
        <ul className="list-disc space-y-2 pl-5 text-[13px]">
          <li>
            <code className="font-mono">401 unauthorized</code> — missing, wrong, or revoked key.
          </li>
          <li>
            <code className="font-mono">403 insufficient_scope</code> — key is valid but lacks the scope for that
            route.
          </li>
          <li>
            <code className="font-mono">403 api_key_not_allowed</code> — endpoint is console-only (not in the
            Developer API).
          </li>
          <li>
            <code className="font-mono">403 session_required</code> — you tried to manage keys with an API key.
            Sign into the console instead.
          </li>
          <li>
            <code className="font-mono">429 rate_limited</code> — per-key or per-IP minute budget exceeded.
          </li>
          <li>
            <code className="font-mono">400 invalid_body</code> — JSON body failed validation.
          </li>
        </ul>
      </div>
    );
  }

  if (section === "limits") {
    return (
      <div className={`flex flex-col gap-3 ${body}`}>
        <p>
          API keys are limited to <strong className="text-black">300 requests/minute</strong> per key. Other
          clients share a <strong className="text-black">600 requests/minute</strong> per-IP budget.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-[13px]">
          <li>The key acts as the creating user (same org and role).</li>
          <li>
            Org members cannot create keys — ask an owner or admin. Members only see keys they created.
          </li>
          <li>
            Compliance export still requires owner/admin even with <code className="font-mono">audit:read</code>.
          </li>
          <li>Mutating routes require an active workspace subscription, same as the console.</li>
          <li>Keys cannot create or revoke other keys.</li>
        </ul>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${body}`}>
      <p>
        These surfaces are not callable with an API key (you will get{" "}
        <code className="font-mono">api_key_not_allowed</code>):
      </p>
      <ul className="list-disc space-y-2 pl-5 text-[13px]">
        <li>API key create / list / revoke (session only)</li>
        <li>Connectors, OAuth, MCP setup</li>
        <li>Billing writes, wallet, member invites</li>
        <li>Cloud runner control, hybrid reissue, most `/agents/:id/tools/*` (runner token)</li>
        <li>
          Agent-signed <code className="font-mono">/actions/*</code> and{" "}
          <code className="font-mono">POST /jit/request</code>
        </li>
      </ul>
      <p>
        Additional mutations under <code className="font-mono">/teams/{"{id}"}/*</code> (
        <code className="font-mono">teams:write</code>) and <code className="font-mono">/ai-brain/*</code> (
        <code className="font-mono">brain:write</code>) may work even if they are not listed individually in the
        reference.
      </p>
    </div>
  );
}

export function DeveloperGuides({
  variant = "console",
  initialSection = "start",
  showTabs = true,
}: {
  readonly variant?: PortalVariant;
  readonly initialSection?: GuideSectionId;
  readonly showTabs?: boolean;
}) {
  const apiBase = developerApiBaseUrl();
  const [section, setSection] = useState<GuideSectionId>(initialSection);

  return (
    <div className={variant === "console" ? "flex flex-col gap-4" : "flex flex-col gap-6"}>
      {showTabs ? (
        <div className="flex flex-wrap gap-1.5">
          {GUIDE_SECTIONS.map((item) => {
            const selected = section === item.id;
            const className = selected ? portalTabActive[variant] : (portalTabIdle[variant] ?? sketchButton);
            return (
              <button key={item.id} type="button" onClick={() => setSection(item.id)} className={className}>
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
      <GuideSectionContent section={section} apiBase={apiBase} variant={variant} />
    </div>
  );
}
