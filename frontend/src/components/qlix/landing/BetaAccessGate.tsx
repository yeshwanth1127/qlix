"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Mail,
  Phone,
} from "lucide-react";
import { joinBetaWaitlist } from "@/lib/waitlist-api";
import { recordHomepageVisit } from "@/lib/visit-api";
import { cn } from "@/lib/utils/cn";

const BETA_NOTICE_KEY = "qlix-beta-notice-seen";
const HOMEPAGE_VISITOR_KEY = "qlix-homepage-visitor-id";
const HOMEPAGE_VISIT_SENT_KEY = "qlix-homepage-visit-sent";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ContactType = "email" | "phone";

export function BetaAccessGate({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [contactType, setContactType] = useState<ContactType>("email");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (window.localStorage.getItem(BETA_NOTICE_KEY) === "1") {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(HOMEPAGE_VISIT_SENT_KEY)) return;

      let visitorId = window.localStorage.getItem(HOMEPAGE_VISITOR_KEY);
      if (!visitorId || !UUID_PATTERN.test(visitorId)) {
        visitorId = window.crypto.randomUUID();
        window.localStorage.setItem(HOMEPAGE_VISITOR_KEY, visitorId);
      }

      window.sessionStorage.setItem(HOMEPAGE_VISIT_SENT_KEY, "pending");
      void recordHomepageVisit(visitorId).then((recorded) => {
        if (recorded) {
          window.sessionStorage.setItem(HOMEPAGE_VISIT_SENT_KEY, "sent");
        } else {
          window.sessionStorage.removeItem(HOMEPAGE_VISIT_SENT_KEY);
        }
      });
    } catch {
      // Storage can be unavailable in hardened privacy modes; never block the homepage.
    }
  }, []);

  const continueToBeta = () => {
    window.localStorage.setItem(BETA_NOTICE_KEY, "1");
    setOpen(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = contact.trim();
    if (!value) {
      setError(`Enter your ${contactType === "email" ? "email address" : "phone number"}.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    const result = await joinBetaWaitlist({ contactType, contact: value });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.errorMessage);
      return;
    }

    window.localStorage.setItem(BETA_NOTICE_KEY, "1");
    setJoined(true);
  };

  return (
    <>
      {children}
      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto px-4 py-8 text-white backdrop-blur-[2px]">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="beta-title"
            aria-describedby="beta-description"
            className="w-full max-w-md rounded-2xl border border-white/15 bg-[#18181b]/85 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-7"
          >
        {joined ? (
          <div className="text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10">
              <CheckCircle2 className="size-5 text-emerald-400" aria-hidden />
            </div>
            <h1 className="mt-4 text-[17px] font-medium tracking-[-0.02em]">
              You&apos;re on the waitlist
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
              Thanks for your interest. We&apos;ll contact you with beta updates.
            </p>
            <button
              type="button"
              onClick={continueToBeta}
              className="mt-6 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-white px-4 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-zinc-200 active:scale-[0.98]"
            >
              Continue to Qlix
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/10">
                <FlaskConical className="size-5 text-violet-300" aria-hidden />
              </div>
              <div>
                <span className="inline-flex rounded-full border border-violet-400/20 bg-violet-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-violet-300">
                  Beta
                </span>
                <h1 id="beta-title" className="mt-1 text-[17px] font-medium tracking-[-0.02em]">
                  Qlix is still in beta
                </h1>
              </div>
            </div>

            <p id="beta-description" className="mt-4 text-[13px] leading-relaxed text-zinc-400">
              Some functionality is still under development and may change while we improve the
              experience.
            </p>

            <div className="my-5 h-px bg-white/8" />

            <h2 className="text-[13px] font-medium text-zinc-100">Join the waitlist</h2>
            <p className="mt-1 text-[12px] text-zinc-500">
              Choose one contact method. Nothing else is required.
            </p>

            <form onSubmit={submit} className="mt-4">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Contact method">
                {(["email", "phone"] as const).map((type) => {
                  const Icon = type === "email" ? Mail : Phone;
                  const selected = contactType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setContactType(type);
                        setContact("");
                        setError(null);
                      }}
                      className={cn(
                        "flex h-9 items-center justify-center gap-2 rounded-lg border text-[12px] font-medium capitalize transition-colors",
                        selected
                          ? "border-violet-400/40 bg-violet-400/10 text-violet-200"
                          : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-zinc-200",
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {type}
                    </button>
                  );
                })}
              </div>

              <label htmlFor="waitlist-contact" className="sr-only">
                {contactType === "email" ? "Email address" : "Phone number with country code"}
              </label>
              <div className="relative mt-3">
                {contactType === "email" ? (
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
                    aria-hidden
                  />
                ) : (
                  <Phone
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
                    aria-hidden
                  />
                )}
                <input
                  id="waitlist-contact"
                  type={contactType === "email" ? "email" : "tel"}
                  inputMode={contactType === "email" ? "email" : "tel"}
                  autoComplete={contactType}
                  value={contact}
                  onChange={(event) => {
                    setContact(event.target.value);
                    setError(null);
                  }}
                  placeholder={
                    contactType === "email" ? "you@example.com" : "+1 555 123 4567"
                  }
                  disabled={submitting}
                  className="h-10 w-full rounded-lg border border-white/10 bg-black/20 pl-10 pr-3 text-[13px] text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-400/50 focus:ring-1 focus:ring-violet-400/20 disabled:opacity-60"
                />
              </div>

              {error ? (
                <p role="alert" className="mt-2 text-[12px] text-red-400">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-white px-4 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-zinc-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Joining…
                  </>
                ) : (
                  <>
                    Join waitlist
                    <ArrowRight className="size-4" aria-hidden />
                  </>
                )}
              </button>
            </form>

            <button
              type="button"
              onClick={continueToBeta}
              disabled={submitting}
              className="mt-3 h-8 w-full text-[12px] text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
            >
              Continue without joining
            </button>
          </>
        )}
          </section>
        </div>
      ) : null}
    </>
  );
}
