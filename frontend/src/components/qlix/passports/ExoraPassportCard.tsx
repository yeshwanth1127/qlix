"use client";

/**
 * ExoraPassportCard — the light passport "cover": ivory paper, engraved rays,
 * an embossed seal medallion around the Exora sunburst, letterpress serif type,
 * and a restrained pointer tilt with a specular sheen.
 */
import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import "./ExoraPassportCard.css";

const MAX_TILT_DEG = 6;

export interface ExoraPassportCardProps {
  readonly name: string;
  readonly subtitle?: string;
  readonly didShort?: string;
  readonly className?: string;
}

export function ExoraPassportCard({
  name,
  subtitle = "Layer 3 Identity",
  didShort,
  className,
}: ExoraPassportCardProps) {
  const scopeRef = useRef<HTMLDivElement>(null);

  const setPointer = useCallback((clientX: number, clientY: number) => {
    const scope = scopeRef.current;
    if (!scope) return;
    const rect = scope.getBoundingClientRect();
    const px = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const py = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
    scope.style.setProperty("--xp-px", `${(px * 100).toFixed(2)}%`);
    scope.style.setProperty("--xp-py", `${(py * 100).toFixed(2)}%`);
    scope.style.setProperty("--xp-rx", `${((px - 0.5) * 2 * MAX_TILT_DEG).toFixed(2)}deg`);
    scope.style.setProperty("--xp-ry", `${((0.5 - py) * 2 * MAX_TILT_DEG).toFixed(2)}deg`);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      setPointer(e.clientX, e.clientY);
    },
    [setPointer],
  );

  const onPointerEnter = useCallback(
    (e: React.PointerEvent) => {
      const scope = scopeRef.current;
      if (!scope) return;
      scope.classList.add("xp-tilting");
      scope.style.setProperty("--xp-hover", "1");
      setPointer(e.clientX, e.clientY);
    },
    [setPointer],
  );

  const onPointerLeave = useCallback(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    scope.classList.remove("xp-tilting");
    scope.style.setProperty("--xp-hover", "0");
    scope.style.setProperty("--xp-px", "50%");
    scope.style.setProperty("--xp-py", "42%");
    scope.style.setProperty("--xp-rx", "0deg");
    scope.style.setProperty("--xp-ry", "0deg");
  }, []);

  return (
    <div
      ref={scopeRef}
      className={cn("xp-scope", className)}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className="xp-card">
        <div className="xp-frame" aria-hidden />

        <div className="relative flex h-full flex-col items-center px-7 py-8 text-center">
          {/* Masthead */}
          <p className="font-serif text-[17px] tracking-[0.5em] text-[#221c33] [text-indent:0.5em]">
            EXORA
          </p>
          <div className="xp-rule mt-3" aria-hidden>
            <span />
          </div>
          <p className="mt-3 text-[8.5px] font-medium uppercase tracking-[0.42em] text-[#221c33]/55 [text-indent:0.42em]">
            Digital Agent Passport
          </p>

          {/* Seal */}
          <div className="flex min-h-0 flex-1 items-center justify-center py-3">
            <div className="xp-medallion">
              {/* eslint-disable-next-line @next/next/no-img-element -- local static seal asset */}
              <img src="/exora-logo.jpeg" alt="" aria-hidden />
            </div>
          </div>

          {/* Holder */}
          <p className="max-w-full truncate font-serif text-[19px] leading-tight text-[#221c33]">
            {name}
          </p>
          <p className="mt-1.5 text-[8.5px] font-medium uppercase tracking-[0.36em] text-[#221c33]/50 [text-indent:0.36em]">
            {subtitle}
          </p>
          {didShort ? (
            <p className="mt-3 font-mono text-[10px] tracking-[0.14em] text-[#221c33]/40">
              {didShort}
            </p>
          ) : null}
        </div>

        <div className="xp-sheen" aria-hidden />
      </div>
    </div>
  );
}
