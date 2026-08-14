"use client";

import { useEffect, useState } from "react";
import {
  API_KEY_SCOPE_OPTIONS,
  createApiKey,
  developerApiBaseUrl,
  listApiKeys,
  revokeApiKey,
  type ApiKeyRow,
} from "@/lib/api-keys-api";
import {
  SketchBox,
  SketchRow,
  sketchButton,
  sketchButtonPrimary,
  sketchInput,
  sketchLabel,
} from "@/components/qlix/sketch";
import { CopyTextButton } from "@/components/qlix/api-keys/CopyTextButton";

const ALL_SCOPE_IDS = API_KEY_SCOPE_OPTIONS.map((s) => s.id);

export function ApiKeysView() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(true);

  const [label, setLabel] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([...ALL_SCOPE_IDS]);
  const [creating, setCreating] = useState(false);
  const [justCreatedKey, setJustCreatedKey] = useState<string | null>(null);

  const apiBase = developerApiBaseUrl();

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await listApiKeys();
    if (!result) {
      setError("Could not load API keys.");
    } else {
      setKeys(result.keys);
      setCanManage(result.canManage);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  function toggleScope(scopeId: string) {
    setSelectedScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId],
    );
  }

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim() || selectedScopes.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createApiKey(label.trim(), selectedScopes);
      if (!result.ok) {
        setError(result.errorMessage);
        return;
      }
      setJustCreatedKey(result.key);
      setKeys((prev) => [result.row, ...prev]);
      setLabel("");
      setSelectedScopes([...ALL_SCOPE_IDS]);
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(id: string) {
    const ok = await revokeApiKey(id);
    if (ok) await load();
  }

  const bearerHeader = justCreatedKey ? `Authorization: Bearer ${justCreatedKey}` : "";
  const exportLine = justCreatedKey ? `export QLIX_API_KEY="${justCreatedKey}"` : "";
  const firstCall = justCreatedKey
    ? `export QLIX_API_KEY="${justCreatedKey}"\n\ncurl -sS \\\n  -H "Authorization: Bearer $QLIX_API_KEY" \\\n  "${apiBase}/api/v1/agents"`
    : "";

  return (
    <div className="flex flex-col gap-4">
      {justCreatedKey ? (
        <SketchBox className="flex flex-col gap-3 border-black p-4">
          <div>
            <span className={sketchLabel}>Your new API key (shown once)</span>
            <p className="mt-1 text-[13px] text-black/65">
              This value <strong className="text-black">is</strong> the Bearer token. Copy it now — Qlix will
              never display the full secret again.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-widest text-black/45">Secret key</span>
            <code className="break-all rounded-lg bg-black/5 p-3 font-mono text-[13px] text-black">
              {justCreatedKey}
            </code>
            <div className="flex flex-wrap gap-2">
              <CopyTextButton value={justCreatedKey} label="Copy key" />
              <CopyTextButton value={bearerHeader} label="Copy Authorization header" />
              <CopyTextButton value={exportLine} label="Copy export command" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-widest text-black/45">Try it now</span>
            <pre className="overflow-x-auto rounded-lg bg-black/[0.04] p-3 font-mono text-[11px] leading-relaxed text-black/85 whitespace-pre-wrap">
              {firstCall}
            </pre>
            <CopyTextButton value={firstCall} label="Copy first request" />
          </div>

          <button type="button" onClick={() => setJustCreatedKey(null)} className={`${sketchButton} self-start`}>
            I&apos;ve saved the key
          </button>
        </SketchBox>
      ) : null}

      {canManage ? (
        <SketchBox className="p-4">
          <h2 className="mb-1 font-serif text-[15px] text-black">Create a key</h2>
          <p className="mb-3 text-[12px] text-black/55">
            After you create it, copy the <code className="font-mono">qlix_live_…</code> secret and send it as{" "}
            <code className="font-mono">Authorization: Bearer …</code> on API requests.
          </p>
          <form onSubmit={onCreate} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                <label htmlFor="key-label" className={sketchLabel}>
                  Label
                </label>
                <input
                  id="key-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="e.g. CI pipeline"
                  className={sketchInput}
                />
              </div>
              <button
                type="submit"
                disabled={creating || !label.trim() || selectedScopes.length === 0}
                className={sketchButtonPrimary}
              >
                {creating ? "Creating…" : "Create key"}
              </button>
            </div>
            <div>
              <span className={sketchLabel}>Scopes</span>
              <p className="mt-0.5 text-[11px] text-black/45">
                Leave all checked for full Developer API access, or narrow for least privilege.
              </p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {API_KEY_SCOPE_OPTIONS.map((scope) => {
                  const checked = selectedScopes.includes(scope.id);
                  return (
                    <label
                      key={scope.id}
                      className="flex cursor-pointer items-center gap-2 text-[12px] text-black/80"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleScope(scope.id)}
                        className="accent-black"
                      />
                      <span>
                        {scope.label}{" "}
                        <span className="font-mono text-[10px] text-black/40">({scope.id})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={sketchButton}
                  onClick={() => setSelectedScopes([...ALL_SCOPE_IDS])}
                >
                  Select all
                </button>
                <button type="button" className={sketchButton} onClick={() => setSelectedScopes([])}>
                  Clear
                </button>
              </div>
            </div>
            {error ? <p className="text-[13px] text-[color:var(--sketch-red)]">{error}</p> : null}
          </form>
        </SketchBox>
      ) : (
        <SketchBox className="p-4">
          <p className="text-[13px] text-black/60">
            Only organization owners and admins can create or revoke API keys. Ask an admin for a key, or view
            keys attributed to you below.
          </p>
          {error ? <p className="mt-2 text-[13px] text-[color:var(--sketch-red)]">{error}</p> : null}
        </SketchBox>
      )}

      <SketchBox className="flex flex-col gap-2 p-3">
        <span className={sketchLabel}>Your keys</span>
        {loading ? (
          <p className={sketchLabel}>Loading…</p>
        ) : keys.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-black/50">
            No API keys yet. Create one above — the secret you get back is your Bearer token.
          </p>
        ) : (
          keys.map((k) => (
            <SketchRow key={k.id} className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-medium text-black">{k.label}</p>
                <p className="font-mono text-[11px] text-black/50">{k.keyPrefix}…</p>
                <p className="mt-0.5 text-[11px] text-black/40">
                  {k.scopes.length} scope{k.scopes.length === 1 ? "" : "s"}
                  {k.lastUsedAt ? ` · Last used ${new Date(k.lastUsedAt).toLocaleString()}` : " · Never used"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-black/50">
                  Created {new Date(k.createdAt).toLocaleDateString()}
                </span>
                {k.revokedAt ? (
                  <span className="font-serif text-[10px] uppercase text-black/40">Revoked</span>
                ) : canManage ? (
                  <button type="button" onClick={() => void onRevoke(k.id)} className={sketchButton}>
                    Revoke
                  </button>
                ) : null}
              </div>
            </SketchRow>
          ))
        )}
      </SketchBox>
    </div>
  );
}
