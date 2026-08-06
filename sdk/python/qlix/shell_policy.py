"""Command-level shell policy for hybrid luna_local_bash (Hermes-inspired).

Safe read-only / inspect commands run without JIT.
Dangerous patterns require JIT (system.file_write approval).
Hard-deny patterns are blocked entirely.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

ShellDecision = Literal["allow", "approve", "deny"]


@dataclass(frozen=True)
class ShellPolicyResult:
    decision: ShellDecision
    reason: str


# Always blocked — no JIT override (agent must not run these).
_HARD_DENY: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"), "fork bomb"),
    (re.compile(r"\bmkfs\b", re.I), "format filesystem"),
    (re.compile(r">\s*/dev/sd", re.I), "write to block device"),
    (re.compile(r"\bdd\s+.*\bif=", re.I), "disk copy"),
    (re.compile(r"\bkill\s+-9\s+-1\b"), "kill all processes"),
    (
        re.compile(r"\b(curl|wget)\b.*\|\s*(?:ba)?sh\b", re.I),
        "pipe remote content to shell",
    ),
    (
        re.compile(r"\b(base64|base32)\s+(-d|--decode)\b.*\|\s*(?:ba)?sh\b", re.I),
        "pipe decoded content to shell",
    ),
]

# Needs user approval (JIT) when matched.
_DANGEROUS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\brm\s+(-[^\s]*\s+)*-[^\s]*r", re.I), "recursive delete"),
    (re.compile(r"\brm\s+--recursive\b", re.I), "recursive delete"),
    (re.compile(r"\brm\s+(-[^\s]*\s+)*/", re.I), "delete in root path"),
    (
        re.compile(r"\bcmd(?:\.exe)?\s+/(?:c|k)\s+.*\b(?:del|erase|rd|rmdir)\b", re.I),
        "Windows cmd destructive delete",
    ),
    (
        re.compile(
            r"\b(?:powershell|pwsh)(?:\.exe)?\b.*\b(?:Remove-Item|rmdir|erase|del|rd)\b",
            re.I,
        ),
        "PowerShell destructive delete",
    ),
    (re.compile(r"\bchmod\s+.*\b(777|666)\b"), "world-writable permissions"),
    (re.compile(r"\bchown\s+.*\broot\b", re.I), "chown to root"),
    (re.compile(r"\bDROP\s+(TABLE|DATABASE)\b", re.I), "SQL DROP"),
    (re.compile(r"\bDELETE\s+FROM\b(?![^\n]*\bWHERE\b)", re.I), "SQL DELETE without WHERE"),
    (re.compile(r"\bTRUNCATE\s+", re.I), "SQL TRUNCATE"),
    (re.compile(r"\bsystemctl\s+.*(stop|restart|disable|mask)\b", re.I), "systemctl stop/restart"),
    (re.compile(r"\bpkill\s+-9\b"), "force kill processes"),
    (re.compile(r"\bfind\b.*-delete\b", re.I), "find -delete"),
    (re.compile(r"\bfind\b.*-exec(?:dir)?\s+.*\brm\b", re.I), "find -exec rm"),
    (re.compile(r"\bxargs\s+.*\brm\b", re.I), "xargs with rm"),
    (re.compile(r"\bshutdown\b|\breboot\b|\bhalt\b", re.I), "shutdown/reboot"),
    (re.compile(r"\b(?:sudo|doas)\b", re.I), "privilege escalation"),
    (re.compile(r"\bcurl\b.*\|\s*iwr\b|\biwr\b.*\|\s*iex\b", re.I), "PowerShell remote exec"),
    (re.compile(r">>?\s*/etc/", re.I), "overwrite system config"),
    (re.compile(r"\btee\b.*/etc/", re.I), "overwrite system config via tee"),
]

# Clearly safe — skip JIT even though bash historically mapped to file_write.
_SAFE_PREFIXES = (
    "ls",
    "dir",
    "pwd",
    "whoami",
    "hostname",
    "uname",
    "date",
    "echo",
    "cat",
    "head",
    "tail",
    "wc",
    "file",
    "stat",
    "du",
    "df",
    "which",
    "type",
    "where",
    "where.exe",
    "get-childitem",
    "get-location",
    "get-content",
    "select-string",
    "get-process",
    "get-service",
    "git status",
    "git diff",
    "git log",
    "git show",
    "git branch",
    "git remote",
    "python --version",
    "python3 --version",
    "node --version",
    "npm --version",
    "pip show",
    "pip list",
)


def assess_shell_command(command: str) -> ShellPolicyResult:
    text = (command or "").strip()
    if not text:
        return ShellPolicyResult("deny", "empty command")

    for pat, reason in _HARD_DENY:
        if pat.search(text):
            return ShellPolicyResult("deny", reason)

    for pat, reason in _DANGEROUS:
        if pat.search(text):
            return ShellPolicyResult("approve", reason)

    low = text.lower().lstrip()
    # Strip common env assignments / sudo wrappers already caught above.
    for prefix in _SAFE_PREFIXES:
        if low == prefix or low.startswith(prefix + " ") or low.startswith(prefix + "\t"):
            return ShellPolicyResult("allow", f"safe command ({prefix})")

    # Default: require approval for unknown shell (Hermes smart/manual default).
    return ShellPolicyResult("approve", "unlisted shell command")
