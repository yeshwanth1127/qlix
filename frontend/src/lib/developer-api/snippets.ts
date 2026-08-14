import type { ExplorerOperation, HttpMethod } from "./openapi";

export interface SnippetValues {
  readonly apiRoot: string;
  readonly pathValues: Record<string, string>;
  readonly queryValues: Record<string, string>;
  readonly body: string;
}

function interpolatePath(path: string, values: Record<string, string>): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = values[name]?.trim();
    return encodeURIComponent(value && value.length > 0 ? value : name.toUpperCase());
  });
}

export function buildRequestUrl(apiRoot: string, op: ExplorerOperation, values: SnippetValues): string {
  const path = interpolatePath(op.path, values.pathValues);
  const url = new URL(`${apiRoot.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`);
  for (const param of op.parameters.filter((p) => p.in === "query")) {
    const raw = values.queryValues[param.name]?.trim();
    if (raw) url.searchParams.set(param.name, raw);
  }
  return url.toString();
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

export function curlSnippet(op: ExplorerOperation, values: SnippetValues): string {
  const url = buildRequestUrl(values.apiRoot, op, values);
  const method = op.method.toUpperCase();
  const lines = [
    `curl -sS -X ${method} \\`,
    `  -H "Authorization: Bearer $QLIX_API_KEY" \\`,
  ];
  const hasBody = Boolean(values.body.trim()) && method !== "GET" && method !== "HEAD";
  if (hasBody) {
    lines.push(`  -H "Content-Type: application/json" \\`);
    lines.push(`  -d '${escapeSingleQuotes(values.body.trim())}' \\`);
  }
  lines.push(`  "${url}"`);
  return lines.join("\n");
}

export function pythonSnippet(op: ExplorerOperation, values: SnippetValues): string {
  const url = buildRequestUrl(values.apiRoot, op, values);
  const method = op.method;
  const hasBody = Boolean(values.body.trim()) && method !== "get" && method !== "head";
  const lines = [
    "import json",
    "import os",
    "import requests",
    "",
    'API_KEY = os.environ["QLIX_API_KEY"]',
    `url = ${JSON.stringify(url)}`,
    'headers = {"Authorization": f"Bearer {API_KEY}"}',
  ];
  if (hasBody) {
    lines.push("headers[\"Content-Type\"] = \"application/json\"");
    lines.push(`body = json.loads(${JSON.stringify(values.body.trim() || "{}")})`);
    lines.push(`res = requests.request(${JSON.stringify(method)}, url, headers=headers, json=body, timeout=30)`);
  } else {
    lines.push(`res = requests.request(${JSON.stringify(method)}, url, headers=headers, timeout=30)`);
  }
  lines.push("res.raise_for_status()");
  lines.push("print(res.text)");
  return lines.join("\n");
}

export function fetchSnippet(op: ExplorerOperation, values: SnippetValues): string {
  const url = buildRequestUrl(values.apiRoot, op, values);
  const method = op.method.toUpperCase() as Uppercase<HttpMethod>;
  const hasBody = Boolean(values.body.trim()) && method !== "GET" && method !== "HEAD";
  const headerLines = hasBody
    ? `  headers: {\n    Authorization: \`Bearer \${process.env.QLIX_API_KEY}\`,\n    "Content-Type": "application/json",\n  },`
    : `  headers: { Authorization: \`Bearer \${process.env.QLIX_API_KEY}\` },`;
  const bodyLine = hasBody ? `\n  body: JSON.stringify(${values.body.trim() || "{}"}),` : "";
  return `const res = await fetch(${JSON.stringify(url)}, {\n  method: ${JSON.stringify(method)},\n${headerLines}${bodyLine}\n});\nif (!res.ok) throw new Error(await res.text());\nconsole.log(await res.json());`;
}
