"use client";

import { useEffect, useState } from "react";
import { listAgents } from "@/lib/agents-api";
import {
  getChannelDefaults,
  patchChannelDefaults,
  type ChannelDefaultsDTO,
} from "@/lib/connectors-api";
import { useSession } from "./session-context";
import { SketchBox, SketchSection, sketchButtonPrimary, sketchInput, sketchLabel } from "./sketch";

export function ChannelDefaultsPanel() {
  const { session } = useSession();
  const [defaults, setDefaults] = useState<ChannelDefaultsDTO | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [whatsappAgentId, setWhatsappAgentId] = useState("");
  const [slackAgentId, setSlackAgentId] = useState("");
  const [telegramAgentId, setTelegramAgentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const orgId = session?.organization.id ?? null;
    void Promise.all([getChannelDefaults(), listAgents(orgId)])
      .then(([d, a]) => {
        setDefaults(d);
        setAgents((a ?? []).map((x) => ({ id: x.id, name: x.name })));
        setWhatsappAgentId(d.whatsapp.agentId ?? "");
        setSlackAgentId(d.slack.agentId ?? "");
        setTelegramAgentId(d.telegram.agentId ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [session?.organization.id]);

  async function save() {
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      await patchChannelDefaults({
        whatsappAgentId: whatsappAgentId || null,
        slackAgentId: slackAgentId || null,
        telegramAgentId: telegramAgentId || null,
      });
      setOk(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const selectClass = `${sketchInput} mt-1`;

  return (
    <SketchSection title="Channel defaults">
      <SketchBox className="flex flex-col gap-3 p-4">
        <p className="text-[12px] text-black/60">
          Default agent for inbound WhatsApp, Slack, and Telegram when the message has no explicit
          routing.
        </p>
        {error ? <p className="text-[13px] text-[color:var(--sketch-red)]">{error}</p> : null}
        {ok ? <p className="text-[13px] text-black">Saved.</p> : null}
        {(
          [
            ["WhatsApp", whatsappAgentId, setWhatsappAgentId, defaults?.whatsapp.connected],
            ["Slack", slackAgentId, setSlackAgentId, defaults?.slack.connected],
            ["Telegram", telegramAgentId, setTelegramAgentId, defaults?.telegram.connected],
          ] as const
        ).map(([label, value, setter, connected]) => (
          <label key={label} className="block">
            <span className={sketchLabel}>
              {label} default agent
              {connected ? " · connected" : ""}
            </span>
            <select
              value={value}
              onChange={(e) => setter(e.target.value)}
              className={selectClass}
            >
              <option value="">— None —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button type="button" disabled={saving} onClick={() => void save()} className={sketchButtonPrimary}>
          {saving ? "Saving…" : "Save channel defaults"}
        </button>
      </SketchBox>
    </SketchSection>
  );
}
