import { developerApiBaseUrl } from "@/lib/api-keys-api";

export type HttpMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";

export const HTTP_METHODS: readonly HttpMethod[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

export interface OpenApiRef {
  readonly $ref: string;
}

export interface OpenApiSchema {
  readonly type?: string;
  readonly format?: string;
  readonly enum?: readonly unknown[];
  readonly properties?: Record<string, OpenApiSchema | OpenApiRef>;
  readonly items?: OpenApiSchema | OpenApiRef;
  readonly required?: readonly string[];
  readonly example?: unknown;
  readonly nullable?: boolean;
  readonly $ref?: string;
}

export interface OpenApiParameter {
  readonly name: string;
  readonly in: "path" | "query" | "header" | "cookie";
  readonly required?: boolean;
  readonly schema?: OpenApiSchema | OpenApiRef;
  readonly description?: string;
  readonly $ref?: string;
}

export interface OpenApiMedia {
  readonly schema?: OpenApiSchema | OpenApiRef;
  readonly example?: unknown;
}

export interface OpenApiRequestBody {
  readonly required?: boolean;
  readonly content?: Record<string, OpenApiMedia>;
}

export interface OpenApiOperation {
  readonly operationId?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly parameters?: readonly (OpenApiParameter | OpenApiRef)[];
  readonly requestBody?: OpenApiRequestBody | OpenApiRef;
  readonly "x-qlix-scopes"?: readonly string[];
}

export interface OpenApiPathItem {
  readonly parameters?: readonly (OpenApiParameter | OpenApiRef)[];
  readonly get?: OpenApiOperation;
  readonly put?: OpenApiOperation;
  readonly post?: OpenApiOperation;
  readonly delete?: OpenApiOperation;
  readonly options?: OpenApiOperation;
  readonly head?: OpenApiOperation;
  readonly patch?: OpenApiOperation;
  readonly trace?: OpenApiOperation;
}

export interface OpenApiTag {
  readonly name: string;
  readonly description?: string;
}

export interface OpenApiServer {
  readonly url: string;
  readonly description?: string;
}

export interface OpenApiDocument {
  readonly openapi?: string;
  readonly info?: { readonly title?: string; readonly version?: string; readonly description?: string };
  readonly servers?: readonly OpenApiServer[];
  readonly tags?: readonly OpenApiTag[];
  readonly paths?: Record<string, OpenApiPathItem>;
  readonly components?: {
    readonly schemas?: Record<string, OpenApiSchema>;
    readonly parameters?: Record<string, OpenApiParameter>;
    readonly requestBodies?: Record<string, OpenApiRequestBody>;
  };
}

export interface ExplorerOperation {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly scopes: readonly string[];
  readonly parameters: readonly OpenApiParameter[];
  readonly requestBody?: OpenApiRequestBody;
  readonly exampleBody: string;
  readonly isSse: boolean;
  readonly isDestructive: boolean;
}

function isRef(value: unknown): value is OpenApiRef {
  return Boolean(value && typeof value === "object" && "$ref" in value && typeof (value as OpenApiRef).$ref === "string");
}

function refName(ref: string): string | null {
  const match = /#\/components\/(schemas|parameters|requestBodies)\/([^/]+)$/.exec(ref);
  return match?.[2] ?? null;
}

export function resolveSchema(spec: OpenApiDocument, schema: OpenApiSchema | OpenApiRef | undefined): OpenApiSchema | undefined {
  if (!schema) return undefined;
  if (isRef(schema) || schema.$ref) {
    const name = refName(schema.$ref ?? (schema as OpenApiRef).$ref);
    if (!name) return undefined;
    return spec.components?.schemas?.[name];
  }
  return schema;
}

function resolveParameter(spec: OpenApiDocument, param: OpenApiParameter | OpenApiRef): OpenApiParameter | undefined {
  if (isRef(param) || param.$ref) {
    const name = refName(param.$ref ?? (param as OpenApiRef).$ref);
    if (!name) return undefined;
    return spec.components?.parameters?.[name];
  }
  return param;
}

function resolveRequestBody(spec: OpenApiDocument, body: OpenApiRequestBody | OpenApiRef | undefined): OpenApiRequestBody | undefined {
  if (!body) return undefined;
  if (isRef(body) || (body as OpenApiRef).$ref) {
    const name = refName((body as OpenApiRef).$ref);
    if (!name) return undefined;
    return spec.components?.requestBodies?.[name];
  }
  return body as OpenApiRequestBody;
}

function exampleFromSchema(spec: OpenApiDocument, schema: OpenApiSchema | OpenApiRef | undefined, depth = 0): unknown {
  if (!schema || depth > 4) return {};
  const resolved = resolveSchema(spec, schema);
  if (!resolved) return {};
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.enum && resolved.enum.length > 0) return resolved.enum[0];
  if (resolved.type === "array") {
    return [exampleFromSchema(spec, resolved.items, depth + 1)];
  }
  if (resolved.type === "object" || resolved.properties) {
    const out: Record<string, unknown> = {};
    const required = new Set(resolved.required ?? []);
    for (const [key, prop] of Object.entries(resolved.properties ?? {})) {
      if (required.size > 0 && !required.has(key)) continue;
      out[key] = exampleFromSchema(spec, prop, depth + 1);
    }
    return out;
  }
  if (resolved.type === "boolean") return false;
  if (resolved.type === "integer" || resolved.type === "number") return 0;
  if (resolved.format === "uuid") return "00000000-0000-0000-0000-000000000000";
  if (resolved.format === "date-time") return "2026-08-13T00:00:00.000Z";
  return "";
}

export function exampleBodyFor(spec: OpenApiDocument, body: OpenApiRequestBody | undefined): string {
  if (!body?.content) return "";
  const json = body.content["application/json"];
  if (!json) return "";
  if (json.example !== undefined) {
    return JSON.stringify(json.example, null, 2);
  }
  const example = exampleFromSchema(spec, json.schema);
  try {
    return JSON.stringify(example, null, 2);
  } catch {
    return "";
  }
}

export function apiRootFromSpec(spec: OpenApiDocument, fallbackBase: string): string {
  const first = spec.servers?.[0]?.url?.trim();
  if (first && /^https?:\/\//i.test(first)) {
    return first.replace(/\/$/, "");
  }
  return `${fallbackBase.replace(/\/$/, "")}/api/v1`;
}

export function listExplorerOperations(spec: OpenApiDocument): ExplorerOperation[] {
  const out: ExplorerOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const shared = (item.parameters ?? [])
      .map((p) => resolveParameter(spec, p))
      .filter((p): p is OpenApiParameter => Boolean(p));
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const parameters = [
        ...shared,
        ...(op.parameters ?? []).map((p) => resolveParameter(spec, p)).filter((p): p is OpenApiParameter => Boolean(p)),
      ];
      const requestBody = resolveRequestBody(spec, op.requestBody);
      const summary = op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`;
      const isSse =
        /stream/i.test(op.operationId ?? "") ||
        /sse|event-stream/i.test(op.summary ?? "") ||
        /\/stream$/.test(path);
      const isDestructive = method === "delete" || /deleteAll|bulk delete/i.test(op.operationId ?? summary);
      out.push({
        id: op.operationId ?? `${method}:${path}`,
        method,
        path,
        summary,
        description: op.description ?? "",
        tags: op.tags ?? ["Other"],
        scopes: op["x-qlix-scopes"] ?? [],
        parameters,
        requestBody,
        exampleBody: exampleBodyFor(spec, requestBody),
        isSse,
        isDestructive,
      });
    }
  }
  return out;
}

export function groupOperationsByTag(
  operations: readonly ExplorerOperation[],
  tagOrder: readonly string[],
): { tag: string; operations: ExplorerOperation[] }[] {
  const groups = new Map<string, ExplorerOperation[]>();
  for (const op of operations) {
    const tag = op.tags[0] ?? "Other";
    const list = groups.get(tag) ?? [];
    list.push(op);
    groups.set(tag, list);
  }
  const ordered: { tag: string; operations: ExplorerOperation[] }[] = [];
  const seen = new Set<string>();
  for (const tag of tagOrder) {
    const ops = groups.get(tag);
    if (!ops) continue;
    ordered.push({ tag, operations: ops });
    seen.add(tag);
  }
  for (const [tag, ops] of groups) {
    if (seen.has(tag)) continue;
    ordered.push({ tag, operations: ops });
  }
  return ordered;
}

export async function fetchDeveloperOpenApi(): Promise<OpenApiDocument> {
  const response = await fetch(`${developerApiBaseUrl()}/api/v1/openapi.json`, {
    credentials: "omit",
  });
  if (!response.ok) {
    throw new Error("Could not load OpenAPI specification");
  }
  return (await response.json()) as OpenApiDocument;
}
