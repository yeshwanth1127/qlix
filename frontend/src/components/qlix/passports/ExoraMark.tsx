/**
 * Exora brand mark — a geometric "digital seal": a hexagonal frame around an
 * orbital X. Monochrome; strokes use `currentColor` so callers tint it via
 * `text-*` (e.g. `text-[--accent]`). No raster asset needed.
 */
export function ExoraMark({
  size = 40,
  className,
  strokeWidth = 1.5,
}: {
  readonly size?: number;
  readonly className?: string;
  readonly strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
      role="presentation"
    >
      {/* Outer hexagonal frame */}
      <path
        d="M24 3 41.2 13v20L24 43 6.8 33V13Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        opacity={0.45}
      />
      {/* Inner hexagonal frame */}
      <path
        d="M24 9 36 16v14L24 37 12 30V16Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        opacity={0.8}
      />
      {/* Orbital X */}
      <path
        d="M18 18 30 30M30 18 18 30"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Center node */}
      <circle cx="24" cy="24" r="2.4" fill="currentColor" />
    </svg>
  );
}
