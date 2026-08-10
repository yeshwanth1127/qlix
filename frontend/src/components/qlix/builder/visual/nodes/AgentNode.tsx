"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Bot, Cloud, Crown, Laptop } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { HANDLE, type BuilderNode } from "../builderTypes";

const HAIRLINE = "border-[color:var(--ink-border)]";
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const MICRO = "text-[9px] font-medium uppercase tracking-[0.16em]";

/** Plain-language runtime label — never "runner", "container", or "daemon". */
function runtimeLabel(runtime?: string): { text: string; onDevice: boolean } | null {
  if (runtime === "hybrid" || runtime === "local") {
    return { text: "Runs on your computer", onDevice: true };
  }
  if (runtime === "cloud") return { text: "Runs in Qlix", onDevice: false };
  return null;
}

function AgentNodeComponent({ data, selected }: NodeProps<BuilderNode>) {
  const isSupervisor = data.kind === "supervisor";
  const scopes = data.scopes ?? [];
  const visibleScopes = scopes.slice(0, 3);
  const overflow = scopes.length - visibleScopes.length;
  const runtime = runtimeLabel(data.runtime);
  const missing = data.missing === true;

  return (
    <div
      className={cn(
        "w-56 rounded-2xl border bg-white/80 backdrop-blur-sm transition-shadow duration-200",
        HAIRLINE,
        selected
          ? "border-[color:var(--sketch-purple)] shadow-[0_10px_28px_-14px_rgba(16,14,22,0.5)]"
          : "shadow-[0_6px_18px_-14px_rgba(16,14,22,0.45)]",
        missing && "border-dashed opacity-70",
        data.groupKind === "team" && !selected && "border-[color:var(--ink-soft)]",
      )}
    >
      {/* Work arrives here from an upstream agent. */}
      <Handle id={HANDLE.flowIn} type="target" position={Position.Left} />

      <div className={cn("flex items-center gap-2 border-b px-3 py-2", HAIRLINE)}>
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full",
            isSupervisor ? "bg-black text-white" : cn("border bg-white/70 text-black", HAIRLINE),
          )}
          aria-hidden
        >
          {isSupervisor ? <Crown size={12} /> : <Bot size={12} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium leading-tight text-black">
            {data.label}
          </p>
          <p className={cn(MICRO, INK_FAINT)}>{isSupervisor ? "Leads the team" : "Agent"}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 px-3 py-2">
        {missing ? (
          <p className="flex items-start gap-1 text-[11px] leading-relaxed text-[color:var(--sketch-red)]">
            <AlertTriangle size={11} className="mt-px shrink-0" />
            This agent no longer exists. Remove it or swap in another.
          </p>
        ) : (
          <>
            {data.description && (
              <p className={cn("line-clamp-2 text-[11px] leading-relaxed", INK_SOFT)}>
                {data.description}
              </p>
            )}

            {runtime && (
              <p className={cn("flex items-center gap-1 text-[10px]", INK_FAINT)}>
                {runtime.onDevice ? <Laptop size={10} /> : <Cloud size={10} />}
                {runtime.text}
              </p>
            )}

            {scopes.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {visibleScopes.map((scope) => (
                  <span
                    key={scope}
                    className={cn(
                      "max-w-full truncate rounded-full border px-1.5 py-0.5 text-[9px]",
                      HAIRLINE,
                      INK_SOFT,
                    )}
                    title={scope}
                  >
                    {scope}
                  </span>
                ))}
                {overflow > 0 && (
                  <span className={cn("px-1 py-0.5 text-[9px]", INK_FAINT)}>+{overflow} more</span>
                )}
              </div>
            ) : (
              <p className={cn("text-[10px]", INK_FAINT)}>No tools yet</p>
            )}
          </>
        )}
      </div>

      {/* The dedicated third port: tools attach here, never to the flow ports. */}
      <div
        className={cn(
          "flex items-center justify-center gap-1 border-t py-1",
          HAIRLINE,
          MICRO,
          INK_FAINT,
        )}
      >
        Tools
      </div>
      <Handle
        id={HANDLE.tools}
        type="target"
        position={Position.Bottom}
        className="qlix-tool-port"
      />

      {/* Work passes from here to a downstream agent. */}
      <Handle id={HANDLE.flowOut} type="source" position={Position.Right} />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
