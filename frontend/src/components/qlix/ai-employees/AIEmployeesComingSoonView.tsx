import { Bot, BrainCircuit, Clock3, Sparkles, UsersRound, Workflow } from "lucide-react";
import {
  SketchBox,
  SketchPageHeader,
  SketchSection,
  sketchLabel,
} from "@/components/qlix/sketch";
import { cn } from "@/lib/utils/cn";

const capabilities = [
  {
    icon: BrainCircuit,
    title: "Built for a role",
    description: "Describe the outcome you need and shape an employee around your company, tools, and knowledge.",
  },
  {
    icon: Workflow,
    title: "Ready to work",
    description: "Give each employee repeatable workflows, permissions, and clear boundaries before they begin.",
  },
  {
    icon: UsersRound,
    title: "Part of the team",
    description: "Create specialists that can work independently or coordinate with your existing Qlix agents and teams.",
  },
] as const;

export function AIEmployeesComingSoonView() {
  return (
    <div className="flex min-h-full flex-col">
      <SketchPageHeader title="AI Employees" />

      <SketchBox className="relative isolate overflow-hidden px-5 py-12 sm:px-10 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 -z-10 size-80 rounded-full bg-[color:var(--sketch-purple)]/[0.08] blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-24 -z-10 size-72 rounded-full bg-black/[0.05] blur-3xl"
        />

        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <div className="relative mb-7 flex size-24 items-center justify-center rounded-full border border-black/10 bg-[#E2F0CC]/75 shadow-[var(--sketch-shadow)] backdrop-blur-xl">
            <div className="absolute inset-2 rounded-full border border-dashed border-[color:var(--sketch-purple)]/35" />
            <Bot className="size-9 text-black" strokeWidth={1.25} aria-hidden="true" />
            <Sparkles
              className="absolute right-1 top-1 size-5 text-[color:var(--sketch-purple)]"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </div>

          <span
            className={cn(
              sketchLabel,
              "mb-4 inline-flex items-center gap-2 rounded-full border border-[color:var(--sketch-purple)]/25 bg-[color:var(--sketch-purple-soft)] px-3 py-1.5 text-[color:var(--sketch-purple)]",
            )}
          >
            <Clock3 className="size-3" aria-hidden="true" />
            On the horizon
          </span>

          <h1 className="max-w-xl text-balance text-3xl font-bold tracking-[-0.04em] text-black sm:text-4xl">
            Your next teammate won&apos;t need onboarding.
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-[14px] leading-7 text-black/55 sm:text-[15px]">
            Soon, you&apos;ll be able to create complete AI employees for the work your business needs—
            from a single specialist to an entire digital team.
          </p>

          <div className="mt-8 h-px w-20 bg-[color:var(--sketch-purple)]/45" />
          <p className={cn(sketchLabel, "mt-4 text-[10px] text-black/40")}>
            Thoughtfully designed · Safely governed · Coming soon
          </p>
        </div>
      </SketchBox>

      <SketchSection title="What's coming" className="mt-5">
        <div className="grid gap-3 md:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="rounded-2xl border border-black/10 bg-[#E2F0CC]/55 p-5 shadow-[var(--sketch-shadow)] backdrop-blur-xl"
            >
              <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-black/10 bg-[#E2F0CC]/80">
                <Icon className="size-4.5 text-black" strokeWidth={1.4} aria-hidden="true" />
              </div>
              <h2 className="text-[13px] font-bold text-black">{title}</h2>
              <p className="mt-2 text-[12px] leading-5 text-black/50">{description}</p>
            </div>
          ))}
        </div>
      </SketchSection>
    </div>
  );
}
