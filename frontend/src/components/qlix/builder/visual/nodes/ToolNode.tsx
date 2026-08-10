"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertCircle, AlertTriangle, ShieldCheck, Wrench } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { HANDLE, type BuilderNode } from "../builderTypes";

const HAIRLINE = "border-[color:var(--ink-border)]";
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const MICRO = "text-[9px] font-medium uppercase tracking-[0.16em]";

/**
 * A capability node. Dashed chrome sets it apart from agent nodes at a glance: agents are
 * things that act, tools are permissions those things are granted.
 *
 * The raw scope id is deliberately absent — it lives in the tooltip and the inspector. What
 * shows here is the friendly category and the two facts that change how it behaves.
 */
function ToolNodeComponent({ data, selected }: NodeProps<BuilderNode>) {
  const unavailable = data.available === false;
  const missing = data.missing === true;

  return (
    <div
      className={cn(
        "w-48 rounded-xl border border-dashed bg-white/70 px-3 py-2 backdrop-blur-sm transition-shadow duration-200",
        HAIRLINE,
        selected && "border-solid border-[color:var(--sketch-purple)]",
        (unavailable || missing) && "opacity-75",
      )}
      title={data.scopeId}
    >
      {/* Tools only ever connect into an agent's dedicated tools port. */}
      <Handle id={HANDLE.toolOut} type="source" position={Position.Top} />

      <div className="flex items-center gap-2">
        <Wrench size={11} className="shrink-0 text-black" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-[12px] font-medium leading-tight text-black">
          {data.label}
        </p>
      </div>

      {data.groupTitle && <p className={cn("mt-0.5", MICRO, INK_FAINT)}>{data.groupTitle}</p>}

      {(data.forceJit || unavailable || missing) && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {data.forceJit && (
            <p className={cn("flex items-center gap-1 text-[10px]", INK_SOFT)}>
              <ShieldCheck size={10} />
              Asks you before each use
            </p>
          )}
          {unavailable && !missing && (
            <p className="flex items-center gap-1 text-[10px] text-[color:var(--sketch-red)]">
              <AlertCircle size={10} />
              {data.requiresConnector
                ? `Connect ${data.requiresConnector} first`
                : "Needs setup before it works"}
            </p>
          )}
          {missing && (
            <p className="flex items-center gap-1 text-[10px] text-[color:var(--sketch-red)]">
              <AlertTriangle size={10} />
              No longer available
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export const ToolNode = memo(ToolNodeComponent);
