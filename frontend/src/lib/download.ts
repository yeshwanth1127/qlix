/** Triggers a browser download of a base64-encoded file (e.g. hybrid starter ZIP). */
export function downloadBase64File(base64: string, filename: string, mimeType: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface StarterPack {
  readonly filename: string;
  readonly base64: string;
}

const STARTER_PACK_PREFIX = "qlix:starterPack:";

/**
 * Stash a just-created hybrid starter pack so the agent page can offer a re-download
 * without re-issuing (which would rotate the signing key). Uses sessionStorage — the
 * ZIP holds the agent's private key, so it stays per-tab and clears when the tab closes.
 */
export function stashStarterPack(agentId: string, pack: StarterPack | null | undefined): void {
  if (!agentId || !pack?.base64 || !pack?.filename) return;
  try {
    sessionStorage.setItem(STARTER_PACK_PREFIX + agentId, JSON.stringify(pack));
  } catch {
    /* storage unavailable/full — non-fatal, the download button just won't appear */
  }
}

/** Retrieve a stashed starter pack for an agent, or null if none is held this session. */
export function getStashedStarterPack(agentId: string): StarterPack | null {
  if (!agentId) return null;
  try {
    const raw = sessionStorage.getItem(STARTER_PACK_PREFIX + agentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StarterPack;
    return parsed?.base64 && parsed?.filename ? parsed : null;
  } catch {
    return null;
  }
}

/** Triggers a browser download of a JSON object as the given filename. */
export function downloadJsonFile(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
