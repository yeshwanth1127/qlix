import type { ReactNode } from "react";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/qlix/docs/PublicSiteChrome";

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
        <PublicSiteHeader />

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

        <PublicSiteFooter />
      </div>
    </div>
  );
}
