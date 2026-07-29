"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus, RotateCcw, X } from "lucide-react";
import {
  getMcpServerSecretKeys,
  updateMcpServer,
  type McpServerDTO,
  type UpdateMcpServerInput,
} from "@/lib/mcp-api";
import { SketchBox, sketchButton, sketchInput, sketchLabel } from "@/components/qlix/sketch";

interface SecretRow {
  key: string;
  value: string;
  existing: boolean;
  remove: boolean;
}

interface McpEditServerProps {
  readonly server: McpServerDTO;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}

export function McpEditServer({ server, onSaved, onCancel }: McpEditServerProps) {
  const isHttp = server.transport === "http";
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const [endpointUrl, setEndpointUrl] = useState(server.endpointUrl ?? "");
  const [command, setCommand] = useState(server.command ?? "");
  const [args, setArgs] = useState((server.args ?? []).join(" "));
  const [rows, setRows] = useState<SecretRow[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const secretLabel = isHttp ? "Headers" : "Environment variables";

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const keys = await getMcpServerSecretKeys(server.id);
        if (!active) return;
        const names = isHttp ? keys.headers : keys.env;
        setRows(names.map((key) => ({ key, value: "", existing: true, remove: false })));
      } catch {
        // Non-fatal
      } finally {
        if (active) setLoadingKeys(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [server.id, isHttp]);

  function updateRow(i: number, patch: Partial<SecretRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setRows((rs) => {
      const row = rs[i];
      if (row.existing) return rs.map((r, idx) => (idx === i ? { ...r, remove: true } : r));
      return rs.filter((_, idx) => idx !== i);
    });
  }

  function buildSecretMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const row of rows) {
      const key = row.key.trim();
      if (!key) continue;
      if (row.existing && row.remove) {
        map[key] = "";
        continue;
      }
      if (row.value.trim() !== "") map[key] = row.value;
    }
    return map;
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const input: UpdateMcpServerInput = { name: name.trim(), description: description.trim() };
      if (isHttp) {
        input.endpointUrl = endpointUrl.trim();
      } else {
        input.command = command.trim();
        input.args = args.split(/\s+/).map((a) => a.trim()).filter(Boolean);
      }
      const map = buildSecretMap();
      if (Object.keys(map).length > 0) {
        if (isHttp) input.headers = map;
        else input.env = map;
      }
      await updateMcpServer(server.id, input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SketchBox className="mt-3 p-4">
      <button type="button" onClick={onCancel} className={`${sketchButton} gap-1`}>
        <ArrowLeft size={13} /> Done
      </button>

      {error && (
        <SketchBox className="mt-3 px-3 py-2 text-[12px] text-black">{error}</SketchBox>
      )}

      <div className="mt-3 space-y-3">
        <label className="block text-[12px] text-black/70">
          Name
          <input className={`${sketchInput} mt-1`} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-[12px] text-black/70">
          Description
          <input className={`${sketchInput} mt-1`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        {isHttp ? (
          <label className="block text-[12px] text-black/70">
            Endpoint URL
            <input className={`${sketchInput} mt-1`} value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} />
          </label>
        ) : (
          <>
            <label className="block text-[12px] text-black/70">
              Command
              <input className={`${sketchInput} mt-1`} value={command} onChange={(e) => setCommand(e.target.value)} />
            </label>
            <label className="block text-[12px] text-black/70">
              Arguments (space-separated)
              <input className={`${sketchInput} mt-1`} value={args} onChange={(e) => setArgs(e.target.value)} />
            </label>
          </>
        )}

        <div>
          <p className={sketchLabel}>{secretLabel}</p>
          {loadingKeys ? (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-black/50">
              <Loader2 size={11} className="animate-spin" /> Loading…
            </p>
          ) : (
            <div className="mt-1 space-y-2">
              {rows.map((row, i) => (
                <div key={`${row.existing ? "x" : "n"}-${i}`} className="flex items-center gap-2">
                  <input
                    className={`${sketchInput} mt-0 flex-1 font-mono ${row.remove ? "line-through opacity-40" : ""}`}
                    value={row.key}
                    readOnly={row.existing}
                    placeholder={isHttp ? "Header name" : "ENV_NAME"}
                    onChange={(e) => updateRow(i, { key: e.target.value })}
                  />
                  <input
                    className={`${sketchInput} mt-0 flex-1`}
                    type="password"
                    autoComplete="off"
                    value={row.value}
                    disabled={row.remove}
                    placeholder={row.existing ? "•••••• (unchanged)" : "value"}
                    onChange={(e) => updateRow(i, { value: e.target.value })}
                  />
                  {row.existing && row.remove ? (
                    <button type="button" onClick={() => updateRow(i, { remove: false })} title="Keep" className={sketchButton}>
                      <RotateCcw size={13} />
                    </button>
                  ) : (
                    <button type="button" onClick={() => removeRow(i)} title="Remove" className={sketchButton}>
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setRows((rs) => [...rs, { key: "", value: "", existing: false, remove: false }])}
                className={`${sketchButton} gap-1`}
              >
                <Plus size={12} /> Add {isHttp ? "header" : "variable"}
              </button>
              <p className="text-[10px] text-black/40">
                Leave a value blank to keep it unchanged. Stored values are never shown.
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving || !name.trim() || (isHttp ? !endpointUrl.trim() : !command.trim())}
          className={`${sketchButton} disabled:opacity-40`}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </SketchBox>
  );
}
