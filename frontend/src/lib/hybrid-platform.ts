/** OS for hybrid starter pack (launcher included in the ZIP). */
export type HybridClientPlatform = "windows" | "macos" | "linux";

/** Detect the machine running the browser (where the user will unzip and run the agent). */
export function detectHybridClientPlatform(): HybridClientPlatform {
  if (typeof navigator === "undefined") return "windows";
  const ua = navigator.userAgent;
  const platform = navigator.platform ?? "";
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua)) return "macos";
  return "linux";
}
