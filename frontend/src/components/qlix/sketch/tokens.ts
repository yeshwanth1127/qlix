/** Shared Tailwind class tokens for the "ink & glass" console UI (dashboard only).
 *
 * Card borders use `--sketch-card-border` / `--qlix-card-border` for a visible ink
 * outline on light glass panels.
 */

export const SKETCH_SIDEBAR_WIDTH = "14rem";
/** Matches `h-12` mobile chrome header + safe area. */
export const SKETCH_MOBILE_TOPBAR_HEIGHT = "3rem";
/** Matches `h-14` bottom nav. */
export const SKETCH_BOTTOM_NAV_HEIGHT = "3.5rem";

export const sketchBorder =
  "border border-[color:var(--sketch-card-border,var(--qlix-card-border))]";
export const sketchFrame =
  "border border-[color:var(--sketch-card-border,var(--qlix-card-border))] bg-[#E2F0CC]";

/** Micro-label — tracked system sans (no unloaded serif). */
export const sketchLabel =
  "text-[10px] font-bold uppercase tracking-[0.2em] text-black";

export const sketchNavLink =
  "block text-[11px] font-medium uppercase tracking-[0.14em] text-black transition-colors duration-200 ease-out hover:text-[color:var(--sketch-purple)]";

const sketchBtnBase =
  "inline-flex items-center justify-center gap-2 rounded-none px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--sketch-purple)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#E2F0CC] disabled:pointer-events-none disabled:opacity-40";

/** Solid ink CTA — primary actions. */
export const sketchButtonPrimary =
  `${sketchBtnBase} border border-black bg-black text-white hover:bg-[color:var(--sketch-purple)] hover:border-black hover:shadow-[0_10px_24px_-12px_rgba(249,115,22,0.55)] hover:-translate-y-px active:translate-y-0`;

/** Glass outline — default / secondary actions (legacy `sketchButton`). */
export const sketchButtonSecondary =
  `${sketchBtnBase} border border-black bg-[#E2F0CC]/70 text-black hover:border-black hover:bg-black hover:text-white hover:shadow-[0_10px_24px_-12px_rgba(16,14,22,0.45)] hover:-translate-y-px active:translate-y-0 disabled:hover:border-black disabled:hover:bg-[#E2F0CC]/70 disabled:hover:text-black disabled:hover:shadow-none disabled:hover:translate-y-0`;

/** Quiet text control. */
export const sketchButtonGhost =
  `${sketchBtnBase} border border-black bg-transparent text-black hover:border-black hover:bg-black/[0.04] hover:text-black`;

/** Destructive outline. */
export const sketchButtonDanger =
  `${sketchBtnBase} border border-black bg-[color:var(--sketch-red-soft)] text-[color:var(--sketch-red)] hover:border-black hover:bg-[color:var(--sketch-red)] hover:text-white hover:-translate-y-px active:translate-y-0`;

/** @deprecated Prefer sketchButtonSecondary / Primary — kept for call-site compat. */
export const sketchButton = sketchButtonSecondary;

export const sketchInput =
  "w-full rounded-none border border-black/20 bg-[#E2F0CC] px-4 py-3 text-[13px] text-black outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-black/45 focus:border-[color:var(--sketch-purple)] focus:shadow-[inset_4px_0_0_var(--sketch-purple)]";

/** Soft card fills. `default` is the neutral glass tint; `white` opts back out to plain. */
export type SketchTone = "default" | "white" | "purple" | "blue" | "green" | "amber" | "rose";

/** Full literal class strings so Tailwind can statically detect each tint. */
export const sketchToneBg: Record<SketchTone, string> = {
  default: "bg-[var(--sketch-tint)]",
  white: "bg-[#E2F0CC]",
  purple: "bg-[var(--sketch-tint-purple)]",
  blue: "bg-[var(--sketch-tint-blue)]",
  green: "bg-[var(--sketch-tint-green)]",
  amber: "bg-[var(--sketch-tint-amber)]",
  rose: "bg-[var(--sketch-tint-rose)]",
};

/** Audit / status row accents. */
export const sketchResultTone = {
  success: "border-l-[3px] border-l-transparent",
  blocked: "border-l-[3px] border-l-[color:var(--warning)] bg-[color:var(--sketch-tint-amber)]",
  flagged: "border-l-[3px] border-l-[color:var(--sketch-red)] bg-[color:var(--sketch-red-soft)]",
  muted: "opacity-60",
} as const;
