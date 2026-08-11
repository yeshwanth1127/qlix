"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import {
  ALL_PERMISSION_SCOPES,
  type AgentDTO,
  FORCE_JIT_SCOPES,
  PERMISSION_SCOPE_LABELS,
  type PermissionScope,
  fetchScopeCatalog,
  updateAgentScopes,
} from "@/lib/agents-api";
import { sketchButton, sketchLabel } from "@/components/qlix/sketch";

interface AgentScopesEditorProps {
  readonly agent: AgentDTO;
  readonly orgId: string | null;
  readonly onUpdated: (agent: AgentDTO) => void;
}

export function AgentScopesEditor({ agent, orgId, onUpdated }: AgentScopesEditorProps) {
  const [editing, setEditing] = useState(false);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof fetchScopeCatalog>>>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>(agent.permissionScopes);
  const [jitSelected, setJitSelected] = useState<string[]>(agent.jitScopes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    void fetchScopeCatalog(orgId ?? agent.orgId).then((rows) => {
      if (cancelled) return;
      setCatalog(rows);
      setCatalogLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, agent.orgId]);

  const scopeOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string; description: string; forceJit: boolean }>();

    for (const id of ALL_PERMISSION_SCOPES) {
      map.set(id, {
        id,
        label: PERMISSION_SCOPE_LABELS[id],
        description: "",
        forceJit: FORCE_JIT_SCOPES.includes(id),
      });
    }
    for (const row of catalog ?? []) {
      map.set(row.id, row);
    }
    for (const id of agent.permissionScopes) {
      if (!map.has(id)) {
        map.set(id, { id, label: id, description: "Currently assigned", forceJit: false });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
  }, [catalog, agent.permissionScopes]);

  const startEdit = () => {
    setSelected([...agent.permissionScopes]);
    setJitSelected([...agent.jitScopes]);
    setError(null);
    setRefreshNotice(null);
    setEditing(true);
  };

  const toggleScope = (id: string) => {
    setSelected((prev) => {
      const set = new Set(prev);
      if (set.has(id)) {
        set.delete(id);
        setJitSelected((jit) => jit.filter((s) => s !== id));
      } else {
        set.add(id);
      }
      return Array.from(set);
    });
  };

  const toggleJit = (id: string, forceJit: boolean) => {
    if (forceJit || FORCE_JIT_SCOPES.includes(id as PermissionScope)) return;
    setJitSelected((prev) => {
      const set = new Set(prev);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return Array.from(set);
    });
  };

  const handleSave = async () => {
    if (selected.length === 0) {
      setError("Select at least one scope.");
      return;
    }
    setSaving(true);
    setError(null);
    const forcedJit = selected.filter(
      (s) =>
        FORCE_JIT_SCOPES.includes(s as PermissionScope) ||
        scopeOptions.find((o) => o.id === s)?.forceJit,
    );
    const jitScopes = Array.from(
      new Set([...jitSelected.filter((s) => selected.includes(s)), ...forcedJit]),
    );
    const res = await updateAgentScopes(agent.id, selected, jitScopes);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onUpdated(res.agent);
    if (res.runnerRefresh === "restarting") {
      setRefreshNotice("Cloud runner is restarting so new scopes take effect.");
    } else if (res.runnerRefresh === "hybrid_reissue_recommended") {
      setRefreshNotice(
        "Scopes saved. If a newly added tool still doesn't appear, re-download the hybrid starter pack.",
      );
    } else {
      setRefreshNotice(null);
    }
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="mt-2 space-y-1.5">
        <button
          type="button"
          onClick={startEdit}
          className={`${sketchButton} gap-1.5`}
          disabled={catalogLoading}
        >
          {catalogLoading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Plus className="size-3.5" aria-hidden />
          )}
          Add or remove scopes
        </button>
        {refreshNotice ? <p className="text-[11px] text-black/55">{refreshNotice}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 border border-black bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className={sketchLabel}>Manage permission scopes</p>
        {catalogLoading ? (
          <Loader2 className="size-4 animate-spin text-black/50" aria-hidden />
        ) : null}
      </div>
      <p className="text-[11px] text-black/50">
        Check scopes to grant. Uncheck to remove. MCP tools (e.g. qlix-jobs) appear when registered
        for your workspace.
      </p>
      {scopeOptions.length === 0 ? (
        <p className="text-[12px] text-black/60">No scopes available — try refreshing the page.</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {scopeOptions.map((scope) => {
            const checked = selected.includes(scope.id);
            const forceJit =
              scope.forceJit || FORCE_JIT_SCOPES.includes(scope.id as PermissionScope);
            const jitOn = forceJit || jitSelected.includes(scope.id);
            return (
              <li
                key={scope.id}
                className="flex flex-col gap-1 border border-black px-2 py-1.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleScope(scope.id)}
                    className="mt-0.5 accent-black"
                  />
                  <span className="min-w-0">
                    <span className="block font-mono text-[11px] text-black">{scope.id}</span>
                    <span className="block text-[11px] text-black/50">{scope.label}</span>
                  </span>
                </label>
                {checked ? (
                  <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-black/60">
                    <input
                      type="checkbox"
                      checked={jitOn}
                      disabled={forceJit}
                      onChange={() => toggleJit(scope.id, forceJit)}
                    />
                    JIT{forceJit ? " (required)" : ""}
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p className="text-[12px] text-black">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving || selected.length === 0}
          onClick={() => void handleSave()}
          className={`${sketchButton} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Check className="size-3.5" aria-hidden />
          )}
          Save scopes
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          className={sketchButton}
        >
          <X className="size-3.5" aria-hidden />
          Cancel
        </button>
      </div>
    </div>
  );
}
