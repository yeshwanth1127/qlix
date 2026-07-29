const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export async function joinBetaWaitlist(input: {
  contactType: "email" | "phone";
  contact: string;
}): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  try {
    const response = await fetch(`${apiBase()}/api/v1/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      return {
        ok: false,
        errorMessage: body?.error?.message ?? "Could not join the waitlist. Please try again.",
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      errorMessage: "Could not connect. Please check your connection and try again.",
    };
  }
}
