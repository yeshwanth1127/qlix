"use client";

import { useState } from "react";
import { SketchBox, sketchButton, sketchLabel } from "@/components/qlix/sketch";
import { API_KEY_SCOPE_OPTIONS } from "@/lib/api-keys-api";
import { CopyTextButton } from "./CopyTextButton";

type ManualSection = "start" | "auth" | "examples" | "scopes" | "errors";

const SECTIONS: { id: ManualSection; label: string }[] = [
  { id: "start", label: "1. Get started" },
  { id: "auth", label: "2. Authentication" },
  { id: "examples", label: "3. Common calls" },
  { id: "scopes", label: "4. Scopes" },
  { id: "errors", label: "5. Errors" },
];

function CodeBlock({ code, copyLabel = "Copy" }: { readonly code: string; readonly copyLabel?: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-black/[0.04] p-3 pr-24 font-mono text-[11px] leading-relaxed text-black/85 whitespace-pre-wrap break-all">
        {code}
      </pre>
      <div className="absolute right-2 top-2">
        <CopyTextButton value={code} label={copyLabel} />
      </div>
    </div>
  );
}

export function DeveloperApiManual({ apiBase }: { readonly apiBase: string }) {
  const [section, setSection] = useState<ManualSection>("start");

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
  "${apiBase}/api/v1/agents/AGENT_ID/conversations/CONVERSATION_ID/messages"`;

  const brainCurl = `curl -sS -X POST \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"What is our refund policy?"}' \\
  "${apiBase}/api/v1/ai-brain/query"`;

  const auditCurl = `curl -sS \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  "${apiBase}/api/v1/dashboard/audit"`;

  const teamRunCurl = `# List teams, then start a run
curl -sS -H "Authorization: Bearer $QLIX_API_KEY" \\
  "${apiBase}/api/v1/teams"

curl -sS -X POST \\
  -H "Authorization: Bearer $QLIX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"goal":"Research competitors and draft a summary"}' \\
  "${apiBase}/api/v1/teams/TEAM_ID/runs"`;

  const pythonSnippet = `import os
import requests

API_BASE = "${apiBase}"
API_KEY = os.environ["QLIX_API_KEY"]  # export QLIX_API_KEY=qlix_live_...

headers = {"Authorization": f"Bearer {API_KEY}"}

agents = requests.get(f"{API_BASE}/api/v1/agents", headers=headers, timeout=30)
agents.raise_for_status()
print(agents.json())`;

  const jsSnippet = `const API_BASE = "${apiBase}";
const API_KEY = process.env.QLIX_API_KEY; // qlix_live_...

const res = await fetch(\`\${API_BASE}/api/v1/agents\`, {
  headers: { Authorization: \`Bearer \${API_KEY}\` },
});
if (!res.ok) throw new Error(await res.text());
console.log(await res.json());`;

  return (
    <SketchBox className="flex flex-col gap-4 border-black/25 p-4">
      <div>
        <h2 className="font-serif text-[15px] text-black">Developer API manual</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-black/65">
          Your API key <em>is</em> the Bearer token. Create a key below, copy it once, then send it on every
          request as <code className="rounded bg-black/5 px-1 font-mono text-[12px]">Authorization: Bearer …</code>.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((item) => {
          const selected = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={
                selected
                  ? "inline-flex items-center justify-center rounded-full border border-[color:var(--sketch-purple)] bg-[color:var(--sketch-purple-soft)] px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[color:var(--sketch-purple)]"
                  : sketchButton
              }
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {section === "start" ? (
        <div className="flex flex-col gap-4 text-[13px] leading-relaxed text-black/75">
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              <strong className="text-black">Create a key</strong> in the form below. Give it a label (e.g.{" "}
              <em>CI pipeline</em> or <em>local scripts</em>) and choose scopes. Click <em>Create key</em>.
            </li>
            <li>
              <strong className="text-black">Copy the secret immediately.</strong> Qlix shows the full{" "}
              <code className="rounded bg-black/5 px-1 font-mono text-[12px]">qlix_live_…</code> string only
              once. That string is your Bearer token — store it in a password manager or env var. We never show
              it again.
            </li>
            <li>
              <strong className="text-black">Put it in your environment:</strong>
              <div className="mt-2">
                <CodeBlock
                  code={`export QLIX_API_KEY="qlix_live_paste_your_key_here"`}
                  copyLabel="Copy export"
                />
              </div>
            </li>
            <li>
              <strong className="text-black">Make your first call</strong> — list agents in your workspace:
              <div className="mt-2">
                <CodeBlock code={listAgentsCurl} copyLabel="Copy curl" />
              </div>
            </li>
          </ol>
          <p className="rounded-lg border border-black/10 bg-black/[0.02] p-3 text-[12px] text-black/60">
            Base URL for this workspace:{" "}
            <code className="font-mono text-black/80">{apiBase}</code>
            <span className="ml-2 inline-block align-middle">
              <CopyTextButton value={apiBase} label="Copy base URL" />
            </span>
          </p>
        </div>
      ) : null}

      {section === "auth" ? (
        <div className="flex flex-col gap-4 text-[13px] leading-relaxed text-black/75">
          <p>
            Every Developer API request must identify your account. Pass the key you created on this page —
            not your password, and not the browser session cookie.
          </p>
          <div>
            <span className={sketchLabel}>Recommended — Authorization header</span>
            <div className="mt-2">
              <CodeBlock
                code={`Authorization: Bearer qlix_live_YOUR_KEY_HERE`}
                copyLabel="Copy header"
              />
            </div>
          </div>
          <div>
            <span className={sketchLabel}>Alternative — X-Api-Key header</span>
            <div className="mt-2">
              <CodeBlock code={`X-Api-Key: qlix_live_YOUR_KEY_HERE`} copyLabel="Copy header" />
            </div>
          </div>
          <ul className="list-disc space-y-2 pl-5 text-[12px] text-black/65">
            <li>
              The key acts as <em>you</em> (same org and role). Org members cannot create keys — ask an owner
              or admin.
            </li>
            <li>Keys cannot create or revoke other keys. Manage keys only while signed into this console.</li>
            <li>Revoke a key instantly from the list below if it leaks.</li>
            <li>
              Agent-signed actions (<code className="font-mono">/actions</code>) and cloud/hybrid runners use
              different credentials — those are not API keys.
            </li>
          </ul>
          <div>
            <span className={sketchLabel}>Python</span>
            <div className="mt-2">
              <CodeBlock code={pythonSnippet} copyLabel="Copy Python" />
            </div>
          </div>
          <div>
            <span className={sketchLabel}>Node / browser fetch</span>
            <div className="mt-2">
              <CodeBlock code={jsSnippet} copyLabel="Copy JS" />
            </div>
          </div>
        </div>
      ) : null}

      {section === "examples" ? (
        <div className="flex flex-col gap-5 text-[13px] leading-relaxed text-black/75">
          <p>Replace <code className="font-mono text-[12px]">AGENT_ID</code> /{" "}
            <code className="font-mono text-[12px]">TEAM_ID</code> with ids from list endpoints. Set{" "}
            <code className="font-mono text-[12px]">QLIX_API_KEY</code> first.</p>
          <div>
            <span className={sketchLabel}>List agents (Layer 3)</span>
            <div className="mt-2">
              <CodeBlock code={listAgentsCurl} />
            </div>
          </div>
          <div>
            <span className={sketchLabel}>Start an agent run</span>
            <div className="mt-2">
              <CodeBlock code={createConversationCurl} />
            </div>
          </div>
          <div>
            <span className={sketchLabel}>Query AI Brain</span>
            <div className="mt-2">
              <CodeBlock code={brainCurl} />
            </div>
          </div>
          <div>
            <span className={sketchLabel}>Start a team run</span>
            <div className="mt-2">
              <CodeBlock code={teamRunCurl} />
            </div>
          </div>
          <div>
            <span className={sketchLabel}>Read audit log (Layer 5)</span>
            <div className="mt-2">
              <CodeBlock code={auditCurl} />
            </div>
          </div>
          <a
            href={`${apiBase}/api/v1/openapi.json`}
            target="_blank"
            rel="noreferrer"
            className="self-start text-[12px] text-black underline underline-offset-2 hover:text-black/70"
          >
            Full OpenAPI reference (machine-readable) →
          </a>
        </div>
      ) : null}

      {section === "scopes" ? (
        <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-black/75">
          <p>
            Scopes limit what a key can do. Session login in this console is unrestricted; API keys are not.
            Pick the minimum your integration needs.
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
                    <td className="py-2 text-black/65">{scope.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {section === "errors" ? (
        <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-black/75">
          <p>Responses use JSON shaped like{" "}
            <code className="rounded bg-black/5 px-1 font-mono text-[12px]">
              {"{ \"error\": { \"code\": \"…\", \"message\": \"…\" } }"}
            </code>
            .
          </p>
          <ul className="list-disc space-y-2 pl-5 text-[12px]">
            <li>
              <code className="font-mono">401 unauthorized</code> — missing key, wrong key, or revoked key.
              Recreate a key if you lost the secret.
            </li>
            <li>
              <code className="font-mono">403 insufficient_scope</code> — key is valid but lacks the scope for
              that route. Create a new key with the needed scopes (or broaden scopes on a new key).
            </li>
            <li>
              <code className="font-mono">403 api_key_not_allowed</code> — endpoint is console-only (not in the
              Developer API). Use a different route from the OpenAPI list.
            </li>
            <li>
              <code className="font-mono">403 session_required</code> — you tried to manage keys with an API
              key. Sign into the console instead.
            </li>
            <li>
              <code className="font-mono">429 rate_limited</code> — slow down; API keys share a per-key minute
              budget.
            </li>
          </ul>
        </div>
      ) : null}
    </SketchBox>
  );
}
