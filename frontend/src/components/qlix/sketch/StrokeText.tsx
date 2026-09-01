import type { CSSProperties } from "react";

interface StrokeTextProps {
  readonly text: string;
  readonly strokeColor?: string;
  readonly fillColor?: string;
  readonly strokeWidth?: number;
  readonly drawDuration?: number;
  readonly fillDelay?: number;
  readonly stagger?: number;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly letterSpacing?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** Solid page title. The legacy stroke props remain for call-site compatibility. */
export function StrokeText({
  text,
  fillColor = "#011207",
  fontSize = 48,
  fontWeight = 700,
  letterSpacing = -1.5,
  className = "",
  style,
}: StrokeTextProps) {
  const textStyle = {
    fontSize: `clamp(2rem, 4vw, ${fontSize}px)`,
    fontWeight,
    letterSpacing: `${letterSpacing}px`,
    color: fillColor,
  } as CSSProperties;

  return (
    <span
      className={`inline-block max-w-full leading-[0.95] ${className}`.trim()}
      style={{ ...textStyle, ...style }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}
