/**
 * Governance derivation for MCP tools: risk level, default governance, definition hashing,
 * and the `mcp.<slug>.<tool>` scope convention shared with the SDK runtime.
 */
import crypto from 'node:crypto';
import { canonicalize } from '../actions/canonical.js';
import type { DiscoveredTool, McpGovernance, McpRiskLevel } from './mcp.types.js';

/** Lowercase, url-safe slug (a-z0-9-), trimmed of leading/trailing dashes. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** The audit/scope action type for a tool call: `mcp.<slug>.<tool>`. */
export function scopeFor(slug: string, toolName: string): string {
  return `mcp.${slug}.${toolName}`;
}

/** The whole-server wildcard scope: `mcp.<slug>.*`. */
export function wildcardScopeFor(slug: string): string {
  return `mcp.${slug}.*`;
}

/**
 * Risk from MCP annotations (spec 2025-11-25):
 * - `readOnlyHint: true`  → low
 * - `destructiveHint: true` → high
 * - otherwise → medium (unknown side effects, treated cautiously)
 */
export function deriveRiskLevel(annotations: Record<string, unknown> | null | undefined): McpRiskLevel {
  if (annotations && typeof annotations === 'object') {
    if (annotations.readOnlyHint === true) return 'low';
    if (annotations.destructiveHint === true) return 'high';
  }
  return 'medium';
}

/**
 * Default governance — secure by default: only explicitly read-only tools auto-run;
 * everything else requires human JIT approval until an admin lowers it.
 */
export function deriveGovernance(risk: McpRiskLevel): McpGovernance {
  return risk === 'low' ? 'auto' : 'jit';
}

/** Stable hash over the parts of a tool definition that matter for tool-poisoning detection. */
export function computeDefinitionHash(tool: DiscoveredTool): string {
  const canonical = canonicalize({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? {},
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}
