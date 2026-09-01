"use client";

import { useEffect, useMemo, useState } from "react";
import { developerApiBaseUrl } from "@/lib/api-keys-api";
import {
  apiRootFromSpec,
  curlSnippet,
  fetchDeveloperOpenApi,
  fetchSnippet,
  groupOperationsByTag,
  listExplorerOperations,
  pythonSnippet,
  type ExplorerOperation,
  type OpenApiDocument,
  type SnippetValues,
} from "@/lib/developer-api";
import { SketchBox, sketchInput } from "@/components/qlix/sketch";
import { PortalCodeBlock } from "./PortalCodeBlock";
import { ApiTryItPanel } from "./ApiTryItPanel";
import { portalLabel, portalMethodBadge, type PortalVariant } from "./portalTheme";

function MethodBadge({ method }: { readonly method: string }) {
  const tone = portalMethodBadge[method] ?? "bg-black/5 text-black/70 border-black/10";
  return (
    <span className={`inline-flex min-w-[3.25rem] justify-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${tone}`}>
      {method}
    </span>
  );
}

export function ApiReferenceExplorer({
  variant = "console",
  enableTryIt = false,
}: {
  readonly variant?: PortalVariant;
  readonly enableTryIt?: boolean;
}) {
  const fallbackBase = developerApiBaseUrl();
  const [spec, setSpec] = useState<OpenApiDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [queryValues, setQueryValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [snippetKind, setSnippetKind] = useState<"curl" | "python" | "fetch">("curl");

  useEffect(() => {
    let cancelled = false;
    void fetchDeveloperOpenApi()
      .then((doc) => {
        if (cancelled) return;
        setSpec(doc);
        const ops = listExplorerOperations(doc);
        setSelectedId(ops[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load OpenAPI");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const operations = useMemo(() => (spec ? listExplorerOperations(spec) : []), [spec]);
  const groups = useMemo(() => {
    const order = (spec?.tags ?? []).map((t) => t.name);
    return groupOperationsByTag(operations, order);
  }, [operations, spec]);

  const selected = operations.find((op) => op.id === selectedId) ?? operations[0];

  useEffect(() => {
    if (!selectedId) return;
    const current = operations.find((op) => op.id === selectedId);
    if (!current) return;
    const nextPath: Record<string, string> = {};
    const nextQuery: Record<string, string> = {};
    for (const param of current.parameters) {
      if (param.in === "path") nextPath[param.name] = "";
      if (param.in === "query") nextQuery[param.name] = "";
    }
    setPathValues(nextPath);
    setQueryValues(nextQuery);
    setBody(current.exampleBody);
  }, [selectedId, operations]);

  const apiRoot = spec ? apiRootFromSpec(spec, fallbackBase) : `${fallbackBase}/api/v1`;
  const snippetValues: SnippetValues | null = selected
    ? { apiRoot, pathValues, queryValues, body }
    : null;

  const label = portalLabel[variant];
  const shellClass =
    variant === "docs"
      ? "grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]"
      : "grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]";

  if (error) {
    return <p className="text-[13px] text-[color:var(--sketch-red,#b42318)]">{error}</p>;
  }
  if (!spec || !selected || !snippetValues) {
    return <p className={label}>Loading API reference…</p>;
  }

  const snippet =
    snippetKind === "python"
      ? pythonSnippet(selected, snippetValues)
      : snippetKind === "fetch"
        ? fetchSnippet(selected, snippetValues)
        : curlSnippet(selected, snippetValues);

  const nav = (
    <nav className="flex max-h-[70vh] flex-col gap-3 overflow-auto pr-1">
      {groups.map((group) => (
        <div key={group.tag}>
          <p className={label}>{group.tag}</p>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {group.operations.map((op) => {
              const active = op.id === selected.id;
              return (
                <li key={op.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(op.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] ${
                      active ? "bg-black/[0.06] text-black" : "text-black/70 hover:bg-black/[0.04]"
                    }`}
                  >
                    <MethodBadge method={op.method} />
                    <span className="min-w-0 truncate">{op.summary}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const detail = (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={selected.method} />
          <code className="font-mono text-[12px] text-black/80">{selected.path}</code>
        </div>
        <h3 className="mt-2 font-serif text-[16px] text-black">{selected.summary}</h3>
        {selected.scopes.length > 0 ? (
          <p className="mt-1 flex flex-wrap gap-1">
            {selected.scopes.map((scope) => (
              <span
                key={scope}
                className="rounded-full border border-black/10 bg-[#E2F0CC]/70 px-2 py-0.5 font-mono text-[10px] text-black/65"
              >
                {scope}
              </span>
            ))}
          </p>
        ) : null}
        {selected.description ? (
          <p className="mt-2 text-[13px] leading-relaxed text-black/60">{selected.description}</p>
        ) : null}
      </div>

      {selected.parameters.filter((p) => p.in === "path").length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className={label}>Path parameters</span>
          {selected.parameters
            .filter((p) => p.in === "path")
            .map((param) => (
              <label key={param.name} className="flex flex-col gap-1">
                <span className="font-mono text-[11px] text-black/55">
                  {param.name}
                  {param.required ? " *" : ""}
                </span>
                <input
                  value={pathValues[param.name] ?? ""}
                  onChange={(event) =>
                    setPathValues((prev) => ({ ...prev, [param.name]: event.target.value }))
                  }
                  className={sketchInput}
                  placeholder={param.name}
                />
              </label>
            ))}
        </div>
      ) : null}

      {selected.parameters.filter((p) => p.in === "query").length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className={label}>Query parameters</span>
          {selected.parameters
            .filter((p) => p.in === "query")
            .map((param) => (
              <label key={param.name} className="flex flex-col gap-1">
                <span className="font-mono text-[11px] text-black/55">{param.name}</span>
                <input
                  value={queryValues[param.name] ?? ""}
                  onChange={(event) =>
                    setQueryValues((prev) => ({ ...prev, [param.name]: event.target.value }))
                  }
                  className={sketchInput}
                  placeholder={param.name}
                />
              </label>
            ))}
        </div>
      ) : null}

      {selected.requestBody ? (
        <label className="flex flex-col gap-1.5">
          <span className={label}>Request body</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={10}
            className={`${sketchInput} min-h-[10rem] font-mono text-[12px]`}
            spellCheck={false}
          />
        </label>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(["curl", "python", "fetch"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setSnippetKind(kind)}
              className={
                snippetKind === kind
                  ? "rounded-full border border-black bg-black px-3 py-1 text-[11px] uppercase tracking-widest text-white"
                  : "rounded-full border border-black/15 bg-[#E2F0CC]/70 px-3 py-1 text-[11px] uppercase tracking-widest text-black/60"
              }
            >
              {kind}
            </button>
          ))}
        </div>
        <PortalCodeBlock variant={variant} code={snippet} />
      </div>

      {enableTryIt ? (
        <div className="flex flex-col gap-2 border-t border-black/10 pt-4">
          <span className={label}>Try it</span>
          <ApiTryItPanel operation={selected} values={snippetValues} />
        </div>
      ) : null}

      <a
        href={`${fallbackBase}/api/v1/openapi.json`}
        target="_blank"
        rel="noreferrer"
        className="self-start text-[12px] text-black underline underline-offset-2 hover:text-black/70"
      >
        Download OpenAPI JSON →
      </a>
    </div>
  );

  if (variant === "docs") {
    return (
      <div className={shellClass}>
        {nav}
        {detail}
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <SketchBox className="p-3">{nav}</SketchBox>
      <SketchBox className="p-4">{detail}</SketchBox>
    </div>
  );
}

export type { ExplorerOperation };
