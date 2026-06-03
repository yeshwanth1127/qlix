"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/**
 * Toggles light / dark; persists via next-themes (`qlix-theme` storage key).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <span
        className="inline-flex size-8 shrink-0 items-center justify-center"
        aria-hidden
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="qlix-glass-muted inline-flex size-8 items-center justify-center rounded-md text-[--text-tertiary] transition-colors duration-150 ease-out hover:bg-[var(--glass-surface-bg-hover)] hover:text-[--text-primary]"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <Sun className="size-4" strokeWidth={1.75} aria-hidden />
      ) : (
        <Moon className="size-4" strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}
