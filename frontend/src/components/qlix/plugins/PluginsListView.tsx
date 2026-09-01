"use client";

import { useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import { disablePlugin, enablePlugin, listPlugins, type PluginDTO } from "@/lib/plugins-api";
import { useSession } from "@/components/qlix/session-context";
import { SketchBox, SketchPageHeader, SketchRow, sketchLabel } from "@/components/qlix/sketch";

export function PluginsListView({
  routePrefix,
}: {
  readonly routePrefix: "/individual" | "/organization";
}) {
  const { refresh } = useSession();
  const [loading, setLoading] = useState(true);
  const [plugins, setPlugins] = useState<PluginDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listPlugins()
      .then((rows) => {
        if (cancelled) return;
        if (!rows) {
          setError("Could not load plugins.");
          setPlugins([]);
          return;
        }
        setPlugins(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(plugin: PluginDTO) {
    setPendingId(plugin.id);
    setError(null);
    const updated = plugin.enabled ? await disablePlugin(plugin.id) : await enablePlugin(plugin.id);
    setPendingId(null);
    if (!updated) {
      setError(`Could not ${plugin.enabled ? "disable" : "enable"} ${plugin.name}.`);
      return;
    }
    setPlugins(updated);
    // Nav reads session.organization.enabledPluginIds — refresh so a newly enabled
    // plugin's nav item appears immediately instead of on the next navigation.
    void refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SketchPageHeader title="Plugins" />
      <p className="mb-4 font-serif text-[11px] uppercase tracking-widest text-black/50">
        Optional capabilities you can turn on or off
      </p>
      <SketchBox className="flex flex-col gap-2 p-3">
        {loading ? (
          <p className={sketchLabel}>Loading…</p>
        ) : error ? (
          <p className="text-[13px] text-black">{error}</p>
        ) : plugins.length === 0 ? (
          <p className="py-8 text-center font-serif text-[11px] uppercase tracking-widest text-black/50">
            No plugins available
          </p>
        ) : (
          plugins.map((plugin) => (
            <SketchRow key={plugin.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <Puzzle className="mt-0.5 size-4 text-black/40" aria-hidden />
                <div>
                  <div className="text-[13px] font-medium text-black">{plugin.name}</div>
                  <p className="max-w-xl text-[12px] text-black/60">{plugin.description}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={pendingId === plugin.id}
                onClick={() => void toggle(plugin)}
                className="shrink-0 border border-black/20 px-3 py-1.5 font-serif text-[11px] uppercase tracking-widest text-black transition hover:border-black/40 disabled:opacity-50"
              >
                {pendingId === plugin.id ? "…" : plugin.enabled ? "Disable" : "Enable"}
              </button>
            </SketchRow>
          ))
        )}
      </SketchBox>
    </div>
  );
}
