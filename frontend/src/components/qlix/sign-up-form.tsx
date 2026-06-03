"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postSignup } from "@/lib/auth-api";
import { consoleHomePath } from "@/lib/workspace";

interface SignUpFormProps {
  readonly defaultWorkspaceType: "individual" | "organization";
}

export function SignUpForm({ defaultWorkspaceType }: SignUpFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [workspaceType, setWorkspaceType] = useState<"individual" | "organization">(
    defaultWorkspaceType,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await postSignup({
        email,
        password,
        displayName: displayName.trim() || undefined,
        workspaceType,
      });
      if (!result.ok || !result.data) {
        setError(result.errorMessage ?? "Could not create account");
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

      <fieldset className="space-y-2">
        <legend className="mb-1 text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
          Workspace
        </legend>
        <div className="flex gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[--text-secondary]">
            <input
              type="radio"
              name="workspaceType"
              checked={workspaceType === "individual"}
              onChange={() => setWorkspaceType("individual")}
              className="accent-[--accent]"
            />
            Individual
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[--text-secondary]">
            <input
              type="radio"
              name="workspaceType"
              checked={workspaceType === "organization"}
              onChange={() => setWorkspaceType("organization")}
              className="accent-[--accent]"
            />
            Organization
          </label>
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="displayName" className="block text-[12px] font-medium text-[--text-tertiary]">
          Display name <span className="text-[--text-tertiary]">(optional)</span>
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="qlix-glass-input h-8 w-full rounded-lg px-3 text-[13px] text-[--text-primary] outline-none transition-colors placeholder:text-[--text-tertiary] focus:border-[--border-strong] focus:ring-1 focus:ring-[--accent-border]"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="signup-email" className="block text-[12px] font-medium text-[--text-tertiary]">
          Email
        </label>
        <input
          id="signup-email"
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
        <label htmlFor="signup-password" className="block text-[12px] font-medium text-[--text-tertiary]">
          Password <span className="font-normal text-[--text-tertiary]">(min 8 characters)</span>
        </label>
        <input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
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
        {loading ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-[12px] text-[--text-tertiary]">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-[--accent] hover:text-[--accent-hover]">
          Sign in
        </Link>
      </p>
    </form>
  );
}
