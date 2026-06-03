"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postLogin } from "@/lib/auth-api";
import { consoleHomePath } from "@/lib/workspace";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await postLogin({ email, password });
      if (!result.ok || !result.data) {
        setError(result.errorMessage ?? "Sign in failed");
        return;
      }
      router.push(
        consoleHomePath(result.data.user.workspaceKind ?? result.data.organization.workspaceKind),
      );
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      {error ? (
        <p className="rounded-lg border border-[--danger]/30 bg-[--danger-subtle] px-3 py-2 text-[13px] text-[--danger]">
          {error}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-[12px] font-medium text-[--text-tertiary]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="qlix-glass-input h-8 w-full rounded-lg px-3 text-[13px] text-[--text-primary] outline-none transition-colors placeholder:text-[--text-tertiary] focus:border-[--border-strong] focus:ring-1 focus:ring-[--accent-border]"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-[12px] font-medium text-[--text-tertiary]">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="qlix-glass-input h-8 w-full rounded-lg px-3 text-[13px] text-[--text-primary] outline-none transition-colors placeholder:text-[--text-tertiary] focus:border-[--border-strong] focus:ring-1 focus:ring-[--accent-border]"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="flex h-8 w-full items-center justify-center rounded-lg bg-[--accent] text-[13px] font-medium text-white transition-colors duration-150 ease-out hover:bg-[--accent-hover] disabled:opacity-50 active:scale-[0.98]"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-[12px] text-[--text-tertiary]">
        No account?{" "}
        <Link href="/sign-in?mode=sign-up" className="font-medium text-[--accent] hover:text-[--accent-hover]">
          Create one
        </Link>
      </p>
    </form>
  );
}
