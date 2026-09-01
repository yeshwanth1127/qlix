"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { ThemeToggle } from "./theme-toggle";
import { ReflectiveCard } from "./ReflectiveCard";
import { QlixWordmark } from "./landing/QlixWordmark";

const ColorBends = dynamic(() => import("./ColorBends"), { ssr: false });

/**
 * Landing page (`/`): full-screen color-bends background with the two entry
 * options — sign in or create an account.
 */
export function WorkspaceLandingPage() {
  const [introDone, setIntroDone] = useState(false);

  return (
    <div className="relative">
      {/* Intro animation overlay */}
      <div
        className={cn(
          "fixed inset-0 z-50 flex items-center justify-center bg-[#03010A] transition-opacity duration-700",
          introDone ? "pointer-events-none opacity-0" : "opacity-100"
        )}
      >
        <QlixWordmark
          surface="dark"
          animate
          onAnimationComplete={() => setIntroDone(true)}
          className="text-[96px]"
        />
      </div>

      {/* Landing page — fades in after intro */}
      <div
        className={cn(
          "relative h-screen w-full overflow-hidden bg-[#03010A] transition-opacity duration-700",
          introDone ? "opacity-100" : "opacity-0"
        )}
      >
        {/* ColorBends background */}
        <div className="absolute inset-0">
          <ColorBends
            colors={["#4d8eff", "#a78bfa", "#06B6D4"]}
            rotation={90}
            speed={0.2}
            scale={1}
            frequency={1}
            warpStrength={1}
            mouseInfluence={1}
            noise={0.15}
            parallax={0.5}
            iterations={1}
            intensity={1.5}
            bandWidth={6}
            transparent
          />
        </div>

        {/* Foreground content — pointer-events-none so PixelBlast ripples
            stay interactive; re-enabled on the controls below. */}
        <div className="pointer-events-none relative z-10 flex h-full w-full flex-col">
          <header className="flex h-14 items-center justify-between px-6 sm:px-10">
            <QlixWordmark surface="dark" className="text-[24px]" />
            <div className="pointer-events-auto">
              <ThemeToggle />
            </div>
          </header>

          <main className="flex flex-1 items-center justify-center px-6">
            <div className="w-full max-w-md text-center">
              <h1 className="mb-3 text-[40px] font-medium leading-[1.1] tracking-[-0.03em] text-white sm:text-[52px]">
                Build and manage
                <br />
                autonomous AI agents.
              </h1>
              <p className="mx-auto mb-10 max-w-sm text-[15px] leading-relaxed text-white/60">
                Sign in to your workspace, or create a new account to get started.
              </p>

              <ReflectiveCard className="pointer-events-auto rounded-2xl" contentClassName="p-6">
                <div className="flex flex-col gap-3">
                  <Link
                    href="/sign-in"
                    className="flex h-12 w-full items-center justify-center rounded-lg bg-[#4d8eff] text-[15px] font-semibold text-[#00285d] transition-all hover:brightness-110 active:scale-[0.98]"
                  >
                    Log in
                  </Link>
                  <Link
                    href="/sign-in?mode=sign-up"
                    className="flex h-12 w-full items-center justify-center rounded-lg border border-white/15 bg-[#E2F0CC]/5 text-[15px] font-semibold text-white transition-colors hover:bg-[#E2F0CC]/10 active:scale-[0.98]"
                  >
                    Sign up
                  </Link>
                </div>
              </ReflectiveCard>
            </div>
          </main>

          <footer className="flex h-12 items-center justify-center px-8">
            <div className="pointer-events-auto flex flex-wrap justify-center gap-x-6 gap-y-1">
              <Link
                href="/terms"
                className="text-[11px] font-medium uppercase tracking-[0.05em] text-white/40 transition-colors hover:text-white/80"
              >
                Terms
              </Link>
              <Link
                href="/privacy"
                className="text-[11px] font-medium uppercase tracking-[0.05em] text-white/40 transition-colors hover:text-white/80"
              >
                Privacy
              </Link>
              <a
                href="#"
                className="text-[11px] font-medium uppercase tracking-[0.05em] text-white/40 transition-colors hover:text-white/80"
              >
                Compliance
              </a>
              <a
                href="#"
                className="text-[11px] font-medium uppercase tracking-[0.05em] text-white/40 transition-colors hover:text-white/80"
              >
                Security
              </a>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
