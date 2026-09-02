"use client";

import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  patchGtmDiscoveryWorkspace,
  requestQlixCrm,
  type GtmDiscoveryWorkspace,
} from "@/lib/gtm-api";

export function GtmCrmChoice({
  workspace,
  routePrefix,
  onUpdated,
}: {
  readonly workspace: GtmDiscoveryWorkspace;
  readonly routePrefix: string;
  readonly onUpdated: (workspace: GtmDiscoveryWorkspace) => void;
}) {
  const [busy, setBusy] = useState<"external" | "qlix" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { setup, connectors } = workspace;
  const zohoConnected = connectors.zohoConnected;
  const qlixRequested = setup.crmMode === "qlix_twenty";
  const externalChosen = setup.crmMode === "external";

  async function chooseExternal() {
    setBusy("external");
    setError(null);
    const result = await patchGtmDiscoveryWorkspace({
      crmMode: "external",
      crmExternalProvider: "zoho",
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onUpdated(result.workspace);
  }

  async function chooseQlix() {
    setBusy("qlix");
    setError(null);
    const result = await requestQlixCrm();
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onUpdated(result.workspace);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div
          className={`border p-4 ${externalChosen ? "border-black bg-white" : "border-black/15 bg-white/60"}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[14px] font-medium">Bring your CRM</p>
              <p className="mt-1 text-[12px] text-black/55">Use Zoho (or connect later)</p>
            </div>
            {externalChosen && zohoConnected ? (
              <Check className="size-4 shrink-0 text-black" aria-hidden />
            ) : null}
          </div>
          {externalChosen ? (
            zohoConnected ? (
              <p className="mt-3 text-[11px] text-black/50">Zoho connected</p>
            ) : (
              <Link
                href={`${routePrefix}/connectors#zoho`}
                className="mt-3 inline-block bg-black px-3 py-2 font-serif text-[10px] uppercase tracking-widest text-white"
              >
                Connect Zoho
              </Link>
            )
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void chooseExternal()}
              className="mt-3 inline-flex items-center gap-2 border border-black px-3 py-2 font-serif text-[10px] uppercase tracking-widest disabled:opacity-40"
            >
              {busy === "external" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              Use Zoho
            </button>
          )}
        </div>

        <div
          className={`border p-4 ${qlixRequested ? "border-black bg-white" : "border-black/15 bg-white/60"}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[14px] font-medium">Qlix CRM</p>
              <p className="mt-1 text-[12px] text-black/55">We set up CRM for you</p>
            </div>
            {qlixRequested ? (
              <Check className="size-4 shrink-0 text-black" aria-hidden />
            ) : null}
          </div>
          {qlixRequested ? (
            <p className="mt-3 text-[11px] text-black/50">
              Requested{setup.qlixCrmRequestedAt ? " — we'll notify you" : ""}
            </p>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void chooseQlix()}
              className="mt-3 inline-flex items-center gap-2 border border-black px-3 py-2 font-serif text-[10px] uppercase tracking-widest disabled:opacity-40"
            >
              {busy === "qlix" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              Request Qlix CRM
            </button>
          )}
        </div>
      </div>
      {error ? <p className="text-[12px] text-[#8b1e12]" role="alert">{error}</p> : null}
    </div>
  );
}
