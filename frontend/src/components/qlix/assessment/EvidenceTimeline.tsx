"use client";

import { useEffect, useState } from "react";
import { Download, Eye, Loader2, X } from "lucide-react";
import { getArtifact, type EvidenceRecordDTO } from "@/lib/assessment-api";
import { humanizeEvidence } from "./evidenceFormat";
import { cn } from "@/lib/utils/cn";
import { sketchLabel } from "@/components/qlix/sketch";

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function EvidenceTimeline({ evidence }: { readonly evidence: EvidenceRecordDTO[] }) {
  const [selected, setSelected] = useState<EvidenceRecordDTO | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  async function openArtifact(record: EvidenceRecordDTO) {
    setLoadingId(record.id);
    setArtifactError(null);
    const artifact = await getArtifact(record.sessionId, record.id);
    setLoadingId(null);
    if (!artifact) {
      setArtifactError("Could not load this artifact.");
      return;
    }
    setSelected(artifact);
  }

  async function downloadFromTimeline(record: EvidenceRecordDTO) {
    setLoadingId(record.id);
    setArtifactError(null);
    const artifact = await getArtifact(record.sessionId, record.id);
    setLoadingId(null);
    if (!artifact) {
      setArtifactError("Could not download this artifact.");
      return;
    }
    downloadArtifact(artifact);
  }

  function downloadArtifact(record: EvidenceRecordDTO) {
    const content = typeof record.payload.content === "string"
      ? record.payload.content
      : JSON.stringify(record.payload, null, 2);
    const contentType = typeof record.payload.contentType === "string"
      ? record.payload.contentType
      : "application/json";
    const fileName = typeof record.payload.fileName === "string"
      ? record.payload.fileName
      : "artifact.json";
    const url = URL.createObjectURL(new Blob([content], { type: contentType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (evidence.length === 0) {
    return (
      <div className="py-14 text-center">
        <p className={cn(sketchLabel, "text-black/30")}>Quiet</p>
        <p className="mt-2 text-[13px] text-black/45">No activity captured yet</p>
      </div>
    );
  }

  const sorted = [...evidence].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const artifactCount = evidence.filter((record) => record.kind === "artifact_upload").length;

  return (
    <>
    {artifactCount > 0 && (
      <div className="mb-4 flex items-center justify-between rounded-2xl border border-[color:var(--sketch-green)]/25 bg-[color:var(--sketch-green-soft)] px-4 py-3">
        <div>
          <p className="text-[13px] font-medium text-black">
            {artifactCount} downloadable artifact{artifactCount === 1 ? "" : "s"}
          </p>
          <p className="text-[11px] text-black/45">Use the actions beside each artifact below.</p>
        </div>
        <Download className="size-4 text-black/45" aria-hidden />
      </div>
    )}
    <ol className="relative flex flex-col pl-1">
      <span
        aria-hidden
        className="absolute bottom-3 left-[11px] top-3 w-px bg-black/[0.08]"
      />
      {sorted.map((record) => {
        const { icon: Icon, title, detail } = humanizeEvidence(record);
        return (
          <li key={record.id} className="relative flex items-start gap-4 py-3.5">
            <span className="relative z-[1] mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full border border-black/10 bg-[#E2F0CC]">
              <Icon className="size-3 text-black/40" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[13.5px] text-black">{title}</span>
              {detail && <span className="text-[12px] leading-relaxed text-black/45">{detail}</span>}
              {record.kind === "artifact_upload" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void openArtifact(record)}
                    disabled={loadingId === record.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-[#E2F0CC] px-3 py-1.5 text-[11px] font-medium text-black/65 transition hover:border-black/20 hover:text-black disabled:opacity-50"
                  >
                    {loadingId === record.id ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Eye className="size-3" aria-hidden />}
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadFromTimeline(record)}
                    disabled={loadingId === record.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-black px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-black/80 disabled:opacity-50"
                  >
                    <Download className="size-3" aria-hidden />
                    Download
                  </button>
                </div>
              )}
            </div>
            <span className={cn(sketchLabel, "shrink-0 pt-0.5 text-[10px] text-black/35")}>
              {formatTime(record.occurredAt)}
            </span>
          </li>
        );
      })}
    </ol>
    {artifactError && <p className="mt-3 text-[12px] text-red-700">{artifactError}</p>}
    {selected && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifact-viewer-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
        onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}
      >
        <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-black/10 bg-[#E2F0CC] shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-black/10 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <p className={cn(sketchLabel, "text-black/35")}>Artifact</p>
              <h2 id="artifact-viewer-title" className="mt-1 truncate text-[17px] font-medium text-black">
                {String(selected.payload.fileName ?? "Artifact")}
              </h2>
              <p className="mt-1 text-[11px] text-black/40">
                {String(selected.payload.contentType ?? "application/json")}
                {typeof selected.payload.sizeBytes === "number" ? ` · ${selected.payload.sizeBytes.toLocaleString()} bytes` : ""}
                {selected.payload.simulated === true ? " · Simulated reconstruction" : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => downloadArtifact(selected)} className="inline-flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-[11px] font-medium text-black/65 hover:text-black">
                <Download className="size-3" aria-hidden /> Download
              </button>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close artifact viewer" className="grid size-8 place-items-center rounded-full hover:bg-black/[0.05]">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>
          <div className="overflow-auto bg-[#f7f7f5] p-4 sm:p-6">
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-black/75">
              {typeof selected.payload.content === "string"
                ? selected.payload.content
                : JSON.stringify(selected.payload, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
