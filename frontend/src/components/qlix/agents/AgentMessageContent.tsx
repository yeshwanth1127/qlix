"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  type ActivityStep,
  activityEndedInFailure,
  isWaitingForJitApproval,
} from "@/components/qlix/agents/agentToolActivity";
import { cn } from "@/lib/utils/cn";
import { safeModelOutputUrl } from "@/lib/safe-model-output";

const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}'"])/g;
const BOLD_RE = /\*\*(.+?)\*\*/g;
const BOLD_TRIPLE_RE = /\*\*\*(.+?)\*\*\*/g;
const ITALIC_RE = /(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g;

type MessageBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "hr" }
  | { type: "callout"; tone: "success" | "error" | "warn" | "info"; text: string };

const CALLOUT_PREFIX: Array<{
  re: RegExp;
  tone: "success" | "error" | "warn" | "info";
  Icon: LucideIcon;
}> = [
  { re: /^✅\s*/u, tone: "success", Icon: CheckCircle2 },
  { re: /^❌\s*/u, tone: "error", Icon: XCircle },
  { re: /^⚠️?\s*/u, tone: "warn", Icon: AlertTriangle },
];

function stripEmojis(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isBulletLine(line: string): boolean {
  return /^[\s]*[-*]\s+/.test(line);
}

function bulletText(line: string): string {
  return line.replace(/^[\s]*[-*]\s+/, "").trim();
}

function isRuleBlock(block: string): boolean {
  return /^(-{3,}|\*{3,}|_{3,})$/.test(block.trim());
}

export function parseAgentMessageBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const rawBlocks = content.replace(/\r\n/g, "\n").split(/\n\s*\n/);

  for (const raw of rawBlocks) {
    const block = raw.trim();
    if (!block) continue;

    if (isRuleBlock(block)) {
      blocks.push({ type: "hr" });
      continue;
    }

    const lines = block.split("\n");
    const first = lines[0]?.trim() ?? "";

    if (first.startsWith("### ")) {
      blocks.push({ type: "heading", level: 3, text: first.slice(4).trim() });
      const rest = lines.slice(1).join("\n").trim();
      if (rest) blocks.push(...parseAgentMessageBlocks(rest));
      continue;
    }
    if (first.startsWith("## ")) {
      blocks.push({ type: "heading", level: 2, text: first.slice(3).trim() });
      const rest = lines.slice(1).join("\n").trim();
      if (rest) blocks.push(...parseAgentMessageBlocks(rest));
      continue;
    }
    if (first.startsWith("# ")) {
      blocks.push({ type: "heading", level: 1, text: first.slice(2).trim() });
      const rest = lines.slice(1).join("\n").trim();
      if (rest) blocks.push(...parseAgentMessageBlocks(rest));
      continue;
    }

    let calloutHandled = false;
    for (const prefix of CALLOUT_PREFIX) {
      if (!prefix.re.test(first)) continue;
      const text = stripEmojis(first.replace(prefix.re, "").trim());
      if (text) blocks.push({ type: "callout", tone: prefix.tone, text });
      const rest = lines.slice(1).join("\n").trim();
      if (rest) blocks.push(...parseAgentMessageBlocks(rest));
      calloutHandled = true;
      break;
    }
    if (calloutHandled) continue;

    if (lines.every(isBulletLine)) {
      blocks.push({ type: "list", items: lines.map(bulletText).filter(Boolean) });
      continue;
    }

    let bulletBuf: string[] = [];
    let paraBuf: string[] = [];

    const flushBullets = () => {
      if (bulletBuf.length > 0) {
        blocks.push({ type: "list", items: [...bulletBuf] });
        bulletBuf = [];
      }
    };
    const flushPara = () => {
      if (paraBuf.length > 0) {
        blocks.push({ type: "paragraph", text: paraBuf.join("\n") });
        paraBuf = [];
      }
    };

    for (const line of lines) {
      if (isBulletLine(line)) {
        flushPara();
        bulletBuf.push(bulletText(line));
      } else {
        flushBullets();
        paraBuf.push(line);
      }
    }
    flushBullets();
    flushPara();
  }

  return blocks;
}

function renderWithLinks(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;
  const link = (href: string, label: string) => {
    const safeHref = safeModelOutputUrl(href);
    if (!safeHref) return label;
    return (
      <a
        key={`${keyPrefix}-l${key++}`}
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all hover:opacity-70"
      >
        {label}
      </a>
    );
  };

  const pushPlain = (segment: string) => {
    if (!segment) return;
    nodes.push(...renderBoldItalic(segment, `${keyPrefix}-p${key++}`));
  };

  let last = 0;
  let m: RegExpExecArray | null;
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    if (m.index > last) pushPlain(text.slice(last, m.index));
    nodes.push(link(m[2], m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) pushPlain(text.slice(last));
  if (nodes.length === 0) pushPlain(text);
  return nodes;
}

function renderBoldItalic(text: string, keyPrefix: string): ReactNode[] {
  type Token = { kind: "text" | "bold" | "italic"; value: string };
  const tokens: Token[] = [{ kind: "text", value: text }];

  const applyRe = (re: RegExp, kind: "bold" | "italic") => {
    const out: Token[] = [];
    for (const tok of tokens) {
      if (tok.kind !== "text") {
        out.push(tok);
        continue;
      }
      let last = 0;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      let matched = false;
      while ((m = re.exec(tok.value)) !== null) {
        matched = true;
        if (m.index > last) out.push({ kind: "text", value: tok.value.slice(last, m.index) });
        out.push({ kind, value: m[1] });
        last = m.index + m[0].length;
      }
      if (!matched) out.push(tok);
      else if (last < tok.value.length) out.push({ kind: "text", value: tok.value.slice(last) });
    }
    tokens.splice(0, tokens.length, ...out);
  };

  applyRe(BOLD_TRIPLE_RE, "bold");
  applyRe(BOLD_RE, "bold");
  applyRe(ITALIC_RE, "italic");

  const nodes: ReactNode[] = [];
  let k = 0;
  for (const tok of tokens) {
    if (tok.kind === "text") {
      let li = 0;
      BARE_URL_RE.lastIndex = 0;
      let bm: RegExpExecArray | null;
      while ((bm = BARE_URL_RE.exec(tok.value)) !== null) {
        if (bm.index > li) nodes.push(tok.value.slice(li, bm.index));
        nodes.push(
          <a
            key={`${keyPrefix}-u${k++}`}
            href={safeModelOutputUrl(bm[1]) ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 break-all hover:opacity-70"
          >
            {bm[1]}
          </a>,
        );
        li = bm.index + bm[1].length;
      }
      if (li < tok.value.length) nodes.push(tok.value.slice(li));
      continue;
    }
    if (tok.kind === "bold") {
      nodes.push(
        <strong key={`${keyPrefix}-b${k++}`} className="font-semibold text-black">
          {renderWithLinks(tok.value, `${keyPrefix}-b${k}`)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={`${keyPrefix}-i${k++}`} className="text-black/80">
          {renderWithLinks(tok.value, `${keyPrefix}-i${k}`)}
        </em>,
      );
    }
  }
  return nodes;
}

function calloutStyles(tone: "success" | "error" | "warn" | "info") {
  switch (tone) {
    case "success":
      return {
        Icon: CheckCircle2,
        box: "border-emerald-700/25",
        icon: "text-emerald-700/80",
      };
    case "error":
      return {
        Icon: XCircle,
        box: "border-red-700/25",
        icon: "text-red-700/80",
      };
    case "warn":
      return {
        Icon: AlertTriangle,
        box: "border-amber-700/25",
        icon: "text-amber-800/80",
      };
    default:
      return {
        Icon: Info,
        box: "border-black/15",
        icon: "text-black/60",
      };
  }
}

function BlockView({ block }: { readonly block: MessageBlock }) {
  switch (block.type) {
    case "heading":
      if (block.level === 1) {
        return (
          <h3 className="text-[14px] font-semibold tracking-tight text-black">{renderWithLinks(block.text, "h1")}</h3>
        );
      }
      if (block.level === 2) {
        return (
          <h4 className="text-[13px] font-semibold text-black">{renderWithLinks(block.text, "h2")}</h4>
        );
      }
      return (
        <h5 className="text-[12px] font-semibold uppercase tracking-wide text-black/70">
          {renderWithLinks(block.text, "h3")}
        </h5>
      );
    case "paragraph":
      return <p className="leading-relaxed text-black/85">{renderWithLinks(block.text, "p")}</p>;
    case "list":
      return (
        <ul className="ml-1 space-y-1">
          {block.items.map((item, i) => (
            <li key={`li-${i}`} className="flex gap-2 leading-relaxed text-black/85">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-black/35" aria-hidden />
              <span className="min-w-0">{renderWithLinks(item, `li-${i}`)}</span>
            </li>
          ))}
        </ul>
      );
    case "hr":
      return <hr className="border-0 border-t border-black/10" />;
    case "callout": {
      const { Icon, box, icon } = calloutStyles(block.tone);
      return (
        <div className={cn("flex items-start gap-2 border-l-2 pl-3 text-[12px]", box)}>
          <Icon className={cn("mt-0.5 size-3.5 shrink-0", icon)} aria-hidden />
          <span className="min-w-0 leading-relaxed text-black/85">{renderWithLinks(block.text, "co")}</span>
        </div>
      );
    }
  }
}

const STRONG_FAILURE_RE = /\[failed\]|^error:/i;
const SUCCESS_HINT_RE = /✅|successfully|completed|done|created|saved|summary/i;
const FAILURE_HINT_RE = /failed to |could not |\berror\b|\bfailed\b|\bdenied\b|\brejected\b|\bunable to\b/i;

export function agentMessageLooksSuccessful(content: string, activity?: ActivityStep[]): boolean {
  if (activity && isWaitingForJitApproval(activity)) return false;
  if (activityEndedInFailure(activity)) return false;
  const lower = content.toLowerCase();
  if (STRONG_FAILURE_RE.test(content.trim())) return false;
  if (SUCCESS_HINT_RE.test(content)) return true;
  if (activity?.some((s) => s.tone === "success")) return true;
  if (activity && activity.length > 0 && !activityEndedInFailure(activity)) return true;
  return !/\berror\b|\bfailed\b|\bdenied\b/.test(lower);
}

export function agentMessageLooksFailed(content: string, activity?: ActivityStep[]): boolean {
  if (activity && isWaitingForJitApproval(activity)) return false;
  if (activityEndedInFailure(activity)) return true;
  // A later success means the run recovered — don't paint the whole answer red
  // just because an earlier step failed or the write-up mentions that retry.
  if (activity && activity.some((s) => s.tone === "success") && !activityEndedInFailure(activity)) {
    return false;
  }
  if (STRONG_FAILURE_RE.test(content.trim())) return true;
  const failed = FAILURE_HINT_RE.test(content);
  const succeeded = SUCCESS_HINT_RE.test(content);
  if (failed && succeeded) return false;
  return failed;
}

function OutcomeFrame({
  tone,
  children,
}: {
  readonly tone: "success" | "failure";
  readonly children: ReactNode;
}) {
  const success = tone === "success";
  const Icon = success ? CheckCircle2 : XCircle;

  return (
    <div
      className={cn(
        "border-l-2 pl-4",
        success ? "border-emerald-700/25" : "border-red-700/35",
      )}
    >
      <div>
        <div
          className="mb-2 flex items-center gap-1.5"
          role="status"
          aria-label={success ? "Completed result" : "Failed result"}
        >
          <Icon
            className={cn(
              "size-3 shrink-0",
              success ? "text-[color:var(--sketch-green)]" : "text-[color:var(--sketch-red)]",
            )}
            aria-hidden
          />
          <span
            className={cn(
              "text-[11px] font-medium",
              success ? "text-[color:var(--sketch-green)]" : "text-[color:var(--sketch-red)]",
            )}
          >
            {success ? "Done" : "Run failed"}
          </span>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

export function AgentMessageContent({
  content,
  completed = false,
  activity,
}: {
  readonly content: string;
  readonly completed?: boolean;
  readonly activity?: ActivityStep[];
}) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const blocks = parseAgentMessageBlocks(trimmed);
  const outcome: "success" | "failure" | null = !completed
    ? null
    : agentMessageLooksFailed(trimmed, activity)
      ? "failure"
      : agentMessageLooksSuccessful(trimmed, activity)
        ? "success"
        : null;

  const body = (
    <div className="space-y-2.5">
      {blocks.map((block, i) => (
        <BlockView key={`b-${i}`} block={block} />
      ))}
    </div>
  );

  if (!outcome) return body;

  return <OutcomeFrame tone={outcome}>{body}</OutcomeFrame>;
}
