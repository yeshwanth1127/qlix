"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Terminal } from "lucide-react";
import { postSuperAdminSignup } from "@/lib/auth-api";
import { cn } from "@/lib/utils/cn";
import { ReflectiveCard } from "@/components/qlix/ReflectiveCard";
import { QlixWordmark } from "@/components/qlix/landing/QlixWordmark";

const inputFocus =
  "focus:border-[#4d8eff] focus:ring-1 focus:ring-[#4d8eff] focus:outline-none transition-all";

export default function SuperAdminSignUpPage() {
  const router = useRouter();
  const [bootstrapPassword, setBootstrapPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await postSuperAdminSignup({
        email,
        password,
        displayName: displayName.trim() || undefined,
        bootstrapPassword,
      });
      if (!result.ok || !result.data) {
        setError(result.errorMessage ?? "Could not create account");
        return;
      }
      router.push("/admin/overview");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center bg-[#E2F0CC] px-6 py-12 text-[#011207]"
    >
      <header className="absolute left-0 top-0 flex w-full items-center justify-between px-6 py-4">
        <Link href="/" aria-label="Qlix home">
          <QlixWordmark className="text-[28px]" />
        </Link>
        <Link
          href="/sign-in?mode=sign-in"
          className="text-[13px] font-medium text-[#012F13] hover:text-[#8BC53D]"
        >
          Main sign in
        </Link>
      </header>

      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="qlix-glass-muted mb-4 flex size-10 items-center justify-center rounded-lg ring-1 ring-amber-500/40">
            <Terminal className="size-5 text-amber-200" strokeWidth={2} aria-hidden />
          </div>
          <h1 className="text-2xl font-medium tracking-tight text-[#e5e2e1]">Super admin sign-up</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-[#c2c6d6]">
            Create the first platform administrator account. Requires the server{" "}
            <span className="font-mono text-[#adc6ff]">SUPER_ADMIN_BOOTSTRAP_PASSWORD</span> value as the access
            password below.
          </p>
        </div>

        <ReflectiveCard className="rounded-lg" contentClassName="p-8">
          <form className="space-y-4" onSubmit={onSubmit}>
            {error ? (
              <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">
                {error}
              </p>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor="bootstrap" className="text-[11px] font-medium uppercase tracking-widest text-[#c2c6d6]">
                Super admin access password
              </label>
              <input
                id="bootstrap"
                name="bootstrapPassword"
                type="password"
                autoComplete="off"
                required
                value={bootstrapPassword}
                onChange={(ev) => setBootstrapPassword(ev.target.value)}
                placeholder="From SUPER_ADMIN_BOOTSTRAP_PASSWORD"
                className={cn(
                  "qlix-glass-input w-full rounded-sm border-amber-500/30 px-3 py-2 text-[14px] text-[#e5e2e1] placeholder:text-[#5c5f6b]",
                  inputFocus,
                )}
              />
              <p className="text-[11px] leading-snug text-[#8c909f]">
                Not your account password — this matches the API env secret (min 12 characters).
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sa-name" className="text-[11px] font-medium uppercase tracking-widest text-[#c2c6d6]">
                Display name
              </label>
              <input
                id="sa-name"
                name="displayName"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(ev) => setDisplayName(ev.target.value)}
                placeholder="Platform ops"
                className={cn(
                  "qlix-glass-input w-full rounded-sm px-3 py-2 text-[14px] text-[#e5e2e1] placeholder:text-[#424754]",
                  inputFocus,
                )}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sa-email" className="text-[11px] font-medium uppercase tracking-widest text-[#c2c6d6]">
                Email
              </label>
              <input
                id="sa-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                placeholder="ops@yourcompany.com"
                className={cn(
                  "qlix-glass-input w-full rounded-sm px-3 py-2 text-[14px] text-[#e5e2e1] placeholder:text-[#424754]",
                  inputFocus,
                )}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sa-password" className="text-[11px] font-medium uppercase tracking-widest text-[#c2c6d6]">
                Account password
              </label>
              <input
                id="sa-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                placeholder="••••••••"
                className={cn(
                  "qlix-glass-input w-full rounded-sm px-3 py-2 text-[14px] text-[#e5e2e1] placeholder:text-[#424754]",
                  inputFocus,
                )}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex w-full items-center justify-center rounded-sm bg-amber-600 py-2.5 text-[14px] font-medium text-white transition-all hover:bg-amber-500 active:opacity-90 disabled:opacity-50"
            >
              {loading ? "Creating super admin…" : "Create super admin account"}
            </button>
          </form>

          <p className="mt-6 text-center text-[12px] leading-relaxed text-[#8c909f]">
            After this account exists, additional super admins need{" "}
            <span className="font-mono text-[#c2c6d6]">SUPER_ADMIN_BOOTSTRAP_ALLOW_MULTIPLE=true</span> or the promote
            script.
          </p>
        </ReflectiveCard>

        <p className="mt-8 text-center text-[13px] text-[#c2c6d6]">
          Regular workspace?{" "}
          <Link href="/sign-in?mode=sign-up" className="font-medium text-[#adc6ff] hover:text-[#4d8eff]">
            Standard sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
