"""Cloud runner: curated research tools (Agent Reach backends, no browser)."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import time
from typing import Any, Callable
from urllib.parse import urlparse

from . import research_sources
from .cloud_browser_runtime import smart_truncate_tool_result
from .identity import AgentIdentity
from .luna.security.ssrf import check_ssrf

logger = logging.getLogger(__name__)

RESEARCH_TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "research_web_search": ("web.research",),
    "research_read_url": ("web.research",),
    "research_social_search": ("web.research",),
    "research_video": ("web.research",),
    "research_github": ("web.research",),
}

RESEARCH_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "research_web_search": {
        "type": "function",
        "function": {
            "name": "research_web_search",
            "description": (
                "Semantic web search via Exa (Agent Reach). Use for broad research, "
                "comparisons, and finding articles — not for login or form submission."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query."},
                    "num_results": {
                        "type": "integer",
                        "description": "Number of results (1-10). Default 5.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    "research_read_url": {
        "type": "function",
        "function": {
            "name": "research_read_url",
            "description": (
                "Read a URL as clean text. Uses Jina Reader for generic pages; "
                "auto-routes Twitter/GitHub/YouTube/Bilibili URLs to platform CLIs when available."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Full https:// URL to read."},
                },
                "required": ["url"],
            },
        },
    },
    "research_social_search": {
        "type": "function",
        "function": {
            "name": "research_social_search",
            "description": (
                "Search a social platform (Twitter/X, Reddit, Xiaohongshu). "
                "Requires platform login/cookies configured on the runner for some platforms."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search keywords."},
                    "platform": {
                        "type": "string",
                        "enum": ["twitter", "reddit", "xiaohongshu"],
                        "description": "Target platform.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 10).",
                    },
                },
                "required": ["query", "platform"],
            },
        },
    },
    "research_video": {
        "type": "function",
        "function": {
            "name": "research_video",
            "description": (
                "Extract video metadata and subtitles from YouTube or Bilibili URLs "
                "via yt-dlp / bili-cli (Agent Reach)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "YouTube or Bilibili video URL."},
                },
                "required": ["url"],
            },
        },
    },
    "research_github": {
        "type": "function",
        "function": {
            "name": "research_github",
            "description": (
                "Search GitHub repos or read a repo (owner/name) via gh CLI."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query OR owner/repo for repo view.",
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["search", "repo"],
                        "description": "search = find repos; repo = view one repo. Default search.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max search results (default 5).",
                    },
                },
                "required": ["query"],
            },
        },
    },
}

_DOCTOR_CACHE: dict[str, Any] | None = None
_DOCTOR_CACHE_AT: float = 0.0
_DOCTOR_TTL_SEC = 300.0
_MAX_OUTPUT_CHARS = 80_000

PLATFORM_SESSION_USER_MESSAGE = (
    "Qlix's YouTube research session has expired. Video transcripts are temporarily "
    "unavailable — our team is refreshing access. Please try again later."
)

_PLATFORM_SESSION_MARKERS = (
    "confirm you're not a bot",
    "sign in to confirm",
    "cookies",
    "login required",
    "account has been disabled",
    "this video is unavailable",
)


def _youtube_cookies_path() -> str | None:
    path = os.environ.get("YT_DLP_COOKIES_FILE", "").strip()
    if path and os.path.isfile(path):
        return path
    return None


def _materialize_secret_file(secret: dict[str, Any]) -> None:
    """Make a read-only mounted credential usable by its CLI.

    Two shapes (see research_sources.json):
    - env_var + writable_copy: yt-dlp style. The CLI rewrites the file on exit, so
      copy the read-only mount to a writable path and repoint the env var.
    - install_path: copy the read-only mount to the fixed path the CLI reads from
      (e.g. rdt-cli's ~/.config/rdt-cli/credential.json), creating parent dirs.
    """
    container_path = str(secret.get("container_path") or "").strip()
    env_var = str(secret.get("env_var") or "").strip()
    src = os.environ.get(env_var, "").strip() if env_var else container_path
    if not src or not os.path.isfile(src):
        return

    writable_copy = str(secret.get("writable_copy") or "").strip()
    install_path = str(secret.get("install_path") or "").strip()

    if writable_copy:
        if os.access(src, os.W_OK):
            return  # already writable; env var (if any) already points at it
        try:
            shutil.copy2(src, writable_copy)
            if env_var:
                os.environ[env_var] = writable_copy
        except OSError as exc:
            logger.warning("Failed to copy secret to %s: %s", writable_copy, exc)
        return

    if install_path and os.path.abspath(install_path) != os.path.abspath(src):
        try:
            os.makedirs(os.path.dirname(install_path), exist_ok=True)
            shutil.copy2(src, install_path)
        except OSError as exc:
            logger.warning("Failed to install secret to %s: %s", install_path, exc)


def _yt_dlp_argv(args: list[str]) -> list[str]:
    if not args:
        return args
    out = list(args)
    cookies = _youtube_cookies_path()
    if cookies:
        out = [out[0], "--cookies", cookies, *out[1:]]
    if out[0] == "yt-dlp" and "--remote-components" not in out:
        out = [out[0], "--remote-components", "ejs:github", *out[1:]]
    return out


def _is_platform_session_error(raw: str) -> bool:
    low = raw.lower()
    return any(marker in low for marker in _PLATFORM_SESSION_MARKERS)


def _blocked_payload(
    hint: str,
    *,
    user_message: str | None = None,
    code: str | None = None,
) -> str:
    payload: dict[str, str] = {"status": "blocked", "hint": hint}
    if user_message:
        payload["user_message"] = user_message
    if code:
        payload["code"] = code
    return json.dumps(payload, ensure_ascii=False)


def _platform_session_blocked(technical_hint: str) -> str:
    return _blocked_payload(
        technical_hint[:800],
        user_message=PLATFORM_SESSION_USER_MESSAGE,
        code="platform_session_expired",
    )


def parse_research_tool_result(tool_output: str) -> tuple[bool, str | None]:
    """Return (ok, user-facing error) for research tool activity events."""
    if not isinstance(tool_output, str):
        return True, None
    if tool_output.startswith("[failed] "):
        return False, tool_output[len("[failed] ") :].strip()[:500]
    try:
        data = json.loads(tool_output)
    except json.JSONDecodeError:
        return True, None
    if not isinstance(data, dict) or data.get("status") != "blocked":
        return True, None
    user_message = str(data.get("user_message") or "").strip()
    hint = str(data.get("hint") or "Research blocked").strip()
    if data.get("code") == "platform_session_expired" and user_message:
        return False, user_message
    return False, user_message or hint[:500]


_URL_RE = re.compile(r"https?://[^\s\"'<>)\]}]+")
_URL_TRAIL_RE = re.compile(r"[.,;:!?]+$")


def _clean_url(raw: str) -> str:
    return _URL_TRAIL_RE.sub("", str(raw).strip().strip("\"'<>()[]{}"))


def _hostname(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
    except ValueError:
        return url
    return host[4:] if host.startswith("www.") else host


def _arg_str(args: str, key: str) -> str:
    try:
        params = json.loads(args) if args and args.strip() else {}
    except (json.JSONDecodeError, TypeError):
        return ""
    if not isinstance(params, dict):
        return ""
    return str(params.get(key, "")).strip()


def _arg_url(args: str) -> str | None:
    url = _arg_str(args, "url")
    return url if url.startswith(("http://", "https://")) else None


def _jina_title(output: str) -> str:
    """Jina Reader output starts with a `Title:` line; pull it if present."""
    for line in (output or "").splitlines()[:5]:
        s = line.strip()
        if s.lower().startswith("title:"):
            return s.split(":", 1)[1].strip()[:200]
    return ""


def _github_repo_from_query(args: str) -> str | None:
    q = _arg_str(args, "query")
    if not q:
        return None
    q = q.removeprefix("https://github.com/").strip("/")
    m = re.match(r"^([\w.-]+/[\w.-]+)", q)
    return m.group(1) if m else None


def _sources_from_json(node: Any, found: list[dict[str, str]] | None = None) -> list[dict[str, str]]:
    """Walk arbitrary nested JSON (Exa / gh shapes) collecting {url,title} pairs."""
    if found is None:
        found = []
    if isinstance(node, dict):
        url = node.get("url") or node.get("link") or node.get("href")
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            title = (
                node.get("title")
                or node.get("name")
                or node.get("full_name")
                or node.get("text")
                or ""
            )
            found.append({"url": url, "title": str(title)[:200]})
        for v in node.values():
            _sources_from_json(v, found)
    elif isinstance(node, list):
        for v in node:
            _sources_from_json(v, found)
    return found


def _dedupe_sources(rows: list[dict[str, str]], *, limit: int = 8) -> list[dict[str, str]]:
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for row in rows:
        url = _clean_url(str(row.get("url", "")))
        if not url.startswith(("http://", "https://")) or url in seen:
            continue
        seen.add(url)
        title = str(row.get("title", "")).strip()
        out.append({"url": url, "title": title or _hostname(url)})
        if len(out) >= limit:
            break
    return out


def extract_research_sources(tool_name: str, args: str, output: str) -> list[dict[str, str]]:
    """Best-effort source URLs (+titles) a research tool drew its data from.

    Returns [] for failed/blocked results or when no URL is present. Safe to call
    with any tool name; only research_* tools are handled here.
    """
    if not isinstance(output, str):
        return []
    ok, _ = parse_research_tool_result(output)
    if not ok:
        return []

    if tool_name in ("research_read_url", "research_video"):
        url = _arg_url(args)
        if not url:
            return []
        title = _jina_title(output) if tool_name == "research_read_url" else ""
        return [{"url": _clean_url(url), "title": title or _hostname(url)}]

    if tool_name == "research_github":
        rows: list[dict[str, str]] = []
        try:
            rows = _sources_from_json(json.loads(output))
        except json.JSONDecodeError:
            pass
        if not rows:
            repo = _github_repo_from_query(args)
            if repo:
                rows = [{"url": f"https://github.com/{repo}", "title": repo}]
        return _dedupe_sources(rows)

    if tool_name in ("research_web_search", "research_social_search"):
        rows = []
        try:
            rows = _sources_from_json(json.loads(output))
        except json.JSONDecodeError:
            pass
        if not rows:
            rows = [{"url": m, "title": ""} for m in _URL_RE.findall(output)]
        return _dedupe_sources(rows)

    return []


def _effective_granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def _subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    proxy = os.environ.get("AGENT_REACH_PROXY", "").strip()
    if proxy:
        env["HTTP_PROXY"] = proxy
        env["HTTPS_PROXY"] = proxy
    return env


def _run_cmd(
    argv: list[str],
    *,
    timeout: int = 90,
) -> tuple[bool, str]:
    """Run a read-only CLI; return (ok, combined output)."""
    if not argv or not argv[0]:
        return False, "Empty command"
    if shutil.which(argv[0]) is None:
        return False, f"Command not found on PATH: {argv[0]}"
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=_subprocess_env(),
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"Command timed out after {timeout}s: {' '.join(argv[:4])}"
    except OSError as exc:
        return False, f"Failed to run {' '.join(argv[:4])}: {exc}"

    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    combined = out if out else err
    if not combined and err:
        combined = err
    if proc.returncode != 0:
        hint = combined or f"exit {proc.returncode}"
        return False, f"[blocked] {hint}"
    return True, combined


def refresh_doctor_cache() -> dict[str, Any]:
    """Refresh Agent Reach channel health via `agent-reach doctor --json`."""
    global _DOCTOR_CACHE, _DOCTOR_CACHE_AT
    if shutil.which("agent-reach") is None:
        _DOCTOR_CACHE = {}
        _DOCTOR_CACHE_AT = time.time()
        return _DOCTOR_CACHE
    ok, raw = _run_cmd(["agent-reach", "doctor", "--json"], timeout=60)
    if not ok:
        logger.warning("agent-reach doctor failed: %s", raw[:500])
        _DOCTOR_CACHE = {}
    else:
        try:
            _DOCTOR_CACHE = json.loads(raw)
        except json.JSONDecodeError:
            _DOCTOR_CACHE = {}
    _DOCTOR_CACHE_AT = time.time()
    return _DOCTOR_CACHE


def get_doctor_cache() -> dict[str, Any]:
    global _DOCTOR_CACHE_AT
    if _DOCTOR_CACHE is None or (time.time() - _DOCTOR_CACHE_AT) > _DOCTOR_TTL_SEC:
        return refresh_doctor_cache()
    return _DOCTOR_CACHE or {}


def _run_configure_block(block: dict[str, Any]) -> None:
    """Run one registry configure command (e.g. `agent-reach configure …`)."""
    requires_bin = str(block.get("requires_bin") or "").strip()
    if requires_bin and shutil.which(requires_bin) is None:
        return
    required_env = [str(k) for k in (block.get("requires_env") or [])]
    env_map = {k: os.environ.get(k, "").strip() for k in required_env}
    if any(not env_map[k] for k in required_env):
        return
    argv = research_sources.render_command(
        [str(t) for t in (block.get("command") or [])], env_map
    )
    if argv:
        _run_cmd(argv, timeout=30)


def ensure_research_stack() -> None:
    """Ensure core research CLIs (mcporter/Exa) exist; install when agent-reach is present."""
    if shutil.which("mcporter"):
        return
    if shutil.which("agent-reach") is None:
        logger.warning("research stack incomplete: agent-reach and mcporter missing")
        return
    ok, out = _run_cmd(["agent-reach", "install", "--env=server"], timeout=180)
    if not ok:
        logger.warning("agent-reach core install failed: %s", out[:500])
    elif not shutil.which("mcporter"):
        logger.warning("agent-reach install finished but mcporter still missing")


def configure_research_sources() -> None:
    """Apply platform research credentials to runner CLIs (registry-driven).

    Drives credential injection from research_sources.json so adding a source is
    a one-line registry change. For each source: materialize its mounted secret
    file, then run any configure commands; finally run global configure blocks
    (e.g. proxy) and refresh the Agent Reach doctor cache.
    """
    ensure_research_stack()
    for src in research_sources.SOURCES:
        secret = src.get("secret_file")
        if isinstance(secret, dict):
            _materialize_secret_file(secret)

    configure_blocks: list[dict[str, Any]] = list(research_sources.GLOBAL_CONFIGURE)
    for src in research_sources.SOURCES:
        configure_blocks.extend(src.get("configure") or [])
    for block in configure_blocks:
        _run_configure_block(block)

    cookies_path = os.environ.get("YT_DLP_COOKIES_FILE", "").strip()
    if cookies_path and not os.path.isfile(cookies_path):
        logger.warning("YT_DLP_COOKIES_FILE set but missing: %s", cookies_path)
    refresh_doctor_cache()


# Backwards-compatible alias for existing callers/imports.
configure_agent_reach_from_env = configure_research_sources


def _truncate(tool_id: str, text: str) -> str:
    out, _ = smart_truncate_tool_result(tool_id, text)
    if len(out) > _MAX_OUTPUT_CHARS:
        out = out[:_MAX_OUTPUT_CHARS] + f"\n\n[truncated from {len(text)} chars]"
    return out


def _detect_url_platform(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if "twitter.com" in host or "x.com" in host:
        return "twitter"
    if "github.com" in host:
        return "github"
    if "youtube.com" in host or "youtu.be" in host:
        return "youtube"
    if "bilibili.com" in host or "b23.tv" in host:
        return "bilibili"
    return "generic"


def _youtube_video_id(url: str) -> str | None:
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{6,})", url)
    return m.group(1) if m else None


def _jina_read_url(url: str) -> tuple[bool, str]:
    ssrf_error = check_ssrf(url)
    if ssrf_error:
        return False, f"SSRF protection blocked URL: {ssrf_error}"
    if shutil.which("curl") is None:
        return False, "curl not available"
    return _run_cmd(["curl", "-sL", f"https://r.jina.ai/{url}"], timeout=90)


def _exa_search(query: str, num: int = 3) -> tuple[bool, str]:
    if shutil.which("mcporter") is None:
        return False, "mcporter not available"
    return _run_cmd(
        [
            "mcporter",
            "call",
            f"exa.web_search_exa(query: {json.dumps(query)}, numResults: {num})",
        ],
        timeout=90,
    )

def execute_research_web_search(params: dict[str, Any]) -> str:
    query = str(params.get("query", "")).strip()
    if not query:
        return "[failed] query is required"
    num = int(params.get("num_results") or 5)
    num = max(1, min(10, num))
    from .research_providers import available_providers_for, log_shadow_route

    log_shadow_route(logger, "search", runtime="cloud", public_tool="research_web_search", legacy_providers=("exa_agent_reach",))
    route = available_providers_for(
        "search", runtime="cloud", public_tool="research_web_search"
    )
    if any(spec["id"] == "exa_agent_reach" for spec in route):
        ok, out = _run_cmd(
            [
                "mcporter",
                "call",
                f"exa.web_search_exa(query: {json.dumps(query)}, numResults: {num})",
            ],
            timeout=90,
        )
        if ok:
            return _truncate("research_web_search", out)
        return _blocked_payload(out)
    return _blocked_payload(
        "Exa search unavailable (mcporter not installed). Run agent-reach install on the runner."
    )


def execute_research_read_url(params: dict[str, Any]) -> str:
    url = str(params.get("url", "")).strip()
    if not url.startswith(("http://", "https://")):
        return "[failed] url must start with http:// or https://"
    ssrf_error = check_ssrf(url)
    if ssrf_error:
        return f"[failed] SSRF protection blocked URL: {ssrf_error}"

    platform = _detect_url_platform(url)
    from .research_providers import available_providers_for, log_shadow_route

    legacy_read = {
        "twitter": ("twitter_cli", "jina_reader"),
        "github": ("github_cli", "jina_reader"),
        "youtube": ("youtube_ytdlp", "jina_reader"),
        "bilibili": ("bilibili_cli", "jina_reader"),
        "generic": ("jina_reader",),
    }[platform]
    log_shadow_route(
        logger,
        "read",
        runtime="cloud",
        public_tool="research_read_url",
        legacy_providers=legacy_read,
        platform=None if platform == "generic" else platform,
    )
    route = {
        str(spec["id"])
        for spec in available_providers_for(
            "read",
            runtime="cloud",
            public_tool="research_read_url",
            platform=None if platform == "generic" else platform,
        )
    }
    if platform == "twitter" and "twitter_cli" in route:
        ok, out = _run_cmd(["twitter", "tweet", url], timeout=60)
        if ok:
            return _truncate("research_read_url", out)
    if platform == "github" and "github_cli" in route:
        m = re.search(r"github\.com/([^/]+/[^/#?]+)", url)
        if m:
            ok, out = _run_cmd(["gh", "repo", "view", m.group(1), "--json", "name,description,url"], timeout=60)
            if ok:
                return _truncate("research_read_url", out)
    if platform == "youtube" and "youtube_ytdlp" in route:
        ok, out = _run_cmd(
            _yt_dlp_argv(["yt-dlp", "--dump-json", "--skip-download", url]),
            timeout=120,
        )
        if ok:
            return _truncate("research_read_url", out)
        if _is_platform_session_error(out):
            return _platform_session_blocked(out)
    if platform == "bilibili" and "bilibili_cli" in route:
        ok, out = _run_cmd(["bili", "video", url], timeout=90)
        if ok:
            return _truncate("research_read_url", out)

    if "jina_reader" in route:
        ok, out = _run_cmd(["curl", "-sL", f"https://r.jina.ai/{url}"], timeout=90)
        if ok:
            return _truncate("research_read_url", out)
        return _blocked_payload(out)
    return _blocked_payload("No reader available (curl/Jina).")


def execute_research_social_search(params: dict[str, Any]) -> str:
    query = str(params.get("query", "")).strip()
    platform = str(params.get("platform", "")).strip().lower()
    limit = int(params.get("limit") or 10)
    limit = max(1, min(25, limit))
    if not query or not platform:
        return "[failed] query and platform are required"
    from .research_providers import available_providers_for, log_shadow_route

    provider_id = {"twitter": "twitter_cli", "reddit": "reddit_cli", "xiaohongshu": "xiaohongshu_cli"}.get(platform)
    if provider_id:
        log_shadow_route(
            logger,
            "platform_search",
            runtime="cloud",
            public_tool="research_social_search",
            legacy_providers=(provider_id,),
            platform=platform,
        )

    route = {
        str(spec["id"])
        for spec in available_providers_for(
            "platform_search",
            runtime="cloud",
            public_tool="research_social_search",
            platform=platform,
        )
    }

    source = research_sources.SOURCES_BY_ID.get(platform)
    attempts = (source or {}).get("search") or []
    if not source or not attempts:
        return f"[failed] Unknown platform: {platform}"

    found_any = False
    for attempt in attempts:
        bin_name = str(attempt.get("bin") or "").strip()
        template = [str(t) for t in (attempt.get("command") or [])]
        if provider_id not in route or not bin_name or not template or shutil.which(bin_name) is None:
            continue
        found_any = True
        argv = research_sources.render_search(template, query=query, limit=limit)
        ok, out = _run_cmd(argv, timeout=90)
        if ok:
            return _truncate("research_social_search", out)

    # Blocked/unauthenticated platform (expired or missing shared session). Fail silently:
    # log the ops detail, but hand the model a plain browser-fallback instruction instead of
    # a hard error. Returning a non-"[failed]"/non-blocked string makes this a soft success,
    # so the user never sees the ops jargon and the run continues via the browser tools.
    hint_key = "auth_failed_hint" if found_any else "blocked_hint"
    hint = source.get(hint_key) or source.get("blocked_hint") or f"{platform} unavailable."
    logger.info("research_social_search: %s unavailable (%s)", platform, hint)
    return (
        f"[unavailable] The {platform} research API is not reachable right now. "
        f"Do not report this as an error and do not retry {platform}. Instead, gather the "
        f"same information from the open web using the browser tools (browser_ab_open on "
        f"{platform}.com or the competitor's own site) and web search, then continue."
    )


def execute_research_video(params: dict[str, Any]) -> str:
    url = str(params.get("url", "")).strip()
    if not url.startswith(("http://", "https://")):
        return "[failed] url is required"
    ssrf_error = check_ssrf(url)
    if ssrf_error:
        return f"[failed] SSRF protection blocked URL: {ssrf_error}"
    platform = _detect_url_platform(url)
    from .research_providers import available_providers_for, log_shadow_route

    video_provider = {"youtube": "youtube_ytdlp", "bilibili": "bilibili_cli"}.get(platform)
    if video_provider:
        log_shadow_route(
            logger,
            "platform_research",
            runtime="cloud",
            public_tool="research_video",
            legacy_providers=(video_provider,),
            platform=platform,
        )

    route = {
        str(spec["id"])
        for spec in available_providers_for(
            "platform_research",
            runtime="cloud",
            public_tool="research_video",
            platform=platform,
        )
    }

    if platform == "youtube":
        if "youtube_ytdlp" not in route:
            return _blocked_payload(
                "yt-dlp not installed on runner.",
                user_message=(
                    "Video research is temporarily unavailable on this runner. "
                    "Please try again later."
                ),
                code="runner_not_configured",
            )

        ok, meta = _run_cmd(
            _yt_dlp_argv(["yt-dlp", "--dump-json", "--skip-download", url]),
            timeout=120,
        )
        if ok:
            ok2, subs = _run_cmd(
                _yt_dlp_argv(
                    [
                        "yt-dlp",
                        "--write-sub",
                        "--write-auto-sub",
                        "--skip-download",
                        "--sub-lang",
                        "en",
                        "-o",
                        "/tmp/%(id)s",
                        url,
                    ]
                ),
                timeout=120,
            )
            body = meta
            if ok2 and subs:
                body = f"{meta}\n\n--- subtitles ---\n{subs}"
            return _truncate("research_video", body)

        if _is_platform_session_error(meta):
            return _platform_session_blocked(meta)

        # Silent fallbacks before a generic failure.
        ok_jina, jina = _jina_read_url(url)
        if ok_jina and jina.strip():
            return _truncate(
                "research_video",
                f"[partial — transcript unavailable]\n\n{jina}",
            )

        vid = _youtube_video_id(url)
        if vid:
            ok_exa, exa = _exa_search(f"youtube video {vid} summary transcript", num=3)
            if ok_exa and exa.strip():
                return _truncate(
                    "research_video",
                    f"[partial — from web search, not full transcript]\n\n{exa}",
                )

        if _youtube_cookies_path() is None:
            return _blocked_payload(
                meta,
                user_message=(
                    "Qlix video research is not fully configured yet. "
                    "Transcripts will be available once platform access is enabled."
                ),
                code="platform_not_configured",
            )
        return _platform_session_blocked(meta)

    if platform == "bilibili" and "bilibili_cli" in route:
        ok, out = _run_cmd(["bili", "video", url], timeout=90)
        if ok:
            return _truncate("research_video", out)
        return _blocked_payload(out)

    return _blocked_payload("URL is not a supported YouTube/Bilibili video.")


def execute_research_github(params: dict[str, Any]) -> str:
    query = str(params.get("query", "")).strip()
    if not query:
        return "[failed] query is required"
    from .research_providers import available_providers_for, log_shadow_route

    log_shadow_route(
        logger,
        "platform_research",
        runtime="cloud",
        public_tool="research_github",
        legacy_providers=("github_cli",),
        platform="github",
    )
    route = available_providers_for(
        "platform_research",
        runtime="cloud",
        public_tool="research_github",
        platform="github",
    )
    if not any(spec["id"] == "github_cli" for spec in route):
        return _blocked_payload("gh CLI not installed on runner.")

    mode = str(params.get("mode") or "").strip().lower()
    if mode == "repo" or ("/" in query and " " not in query):
        repo = query.strip().strip("/")
        if repo.startswith("https://github.com/"):
            repo = repo.split("github.com/", 1)[-1].split("/")[:2]
            repo = "/".join(repo)
        ok, out = _run_cmd(["gh", "repo", "view", repo], timeout=60)
        if ok:
            return _truncate("research_github", out)
        return _blocked_payload(out)

    limit = int(params.get("limit") or 5)
    limit = max(1, min(20, limit))
    ok, out = _run_cmd(
        ["gh", "search", "repos", query, "--limit", str(limit), "--json", "name,description,url,stargazerCount"],
        timeout=90,
    )
    if ok:
        return _truncate("research_github", out)
    return _blocked_payload(out)


_RESEARCH_EXECUTORS: dict[str, Callable[[dict[str, Any]], str]] = {
    "research_web_search": execute_research_web_search,
    "research_read_url": execute_research_read_url,
    "research_social_search": execute_research_social_search,
    "research_video": execute_research_video,
    "research_github": execute_research_github,
}


def openai_research_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    """OpenAI tool defs for research tools allowed by scopes + skill filter."""
    granted = _effective_granted_scopes(identity)
    tool_ids = list(RESEARCH_TOOL_SCOPES.keys())

    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            tool_ids = [t for t in tool_ids if any(s in filt for s in RESEARCH_TOOL_SCOPES.get(t, ()))]
        else:
            tool_ids = [t for t in tool_ids if t in filt]

    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        req = RESEARCH_TOOL_SCOPES.get(tid, ())
        if any(s not in granted for s in req):
            continue
        defn = RESEARCH_TOOL_DEFINITIONS.get(tid)
        if defn:
            out.append(defn)
    return out


def build_research_tool_executors(
    *,
    identity: AgentIdentity,
    skill_filter: list[str] | None = None,
    qlix_sdk: Any = None,
) -> dict[str, Any]:
    """Async executors for research tools, optionally wrapped in Qlix audit lifecycle."""
    defs = openai_research_tool_definitions(identity, skill_filter)
    offered = {d["function"]["name"] for d in defs}
    executors: dict[str, Any] = {}

    for tid in offered:
        fn = _RESEARCH_EXECUTORS.get(tid)
        if fn is None:
            continue

        def _make(tool_id: str, execute_fn: Callable[[dict[str, Any]], str]):
            async def _execute(args_json: str) -> str:
                try:
                    params = json.loads(args_json) if args_json and args_json.strip() else {}
                except json.JSONDecodeError:
                    params = {}
                if not isinstance(params, dict):
                    params = {}

                async def _run() -> str:
                    return execute_fn(params)

                if qlix_sdk is not None and identity.has_scope("web.research"):
                    try:
                        result = await qlix_sdk.run(
                            "web.research",
                            {"tool": tool_id, **params},
                            _run,
                            risk_level="low",
                        )
                        return str(result)
                    except Exception as exc:  # noqa: BLE001
                        return f"[failed] web.research audit: {exc}"
                return await _run()

            return _execute

        executors[tid] = _make(tid, fn)

    return executors
