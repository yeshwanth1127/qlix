const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export async function recordHomepageVisit(visitorId: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiBase()}/api/v1/homepage-visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId }),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}
