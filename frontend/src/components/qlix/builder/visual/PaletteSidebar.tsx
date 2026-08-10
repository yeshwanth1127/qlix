"use client";

import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Crown,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { AgentDTO, ScopeCatalogEntry } from "@/lib/agents-api";
import { cn } from "@/lib/utils/cn";
import {
  BUILDER_DRAG_TYPE,
  agentNodeData,
  type BuilderDragPayload,
} from "./builderTypes";
import { filterGroups, groupScopes, groupTitleForScope, type ReadableTool } from "./toolCatalog";

const HAIRLINE = "border-[color:var(--ink-border)]";
const INK_SOFT = "text-[color:var(--ink-soft)]";
const INK_FAINT = "text-[color:var(--ink-faint)]";
const MICRO = "text-[10px] font-medium uppercase tracking-[0.16em]";

function startDrag(event: DragEvent<HTMLElement>, payload: BuilderDragPayload) {
  event.dataTransfer.setData(BUILDER_DRAG_TYPE, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "copy";
}

function Collapsible({
  title,
  count,
  open,
  onToggle,
  action,
  children,
}: {
  readonly title: string;
  readonly count?: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-black transition-colors hover:bg-black/[0.04]",
            MICRO,
          )}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="min-w-0 flex-1 truncate text-left">{title}</span>
          {count != null && <span className={INK_FAINT}>{count}</span>}
        </button>
        {action && <div className="pr-2">{action}</div>}
      </div>
      {open && <div className="flex flex-col gap-1 px-2 pb-2">{children}</div>}
    </section>
  );
}

/** Shared chrome for every draggable palette entry. */
function PaletteItem({
  icon,
  title,
  badges,
  tooltip,
  payload,
  muted,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly badges?: ReactNode;
  readonly tooltip?: string;
  readonly payload: BuilderDragPayload;
  readonly muted?: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(event) => startDrag(event, payload)}
      title={tooltip}
      className={cn(
        "flex cursor-grab items-start gap-2 rounded-xl border bg-white/60 px-2.5 py-1.5 transition-colors hover:border-[color:var(--sketch-purple)]/50 hover:bg-white/85 active:cursor-grabbing",
        HAIRLINE,
        muted && "opacity-65",
      )}
    >
      <span className="mt-0.5 shrink-0 text-black" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] leading-tight text-black">{title}</p>
        {badges}
      </div>
    </div>
  );
}

/**
 * Tool row. The raw scope id never appears here — it lives in the tooltip and the inspector.
 * What a user needs at a glance is the plain name plus the two facts that change behaviour:
 * whether it will interrupt them, and whether it works at all yet.
 */
function ToolRow({ tool }: { readonly tool: ReadableTool }) {
  const badges =
    tool.forceJit || tool.unavailable ? (
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        {tool.forceJit && (
          <span className={cn("inline-flex items-center gap-0.5 text-[9.5px]", INK_SOFT)}>
            <ShieldCheck size={9} />
            Asks first
          </span>
        )}
        {tool.unavailable && (
          <span className="text-[9.5px] text-[color:var(--sketch-red)]">
            {tool.needsConnector ? `Needs ${tool.needsConnector}` : "Needs setup"}
          </span>
        )}
      </div>
    ) : undefined;

  return (
    <PaletteItem
      icon={<Wrench size={12} />}
      title={tool.label}
      badges={badges}
      tooltip={`${tool.description}\n\n${tool.id}`}
      muted={tool.unavailable}
      payload={{
        kind: "tool",
        data: {
          kind: "tool",
          label: tool.label,
          scopeId: tool.id,
          description: tool.description,
          groupTitle: groupTitleForScope(tool.id),
          forceJit: tool.forceJit,
          available: !tool.unavailable,
          requiresConnector: tool.needsConnector,
        },
      }}
    />
  );
}

export interface PaletteSidebarProps {
  readonly agents: AgentDTO[];
  readonly scopes: ScopeCatalogEntry[];
  readonly loading: boolean;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onCreateAgent: () => void;
}

export function PaletteSidebar({
  agents,
  scopes,
  loading,
  collapsed,
  onToggleCollapsed,
  onCreateAgent,
}: PaletteSidebarProps) {
  const [query, setQuery] = useState("");
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [closedGroups, setClosedGroups] = useState<ReadonlySet<string>>(new Set());

  const needle = query.trim().toLowerCase();

  const filteredAgents = useMemo(
    () => (needle ? agents.filter((agent) => agent.name.toLowerCase().includes(needle)) : agents),
    [agents, needle],
  );

  const toolGroups = useMemo(() => groupScopes(scopes), [scopes]);
  const visibleGroups = useMemo(() => filterGroups(toolGroups, query), [toolGroups, query]);

  const toggleGroup = (id: string) =>
    setClosedGroups((closed) => {
      const next = new Set(closed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (collapsed) {
    return (
      <aside
        className={cn(
          "flex w-11 shrink-0 flex-col items-center gap-2 border-r bg-white/45 py-3 backdrop-blur-sm",
          HAIRLINE,
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Show library"
          title="Show library"
          className="grid size-7 place-items-center rounded-lg text-black transition-colors hover:bg-black/[0.06]"
        >
          <PanelLeftOpen size={14} />
        </button>
        <Bot size={13} className={INK_FAINT} aria-hidden />
        <Wrench size={13} className={INK_FAINT} aria-hidden />
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "flex w-60 shrink-0 flex-col overflow-hidden border-r bg-white/45 backdrop-blur-sm",
        HAIRLINE,
      )}
    >
      <div className={cn("flex items-center gap-1 border-b px-3 py-2", HAIRLINE)}>
        <span className={cn("flex-1", MICRO, "text-black")}>Library</span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Hide library"
          title="Hide library"
          className="grid size-6 place-items-center rounded-lg text-black transition-colors hover:bg-black/[0.06]"
        >
          <PanelLeftClose size={13} />
        </button>
      </div>

      <div className={cn("border-b px-2 py-2", HAIRLINE)}>
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-xl border bg-white/70 px-2 py-1 focus-within:border-[color:var(--sketch-purple)]/50",
            HAIRLINE,
          )}
        >
          <Search size={11} className={INK_FAINT} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents and tools"
            aria-label="Search the library"
            className="min-w-0 flex-1 bg-transparent py-0.5 text-[12px] text-black outline-none placeholder:text-[color:var(--ink-faint)]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <p className={cn("px-3 py-3", MICRO, INK_FAINT)}>Loading…</p>
        ) : (
          <>
            <Collapsible
              title="Agents"
              count={filteredAgents.length}
              open={agentsOpen}
              onToggle={() => setAgentsOpen((open) => !open)}
              action={
                <button
                  type="button"
                  onClick={onCreateAgent}
                  title="Create a new agent"
                  aria-label="Create a new agent"
                  className="grid size-6 place-items-center rounded-lg text-black transition-colors hover:bg-black/[0.06]"
                >
                  <Plus size={13} />
                </button>
              }
            >
              <PaletteItem
                icon={<Crown size={12} />}
                title="Team lead"
                tooltip="Plans the work and hands each step to an agent."
                payload={{
                  kind: "supervisor",
                  data: {
                    kind: "supervisor",
                    label: "Team lead",
                    description: "Plans the work and hands each step to an agent.",
                  },
                }}
              />

              {filteredAgents.length === 0 ? (
                <p className={cn("px-1 py-2 text-[11px] leading-relaxed", INK_SOFT)}>
                  {needle ? "No agents match that search." : "No agents yet — use + to make one."}
                </p>
              ) : (
                filteredAgents.map((agent) => (
                  <PaletteItem
                    key={agent.id}
                    icon={<Bot size={12} />}
                    title={agent.name}
                    badges={
                      <p className={cn("mt-0.5 truncate text-[9.5px]", INK_FAINT)}>{agent.model}</p>
                    }
                    tooltip={agent.description ?? agent.name}
                    payload={{ kind: "agent", data: agentNodeData(agent) }}
                  />
                ))
              )}
            </Collapsible>

            <div className={cn("border-t", HAIRLINE)} />

            <p className={cn("px-3 pb-1 pt-2", MICRO, "text-black")}>Tools</p>

            {visibleGroups.length === 0 ? (
              <p className={cn("px-3 pb-3 text-[11px] leading-relaxed", INK_SOFT)}>
                {needle ? "No tools match that search." : "No tools available."}
              </p>
            ) : (
              visibleGroups.map((group) => (
                <Collapsible
                  key={group.id}
                  title={group.title}
                  count={group.tools.length}
                  open={!closedGroups.has(group.id)}
                  onToggle={() => toggleGroup(group.id)}
                >
                  {group.tools.map((tool) => (
                    <ToolRow key={tool.id} tool={tool} />
                  ))}
                </Collapsible>
              ))
            )}
          </>
        )}
      </div>

      <p className={cn("border-t px-3 py-2 text-[10px] leading-relaxed", HAIRLINE, INK_FAINT)}>
        Drag anything onto the canvas.
      </p>
    </aside>
  );
}
