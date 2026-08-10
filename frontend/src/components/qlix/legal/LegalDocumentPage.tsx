import Link from "next/link";
import type { ReactNode } from "react";
import { QlixWordmark } from "@/components/qlix/landing/QlixWordmark";

export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly content: ReactNode;
}

interface LegalDocumentPageProps {
  readonly title: string;
  readonly lastUpdated: string;
  readonly intro: string;
  readonly sections: readonly LegalSection[];
}

export function LegalDocumentPage({
  title,
  lastUpdated,
  intro,
  sections,
}: LegalDocumentPageProps) {
  return (
    <div className="relative min-h-dvh bg-[#f2efe8] text-[#1c1830]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(28,24,48,0.06),_transparent_55%)]" aria-hidden />

      <div className="relative z-10 flex min-h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/10 px-6 sm:px-10">
          <Link href="/" className="flex items-center text-[#1c1830]">
            <QlixWordmark className="text-[34px]" />
          </Link>
          <nav className="flex items-center gap-5 text-[12px] font-medium uppercase tracking-wider text-black/45">
            <Link href="/privacy" className="transition-colors hover:text-[#1c1830]">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-[#1c1830]">
              Terms
            </Link>
            <Link
              href="/sign-in"
              className="rounded-full border border-black/15 bg-white/60 px-3.5 py-1.5 text-[12px] normal-case tracking-normal text-[#1c1830] transition-colors hover:border-black/30 hover:bg-white/90"
            >
              Sign in
            </Link>
          </nav>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 sm:px-10 sm:py-16">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-black/40">
            Legal
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#1c1830] sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 text-[13px] text-black/45">Last updated: {lastUpdated}</p>
          <p className="mt-6 text-[15px] leading-relaxed text-black/65">{intro}</p>

          <div className="mt-10 space-y-10">
            {sections.map((section, index) => (
              <section key={section.id} id={section.id} className="scroll-mt-20">
                <h2 className="text-[17px] font-semibold tracking-tight text-[#1c1830]">
                  <span className="mr-2 text-black/30">{String(index + 1).padStart(2, "0")}</span>
                  {section.title}
                </h2>
                <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-black/65">
                  {section.content}
                </div>
              </section>
            ))}
          </div>
        </main>

        <footer className="border-t border-black/10 px-6 py-4 sm:px-10">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 text-[11px] uppercase tracking-widest text-black/40">
            <span>© {new Date().getFullYear()} Qlix · Exora</span>
            <div className="flex gap-6">
              <Link href="/privacy" className="transition-colors hover:text-black/70">
                Privacy
              </Link>
              <Link href="/terms" className="transition-colors hover:text-black/70">
                Terms
              </Link>
              <Link href="/" className="transition-colors hover:text-black/70">
                Home
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
