import type { LucideIcon } from "lucide-react";
import {
  FileEdit,
  FileMinus,
  FilePlus,
  FileWarning,
  GitCommitHorizontal,
  HelpCircle,
  MessageSquareText,
  Package,
  Paperclip,
  TerminalSquare,
  TestTube2,
  Wrench,
} from "lucide-react";
import type { EvidenceRecordDTO } from "@/lib/assessment-api";

export interface HumanizedEvidence {
  icon: LucideIcon;
  title: string;
  detail: string | null;
}

function fileEventIcon(changeType: unknown): LucideIcon {
  switch (changeType) {
    case "created":
      return FilePlus;
    case "deleted":
      return FileMinus;
    case "renamed":
      return FileEdit;
    default:
      return FileEdit;
  }
}

export function humanizeEvidence(record: EvidenceRecordDTO): HumanizedEvidence {
  const p = record.payload;
  switch (record.kind) {
    case "file_snapshot": {
      if (p.sensitive) {
        return { icon: FileWarning, title: `Changed a sensitive file (${String(p.path ?? "?")})`, detail: "Content not captured" };
      }
      const path = String(p.path ?? "unknown file");
      const changeType = String(p.changeType ?? "changed");
      if (changeType === "renamed") {
        return { icon: FileEdit, title: `Renamed ${String(p.from ?? "?")} → ${path}`, detail: null };
      }
      const verb = changeType === "created" ? "Created" : changeType === "deleted" ? "Deleted" : changeType === "saved" ? "Saved" : "Changed";
      const detailBits: string[] = [];
      if (typeof p.lineCount === "number") detailBits.push(`${p.lineCount} lines`);
      if (typeof p.sizeBytes === "number") detailBits.push(`${p.sizeBytes} bytes`);
      return { icon: fileEventIcon(changeType), title: `${verb} ${path}`, detail: detailBits.join(" · ") || null };
    }
    case "git_event": {
      const subject = String(p.subject ?? "commit");
      const hash = typeof p.hash === "string" ? p.hash.slice(0, 7) : null;
      const author = typeof p.authorName === "string" ? p.authorName : null;
      return {
        icon: GitCommitHorizontal,
        title: `Committed: ${subject}`,
        detail: [hash, author].filter(Boolean).join(" · ") || null,
      };
    }
    case "terminal_event": {
      const command = typeof p.command === "string" ? p.command : "command";
      const success = p.success === false ? "failed" : "succeeded";
      const exitCode = typeof p.exitCode === "number" ? ` (exit ${p.exitCode})` : "";
      return { icon: TerminalSquare, title: `Ran: ${command}`, detail: `${success}${exitCode}` };
    }
    case "dependency_event": {
      const manager = typeof p.manager === "string" ? p.manager : "package manager";
      const command = typeof p.command === "string" ? p.command : "install";
      const success = p.exitCode === 0 || p.exitCode === undefined ? "succeeded" : `failed (exit ${p.exitCode})`;
      return { icon: Package, title: `${manager}: ${command}`, detail: success };
    }
    case "test_result":
    case "build_result":
    case "lint_result": {
      const label = record.kind === "test_result" ? "Tests" : record.kind === "build_result" ? "Build" : "Lint";
      const success = p.success === false ? "failed" : "passed";
      const command = typeof p.command === "string" ? p.command : null;
      const duration = typeof p.durationMs === "number" ? `${p.durationMs}ms` : null;
      return {
        icon: TestTube2,
        title: `${label} ${success}${command ? ` — ${command}` : ""}`,
        detail: duration,
      };
    }
    case "ai_prompt":
      return { icon: MessageSquareText, title: "AI assistance used", detail: typeof p.summary === "string" ? p.summary : null };
    case "artifact_upload":
      return { icon: Paperclip, title: "Artifact uploaded", detail: typeof p.fileName === "string" ? p.fileName : null };
    case "manual_note":
      return { icon: Wrench, title: typeof p.text === "string" ? p.text : "Manual note", detail: null };
    default:
      return { icon: HelpCircle, title: record.kind, detail: null };
  }
}
