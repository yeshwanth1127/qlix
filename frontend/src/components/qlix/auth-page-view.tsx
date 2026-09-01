"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Building2, Check, User } from "lucide-react";
import { postLogin, postSignup, oauthStartUrl, oauthErrorMessage } from "@/lib/auth-api";
import type { OAuthLoginProvider } from "@/lib/auth-api";
import { consoleHomePath } from "@/lib/workspace";
import { cn } from "@/lib/utils/cn";
import { QlixWordmark } from "./landing/QlixWordmark";
import PixelBlast from "./PixelBlast";

type AuthMode = "sign-in" | "sign-up";
type WorkspaceType = "individual" | "organization";

const WORKSPACE_OPTIONS: ReadonlyArray<{
  value: WorkspaceType;
  title: string;
  description: string;
  icon: typeof User;
}> = [
  {
    value: "individual",
    title: "Individual",
    description: "Personal workspace for solo developers.",
    icon: User,
  },
  {
    value: "organization",
    title: "Organization",
    description: "Shared registry, members, and audit for teams.",
    icon: Building2,
  },
];

export interface AuthPageViewProps {
  readonly initialMode: AuthMode;
  readonly defaultWorkspaceType: "individual" | "organization";
}

function GoogleMark() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.27.81-.57z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg className="size-4 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export function AuthPageView({ initialMode, defaultWorkspaceType }: AuthPageViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteFromUrl = searchParams.get("invite");
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [workspaceType, setWorkspaceType] = useState<"individual" | "organization">(defaultWorkspaceType);
  const signupWorkspaceSelection = inviteFromUrl ? "organization" : workspaceType;

  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signInLoading, setSignInLoading] = useState(false);

  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpError, setSignUpError] = useState<string | null>(null);
  const [signUpLoading, setSignUpLoading] = useState(false);

  useEffect(() => {
    const err = oauthErrorMessage(searchParams.get("error"));
    if (!err) return;
    if (mode === "sign-up") setSignUpError(err);
    else setSignInError(err);
  }, [searchParams, mode]);

  const syncUrl = useCallback(
    (next: AuthMode) => {
      const params = new URLSearchParams(searchParams.toString());
      const invite = searchParams.get("invite");
      if (next === "sign-up") {
        params.set("mode", "sign-up");
        const inv = searchParams.get("invite");
        params.set("workspace", inv ? "organization" : workspaceType);
      } else {
        params.delete("mode");
        params.delete("workspace");
      }
      if (invite) {
        params.set("invite", invite);
      }
      const q = params.toString();
      router.replace(q ? `/sign-in?${q}` : "/sign-in", { scroll: false });
    },
    [router, searchParams, workspaceType],
  );

  function setAuthMode(next: AuthMode) {
    setMode(next);
    syncUrl(next);
  }

  function selectWorkspaceType(next: WorkspaceType) {
    setWorkspaceType(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", "sign-up");
    params.set("workspace", next);
    router.replace(`/sign-in?${params.toString()}`, { scroll: false });
  }

  function startOAuth(provider: OAuthLoginProvider) {
    const invite = searchParams.get("invite");
    const url = oauthStartUrl(provider, {
      workspaceType: mode === "sign-up" ? (invite ? "organization" : workspaceType) : "individual",
      invite,
    });
    window.location.href = url;
  }

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setSignInError(null);
    setSignInLoading(true);
    try {
      const result = await postLogin({ email: signInEmail, password: signInPassword });
      if (!result.ok || !result.data) {
        setSignInError(result.errorMessage ?? "Sign in failed");
        return;
      }
      router.push(
        result.data.user.isSuperAdmin
          ? "/admin/overview"
          : consoleHomePath(result.data.user.workspaceKind ?? result.data.organization.workspaceKind),
      );
      router.refresh();
    } finally {
      setSignInLoading(false);
    }
  }

  async function onSignUp(e: React.FormEvent) {
    e.preventDefault();
    setSignUpError(null);
    setSignUpLoading(true);
    try {
      const inviteToken = searchParams.get("invite")?.trim();
      const result = await postSignup({
        email: signUpEmail,
        password: signUpPassword,
        displayName: signUpName.trim() || undefined,
        workspaceType: inviteToken ? "organization" : workspaceType,
        ...(inviteToken ? { inviteToken } : {}),
      });
      if (!result.ok || !result.data) {
        setSignUpError(result.errorMessage ?? "Could not create account");
        return;
      }
      router.push(
        consoleHomePath(result.data.user.workspaceKind ?? result.data.organization.workspaceKind),
      );
      router.refresh();
    } finally {
      setSignUpLoading(false);
    }
  }

  const inputFocus =
    "focus:border-[#012F13]/50 focus:ring-1 focus:ring-[#012F13]/25 focus:outline-none transition-all";

  const glassCard =
    "rounded-2xl border border-[color:var(--qlix-card-border)] bg-[#E2F0CC]/65 shadow-[0_1px_1px_rgba(28,24,48,0.04),0_28px_70px_-32px_rgba(28,24,48,0.4),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-2xl";

  return (
    <div data-swiss-layout="auth" className="relative flex h-screen w-full overflow-hidden bg-[#E2F0CC] text-[#012F13]">
      {/* PixelBlast animated background — ink pixels on paper */}
      <div className="absolute inset-0">
        <PixelBlast
          variant="circle"
          pixelSize={6}
          color="#012F13"
          patternScale={3}
          patternDensity={1.2}
          pixelSizeJitter={0.5}
          enableRipples
          rippleSpeed={0.4}
          rippleThickness={0.12}
          rippleIntensityScale={1.5}
          speed={0.6}
          edgeFade={0}
          transparent
        />
      </div>
      {/* Readability scrim over the background */}
      <div className="pointer-events-none absolute inset-0 bg-[#E2F0CC]/80" aria-hidden />

      {/* Foreground — pointer-events-none so the background keeps tracking the
          pointer for parallax; re-enabled on the interactive controls below. */}
      <div className="pointer-events-none relative z-10 flex w-full flex-col overflow-y-auto">
        {/* Top nav */}
        <div className="flex h-14 shrink-0 items-center justify-between px-6 sm:px-10">
          <Link href="/" className="pointer-events-auto flex items-center text-[#012F13]">
            <QlixWordmark className="text-[34px]" />
          </Link>
          <div className="pointer-events-auto ml-auto flex items-center gap-3 text-[13px]">
            <span className="hidden text-black/50 sm:inline">
              {mode === "sign-in" ? "New to Qlix?" : "Already have an account?"}
            </span>
            <button
              type="button"
              onClick={() => setAuthMode(mode === "sign-in" ? "sign-up" : "sign-in")}
              className="rounded-full border border-black/15 bg-[#E2F0CC]/60 px-4 py-1.5 text-[13px] font-medium text-[#012F13] backdrop-blur-sm transition-colors hover:border-black/30 hover:bg-[#E2F0CC]/90"
            >
              {mode === "sign-in" ? "Create account" : "Sign in"}
            </button>
          </div>
        </div>

        {/* Form area */}
        <main className="pointer-events-auto flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full max-w-[400px]">
            {mode === "sign-in" ? (
              <>
                <div className="mb-8">
                  <h1 className="text-2xl font-semibold tracking-tight text-[#012F13]">
                    Welcome back
                  </h1>
                  <p className="mt-1 text-[14px] text-black/55">
                    Sign in to your Qlix workspace
                  </p>
                </div>

                {signInError ? (
                  <p className="mb-4 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[13px] text-red-700">
                    {signInError}
                  </p>
                ) : null}

                <div className="mb-6 grid gap-3">
                  <button
                    type="button"
                    onClick={() => startOAuth("github")}
                    className="flex h-10 w-full items-center justify-center gap-3 rounded-xl border border-black/12 bg-[#E2F0CC]/60 text-[14px] font-medium text-[#012F13] backdrop-blur-sm transition-colors hover:border-black/25 hover:bg-[#E2F0CC]/90 active:opacity-80"
                  >
                    <GitHubMark />
                    Continue with GitHub
                  </button>
                  <button
                    type="button"
                    onClick={() => startOAuth("google")}
                    className="flex h-10 w-full items-center justify-center gap-3 rounded-xl border border-black/12 bg-[#E2F0CC]/60 text-[14px] font-medium text-[#012F13] backdrop-blur-sm transition-colors hover:border-black/25 hover:bg-[#E2F0CC]/90 active:opacity-80"
                  >
                    <GoogleMark />
                    Continue with Google
                  </button>
                </div>

                <div className="relative mb-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-black/10" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="rounded-full bg-[#E2F0CC] px-3 text-[12px] uppercase tracking-widest text-black/40">
                      or
                    </span>
                  </div>
                </div>

                <div className={cn(glassCard, "p-6")}>
                  <form className="space-y-4" onSubmit={onSignIn}>
                    <div className="space-y-1.5">
                      <label htmlFor="email" className="text-[11px] font-semibold uppercase tracking-widest text-black/50">
                        Email
                      </label>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={signInEmail}
                        onChange={(ev) => setSignInEmail(ev.target.value)}
                        placeholder="dev@qlix.io"
                        className={cn(
                          "h-10 w-full rounded-xl border border-black/12 bg-[#E2F0CC]/70 px-3 text-[14px] text-[#012F13] placeholder:text-black/30",
                          inputFocus,
                        )}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-widest text-black/50">
                          Password
                        </label>
                        <a href="#" className="text-[12px] text-black/45 transition-colors hover:text-[#012F13]">
                          Forgot?
                        </a>
                      </div>
                      <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={signInPassword}
                        onChange={(ev) => setSignInPassword(ev.target.value)}
                        placeholder="••••••••"
                        className={cn(
                          "h-10 w-full rounded-xl border border-black/12 bg-[#E2F0CC]/70 px-3 text-[14px] text-[#012F13] placeholder:text-black/30",
                          inputFocus,
                        )}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={signInLoading}
                      className="mt-2 flex h-10 w-full items-center justify-center rounded-xl bg-[#012F13] text-[14px] font-semibold text-white shadow-[0_14px_30px_-14px_rgba(28,24,48,0.5)] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                    >
                      {signInLoading ? "Signing in…" : "Sign In"}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <>
                <div className="mb-8">
                  <h1 className="text-2xl font-semibold tracking-tight text-[#012F13]">
                    Create your account
                  </h1>
                  <p className="mt-1 text-[14px] text-black/55">
                    Start building autonomous AI agents with Qlix.
                  </p>
                </div>

                <div className={cn(glassCard, "p-6")}>
                  <form className="space-y-4" onSubmit={onSignUp}>
                    {signUpError ? (
                      <p className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[13px] text-red-700">
                        {signUpError}
                      </p>
                    ) : null}

                    <fieldset className="space-y-2.5">
                      <legend className="text-[11px] font-semibold uppercase tracking-widest text-black/50">
                        Workspace type
                      </legend>
                      {inviteFromUrl ? (
                        <div className="rounded-xl border border-[#012F13]/15 bg-[#012F13]/[0.04] px-3 py-2.5">
                          <div className="flex items-start gap-2.5">
                            <Building2 className="mt-0.5 size-4 shrink-0 text-[#012F13]/70" aria-hidden />
                            <div>
                              <p className="text-[13px] font-medium text-[#012F13]">Organization invite</p>
                              <p className="mt-0.5 text-[12px] leading-relaxed text-black/55">
                                You&apos;re joining an organization via invitation.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          {WORKSPACE_OPTIONS.map(({ value, title, description, icon: Icon }) => {
                            const selected = signupWorkspaceSelection === value;
                            return (
                              <label
                                key={value}
                                className={cn(
                                  "relative flex cursor-pointer flex-col gap-2.5 rounded-xl border p-3.5 transition-all duration-200",
                                  selected
                                    ? "border-[#012F13]/30 bg-[#012F13]/[0.06] shadow-[inset_0_0_0_1px_rgba(28,24,48,0.06)]"
                                    : "border-black/12 bg-[#E2F0CC]/55 hover:border-black/20 hover:bg-[#E2F0CC]/80",
                                )}
                              >
                                <input
                                  type="radio"
                                  name="workspaceType"
                                  value={value}
                                  checked={selected}
                                  onChange={() => selectWorkspaceType(value)}
                                  className="sr-only"
                                />
                                <div className="flex items-start justify-between gap-2">
                                  <span
                                    className={cn(
                                      "flex size-8 items-center justify-center rounded-lg border transition-colors",
                                      selected
                                        ? "border-[#012F13]/20 bg-[#E2F0CC]/80 text-[#012F13]"
                                        : "border-black/10 bg-[#E2F0CC]/70 text-black/45",
                                    )}
                                  >
                                    <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                                  </span>
                                  {selected ? (
                                    <span className="flex size-5 items-center justify-center rounded-full bg-[#012F13] text-white">
                                      <Check className="size-3" strokeWidth={2.5} aria-hidden />
                                    </span>
                                  ) : null}
                                </div>
                                <div>
                                  <span className="block text-[13px] font-semibold text-[#012F13]">
                                    {title}
                                  </span>
                                  <span className="mt-1 block text-[11px] leading-snug text-black/50">
                                    {description}
                                  </span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </fieldset>

                    <div className="space-y-1.5">
                      <label htmlFor="name" className="text-[11px] font-semibold uppercase tracking-widest text-black/50">
                        Full Name
                      </label>
                      <input
                        id="name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        value={signUpName}
                        onChange={(ev) => setSignUpName(ev.target.value)}
                        placeholder="Alan Turing"
                        className={cn(
                          "h-10 w-full rounded-xl border border-black/12 bg-[#E2F0CC]/70 px-3 text-[14px] text-[#012F13] placeholder:text-black/30",
                          inputFocus,
                        )}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="signup-email" className="text-[11px] font-semibold uppercase tracking-widest text-black/50">
                        Email
                      </label>
                      <input
                        id="signup-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={signUpEmail}
                        onChange={(ev) => setSignUpEmail(ev.target.value)}
                        placeholder="name@company.com"
                        className={cn(
                          "h-10 w-full rounded-xl border border-black/12 bg-[#E2F0CC]/70 px-3 text-[14px] text-[#012F13] placeholder:text-black/30",
                          inputFocus,
                        )}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="signup-password" className="text-[11px] font-semibold uppercase tracking-widest text-black/50">
                        Password
                      </label>
                      <input
                        id="signup-password"
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={signUpPassword}
                        onChange={(ev) => setSignUpPassword(ev.target.value)}
                        placeholder="••••••••"
                        className={cn(
                          "h-10 w-full rounded-xl border border-black/12 bg-[#E2F0CC]/70 px-3 text-[14px] text-[#012F13] placeholder:text-black/30",
                          inputFocus,
                        )}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={signUpLoading}
                      className="mt-2 flex h-10 w-full items-center justify-center rounded-xl bg-[#012F13] text-[14px] font-semibold text-white shadow-[0_14px_30px_-14px_rgba(28,24,48,0.5)] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                    >
                      {signUpLoading ? "Creating account…" : "Create Account"}
                    </button>
                  </form>

                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-black/10" />
                    </div>
                    <div className="relative flex justify-center text-[11px] font-medium uppercase tracking-widest">
                      <span className="bg-transparent px-3 text-black/40">Or continue with</span>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <button
                      type="button"
                      onClick={() => startOAuth("github")}
                      className="flex h-10 w-full items-center justify-center gap-3 rounded-xl border border-black/12 bg-[#E2F0CC]/60 text-[13px] font-medium text-[#012F13] backdrop-blur-sm transition-colors hover:border-black/25 hover:bg-[#E2F0CC]/90 active:opacity-80"
                    >
                      <GitHubMark />
                      Sign up with GitHub
                    </button>
                    <button
                      type="button"
                      onClick={() => startOAuth("google")}
                      className="flex h-10 w-full items-center justify-center gap-3 rounded-xl border border-black/12 bg-[#E2F0CC]/60 text-[13px] font-medium text-[#012F13] backdrop-blur-sm transition-colors hover:border-black/25 hover:bg-[#E2F0CC]/90 active:opacity-80"
                    >
                      <GoogleMark />
                      Sign up with Google
                    </button>
                  </div>

                  <div className="mt-4">
                    <Link
                      href="/super-admin/sign-up"
                      className="flex w-full items-center justify-center rounded-xl border border-amber-600/30 bg-amber-500/10 py-2.5 text-[13px] font-medium text-amber-900/80 transition-colors hover:border-amber-600/45 hover:bg-amber-500/15"
                    >
                      Super admin sign-up
                    </Link>
                    <p className="mt-2 text-center text-[11px] leading-snug text-black/40">
                      Platform operators only — requires server access password.
                    </p>
                  </div>
                </div>

                <p className="mt-6 text-center text-[11px] uppercase leading-relaxed tracking-wider text-black/40">
                  By signing up, you agree to our{" "}
                  <Link className="text-[#012F13]/70 transition-all hover:underline" href="/terms">
                    Terms
                  </Link>{" "}
                  and{" "}
                  <Link className="text-[#012F13]/70 transition-all hover:underline" href="/privacy">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </>
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className="pointer-events-auto shrink-0 border-t border-black/10 px-6 py-4 sm:px-10">
          <div className="flex flex-wrap items-center justify-between gap-4 text-[11px] uppercase tracking-widest text-black/40">
            <span>© {new Date().getFullYear()} Qlix</span>
            <div className="flex gap-6">
              <Link href="/privacy" className="transition-colors hover:text-black/70">Privacy</Link>
              <Link href="/terms" className="transition-colors hover:text-black/70">Terms</Link>
              <a href="#" className="transition-colors hover:text-black/70">Status</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
