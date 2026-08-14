"use client";

import { useState } from "react";
import {
  buildRequestUrl,
  type ExplorerOperation,
  type SnippetValues,
} from "@/lib/developer-api";
import { sketchButton, sketchButtonPrimary, sketchInput, sketchLabel } from "@/components/qlix/sketch";

export function ApiTryItPanel({
  operation,
  values,
}: {
  readonly operation: ExplorerOperation;
  readonly values: SnippetValues;
}) {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [responseText, setResponseText] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (operation.isSse) {
    return (
      <p className="text-[12px] text-black/55">
        SSE streams are not executed here. Copy the curl snippet and run it with{" "}
        <code className="font-mono">curl -N</code>.
      </p>
    );
  }

  async function run() {
    if (operation.isDestructive) {
      const ok = window.confirm(
        `This will send ${operation.method.toUpperCase()} ${operation.path}. Continue?`,
      );
      if (!ok) return;
    }
    setRunning(true);
    setError(null);
    setStatus(null);
    setResponseText(null);
    try {
      const url = buildRequestUrl(values.apiRoot, operation, values);
      const headers: Record<string, string> = {};
      const key = apiKey.trim();
      if (key) headers.Authorization = `Bearer ${key}`;
      const method = operation.method.toUpperCase();
      const init: RequestInit = {
        method,
        credentials: key ? "omit" : "include",
        headers,
      };
      if (values.body.trim() && method !== "GET" && method !== "HEAD") {
        headers["Content-Type"] = "application/json";
        init.body = values.body.trim();
      }
      const response = await fetch(url, init);
      setStatus(response.status);
      const text = await response.text();
      try {
        setResponseText(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResponseText(text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="try-it-key" className={sketchLabel}>
          API key (optional)
        </label>
        <input
          id="try-it-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Leave empty to use your console session"
          className={sketchInput}
          autoComplete="off"
        />
        <p className="text-[11px] text-black/45">
          Empty uses your signed-in session (no API-key scope checks). Paste a{" "}
          <code className="font-mono">qlix_live_…</code> key to test scopes.
        </p>
      </div>
      <button type="button" onClick={() => void run()} disabled={running} className={sketchButtonPrimary}>
        {running ? "Sending…" : "Send request"}
      </button>
      {error ? <p className="text-[13px] text-[color:var(--sketch-red)]">{error}</p> : null}
      {status !== null ? (
        <div className="flex flex-col gap-1.5">
          <span className={sketchLabel}>Response {status}</span>
          <pre className="max-h-80 overflow-auto rounded-lg bg-black/[0.04] p-3 font-mono text-[11px] leading-relaxed text-black/85 whitespace-pre-wrap break-all">
            {responseText || "(empty)"}
          </pre>
          <button type="button" className={`${sketchButton} self-start`} onClick={() => setResponseText(null)}>
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
