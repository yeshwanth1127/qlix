/**
 * Local secret redaction — applied before anything leaves the machine. Filename
 * denylist mirrors sdk/python/qlix/luna/security/file_policy.py's
 * DEFAULT_SENSITIVE_PATTERNS exactly, so "what Qlix considers sensitive" stays
 * one policy repeated in two runtimes rather than two separate opinions.
 */

const SENSITIVE_FILENAME_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/,
  /\.env$/,
  /^\.secret$/,
  /\.secrets$/,
  /^credentials\..+/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.jks$/,
  /^id_rsa$/,
  /^id_ed25519$/,
  /^\.htpasswd$/,
  /^\.pgpass$/,
  /^\.netrc$/,
];

/** True when this file's path/name should never have its content captured — the
 * file's existence may still be noted (e.g. "a .env file changed"), never its bytes. */
export function isSensitivePath(relativePath: string): boolean {
  const name = relativePath.split(/[\\/]/).pop() ?? relativePath;
  return SENSITIVE_FILENAME_PATTERNS.some((pattern) => pattern.test(name));
}

// Content-level scanning for secrets that show up inside otherwise-ordinary files
// (e.g. a hardcoded key pasted into a .ts file). Intentionally conservative —
// false positives just redact a bit more text, false negatives leak a secret.
const SECRET_CONTENT_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bsk-[A-Za-z0-9]{20,}\b/g, // OpenAI-style secret key
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"']{6,}["']?/gi,
];

export function redactSecrets(text: string): { text: string; redactionApplied: boolean } {
  let redactionApplied = false;
  let result = text;
  for (const pattern of SECRET_CONTENT_PATTERNS) {
    if (pattern.test(result)) {
      redactionApplied = true;
      result = result.replace(pattern, '[REDACTED]');
    }
  }
  return { text: result, redactionApplied };
}
