"use client";

import { useState } from "react";
import {
  connectorFaviconUrl,
  connectorLogoUrl,
  type ConnectorLogoMeta,
} from "@/lib/connector-catalog";
import { cn } from "@/lib/utils/cn";

interface ConnectorLogoProps {
  readonly name: string;
  readonly logo: ConnectorLogoMeta;
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}

const SIZE_PX = { sm: 18, md: 22, lg: 28 } as const;
const BOX = { sm: "size-8", md: "size-10", lg: "size-12" } as const;
const ICON = { sm: "size-[18px]", md: "size-[22px]", lg: "size-7" } as const;

/**
 * Brand mark for a connector: simple-icons tinted with brand color when a slug
 * exists, otherwise the site favicon, then initials.
 */
export function ConnectorLogo({ name, logo, size = "md", className }: ConnectorLogoProps) {
  const [mode, setMode] = useState<"slug" | "favicon" | "initials">(logo.slug ? "slug" : "favicon");
  const px = SIZE_PX[size];
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const tint = `#${logo.color}`;
  const softBg = `${tint}18`;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/[0.08]",
        BOX[size],
        className,
      )}
      style={{ backgroundColor: softBg }}
      title={name}
      aria-hidden
    >
      {mode === "slug" && logo.slug ? (
        <span
          className={cn("block", ICON[size])}
          style={{
            backgroundColor: tint,
            WebkitMaskImage: `url(${connectorLogoUrl(logo)})`,
            maskImage: `url(${connectorLogoUrl(logo)})`,
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- probe for 404 */}
          <img
            src={connectorLogoUrl(logo)}
            alt=""
            className="pointer-events-none absolute size-0 opacity-0"
            onError={() => setMode("favicon")}
          />
        </span>
      ) : mode === "favicon" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={connectorFaviconUrl(logo.domain, 128)}
          alt=""
          width={px}
          height={px}
          className={cn(ICON[size], "object-contain")}
          onError={() => setMode("initials")}
        />
      ) : (
        <span className="font-serif text-[10px] font-medium uppercase tracking-wide text-black/55">
          {initials}
        </span>
      )}
    </span>
  );
}
