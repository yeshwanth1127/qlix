const defaultBase = "http://localhost:4000";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBase).replace(/\/$/, "");
}

export interface PluginDTO {
  id: string;
  name: string;
  description: string;
  navItems: Array<{ href: string; label: string; iconName: string }>;
  defaultEnabled: boolean;
  enabled: boolean;
}

export async function listPlugins(): Promise<PluginDTO[] | null> {
  const res = await fetch(`${apiBase()}/api/v1/plugins`, { credentials: "include" });
  if (!res.ok) return null;
  const body = (await res.json()) as { plugins: PluginDTO[] };
  return body.plugins;
}

export async function enablePlugin(pluginId: string): Promise<PluginDTO[] | null> {
  const res = await fetch(`${apiBase()}/api/v1/plugins/${encodeURIComponent(pluginId)}/enable`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { plugins: PluginDTO[] };
  return body.plugins;
}

export async function disablePlugin(pluginId: string): Promise<PluginDTO[] | null> {
  const res = await fetch(`${apiBase()}/api/v1/plugins/${encodeURIComponent(pluginId)}/disable`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { plugins: PluginDTO[] };
  return body.plugins;
}
