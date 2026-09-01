import type { SketchTone } from "@/components/qlix/sketch";

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function statusTone(status: string): SketchTone {
  switch (status) {
    case "active":
    case "evaluating":
    case "reviewing":
      return "green";
    case "submitted":
    case "reported":
      return "blue";
    case "closed":
      return "default";
    default:
      return "amber";
  }
}

export function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
