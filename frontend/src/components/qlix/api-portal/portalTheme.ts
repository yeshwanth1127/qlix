export type PortalVariant = "console" | "docs";

export const portalTabActive = {
  console:
    "inline-flex items-center justify-center rounded-full border border-[color:var(--sketch-purple)] bg-[color:var(--sketch-purple-soft)] px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[color:var(--sketch-purple)]",
  docs: "inline-flex items-center justify-center rounded-full border border-[#1c1830] bg-[#1c1830] px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[#f2efe8]",
} as const;

export const portalTabIdle = {
  console: undefined,
  docs: "inline-flex items-center justify-center rounded-full border border-black/15 bg-white/60 px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[#1c1830] hover:border-black/30",
} as const;

export const portalLabel = {
  console: "text-[11px] font-medium uppercase tracking-[0.16em] text-black",
  docs: "text-[11px] font-medium uppercase tracking-[0.14em] text-black/40",
} as const;

export const portalBody = {
  console: "text-[13px] leading-relaxed text-black/75",
  docs: "text-[14px] leading-relaxed text-black/65",
} as const;

export const portalMethodBadge: Record<string, string> = {
  get: "bg-emerald-50 text-emerald-800 border-emerald-200",
  post: "bg-sky-50 text-sky-800 border-sky-200",
  put: "bg-amber-50 text-amber-800 border-amber-200",
  patch: "bg-violet-50 text-violet-800 border-violet-200",
  delete: "bg-rose-50 text-rose-800 border-rose-200",
};
