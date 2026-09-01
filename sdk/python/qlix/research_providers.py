"""Provider-neutral contracts and deterministic routing for Qlix research.

This module initially describes and selects the existing providers only. Public
tools continue calling their legacy executors until shadow conformance is proven.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Mapping
from urllib.parse import urlparse


ResearchOperation = Literal["search", "read", "platform_search", "platform_research", "browser"]
ResearchRuntime = Literal["local", "cloud", "hybrid"]

_CATALOG_PATH = Path(__file__).resolve().parent / "data/research_provider_catalog.json"


@dataclass(frozen=True, slots=True)
class ResearchSource:
    url: str
    title: str = ""
    excerpt: str = ""
    published_at: str | None = None
    provider: str = ""
    retrieved_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass(frozen=True, slots=True)
class ResearchError:
    code: str
    message: str
    provider: str
    retryable: bool = False


@dataclass(frozen=True, slots=True)
class ResearchResult:
    operation: ResearchOperation
    provider: str
    ok: bool
    content: str = ""
    sources: tuple[ResearchSource, ...] = ()
    error: ResearchError | None = None
    partial: bool = False
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ProviderAvailability:
    provider: str
    available: bool
    missing: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ResearchStage:
    operation: ResearchOperation
    public_tool: str
    providers: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ResearchShadowReport:
    operation: ResearchOperation
    public_tool: str
    legacy_providers: tuple[str, ...]
    neutral_providers: tuple[str, ...]
    matches: bool


@lru_cache(maxsize=1)
def provider_catalog() -> dict[str, Any]:
    return json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))


def provider_specs() -> tuple[dict[str, Any], ...]:
    return tuple(provider_catalog()["providers"])


def provider_availability(spec: Mapping[str, Any]) -> ProviderAvailability:
    requirements = spec.get("requirements") if isinstance(spec.get("requirements"), Mapping) else {}
    missing: list[str] = []
    for key in requirements.get("env", []):
        if not os.environ.get(str(key), "").strip():
            missing.append(f"env:{key}")
    for group in requirements.get("envAnyGroups", []):
        alternatives = [str(key) for key in group]
        if alternatives and not any(os.environ.get(key, "").strip() for key in alternatives):
            missing.append(f"envAny:{'|'.join(alternatives)}")
    for module in requirements.get("python", []):
        if importlib.util.find_spec(str(module)) is None:
            missing.append(f"python:{module}")
    for binary in requirements.get("binary", []):
        if shutil.which(str(binary)) is None:
            missing.append(f"binary:{binary}")
    any_binaries = [str(binary) for binary in requirements.get("binaryAny", [])]
    if any_binaries and not any(shutil.which(binary) for binary in any_binaries):
        missing.append(f"binaryAny:{'|'.join(any_binaries)}")
    # Credential/session health is verified by provider calls; never expose secret values here.
    return ProviderAvailability(provider=str(spec["id"]), available=not missing, missing=tuple(missing))


def providers_for(
    operation: ResearchOperation,
    *,
    runtime: ResearchRuntime,
    public_tool: str,
    platform: str | None = None,
    include_browser_escalation: bool = False,
) -> tuple[dict[str, Any], ...]:
    """Return the existing route in stable priority order—never import/failure order."""
    matches: list[dict[str, Any]] = []
    for spec in provider_specs():
        tools = spec.get("publicTools") or []
        tool_match = public_tool in tools or any(
            isinstance(pattern, str) and pattern.endswith("*") and public_tool.startswith(pattern[:-1])
            for pattern in tools
        )
        if not tool_match or operation not in (spec.get("operations") or []):
            continue
        if runtime not in (spec.get("runtimes") or []):
            continue
        platforms = spec.get("platforms") or []
        if platforms and (platform is None or platform not in platforms):
            continue
        if spec.get("escalationOnly") and not include_browser_escalation:
            continue
        matches.append(spec)
    return tuple(sorted(matches, key=lambda item: (int(item.get("priority", 1000)), str(item["id"]))))


def available_providers_for(
    operation: ResearchOperation,
    *,
    runtime: ResearchRuntime,
    public_tool: str,
    platform: str | None = None,
    include_browser_escalation: bool = False,
) -> tuple[dict[str, Any], ...]:
    """Select the live provider route deterministically.

    Availability is evaluated before execution, rather than accidentally being
    determined by import order or the first exception.  Unavailable providers
    are skipped; their existing fallbacks remain available.
    """
    return tuple(
        spec for spec in providers_for(
            operation,
            runtime=runtime,
            public_tool=public_tool,
            platform=platform,
            include_browser_escalation=include_browser_escalation,
        )
        if provider_availability(spec).available
    )


def research_escalation_plan(
    *,
    runtime: ResearchRuntime,
    platform: str | None = None,
) -> tuple[ResearchStage, ...]:
    """Build the explicit search → read → browser ladder for an existing runtime."""
    search_tool = "web_search" if runtime == "local" else "research_web_search"
    read_tool = "web_search" if runtime == "local" else "research_read_url"
    browser_tool = "browser_navigate" if runtime == "local" else "browser"
    stages = [
        ResearchStage(
            operation="search",
            public_tool=search_tool,
            providers=tuple(spec["id"] for spec in providers_for("search", runtime=runtime, public_tool=search_tool)),
        ),
        ResearchStage(
            operation="read",
            public_tool=read_tool,
            providers=tuple(
                spec["id"]
                for spec in providers_for("read", runtime=runtime, public_tool=read_tool, platform=platform)
            ),
        ),
    ]
    browser = providers_for(
        "browser",
        runtime=runtime,
        public_tool=browser_tool,
        include_browser_escalation=True,
    )
    if browser:
        stages.append(
            ResearchStage(
                operation="browser",
                public_tool=browser_tool,
                providers=tuple(spec["id"] for spec in browser),
            )
        )
    return tuple(stages)


def compare_provider_route(
    operation: ResearchOperation,
    *,
    runtime: ResearchRuntime,
    public_tool: str,
    legacy_providers: tuple[str, ...],
    platform: str | None = None,
    include_browser_escalation: bool = False,
) -> ResearchShadowReport:
    neutral = tuple(
        str(spec["id"])
        for spec in providers_for(
            operation,
            runtime=runtime,
            public_tool=public_tool,
            platform=platform,
            include_browser_escalation=include_browser_escalation,
        )
    )
    return ResearchShadowReport(
        operation=operation,
        public_tool=public_tool,
        legacy_providers=legacy_providers,
        neutral_providers=neutral,
        matches=legacy_providers == neutral,
    )


def log_shadow_route(
    logger: logging.Logger,
    operation: ResearchOperation,
    *,
    runtime: ResearchRuntime,
    public_tool: str,
    legacy_providers: tuple[str, ...],
    platform: str | None = None,
) -> ResearchShadowReport | None:
    """Opt-in diagnostics only; never selects or executes a provider."""
    if os.environ.get("QLIX_RESEARCH_SHADOW", "").strip().lower() not in {"1", "true", "yes", "on"}:
        return None
    report = compare_provider_route(
        operation,
        runtime=runtime,
        public_tool=public_tool,
        legacy_providers=legacy_providers,
        platform=platform,
    )
    logger.info(
        "research_route_shadow operation=%s tool=%s legacy=%s neutral=%s matches=%s",
        report.operation,
        report.public_tool,
        list(report.legacy_providers),
        list(report.neutral_providers),
        report.matches,
    )
    return report


def normalize_sources(
    rows: Any,
    *,
    provider: str,
    retrieved_at: str | None = None,
) -> tuple[ResearchSource, ...]:
    """Normalize common provider result shapes and deduplicate by URL."""
    if not isinstance(rows, list):
        return ()
    timestamp = retrieved_at or datetime.now(timezone.utc).isoformat()
    sources: list[ResearchSource] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        url = next((str(row[key]).strip() for key in ("url", "href", "link") if row.get(key)), "")
        if not url or url in seen:
            continue
        seen.add(url)
        title = next((str(row[key]).strip() for key in ("title", "name") if row.get(key)), "")
        excerpt = next(
            (str(row[key]).strip() for key in ("excerpt", "content", "body", "description") if row.get(key)),
            "",
        )
        published_at = next(
            (str(row[key]).strip() for key in ("publishedAt", "published_at", "publicationTime", "date") if row.get(key)),
            None,
        )
        sources.append(
            ResearchSource(
                url=url,
                title=title,
                excerpt=excerpt,
                published_at=published_at,
                provider=provider,
                retrieved_at=timestamp,
            )
        )
    return tuple(sources)


def rank_sources(
    sources: tuple[ResearchSource, ...],
    *,
    prefer_authoritative: bool = False,
    official_domains: tuple[str, ...] = (),
) -> tuple[ResearchSource, ...]:
    """Prefer explicit official domains and public institutions, preserving ties."""
    if not prefer_authoritative:
        return sources
    normalized_domains = tuple(domain.lower().lstrip(".") for domain in official_domains if domain)

    def authority_rank(source: ResearchSource) -> int:
        host = (urlparse(source.url).hostname or "").lower().rstrip(".")
        if any(host == domain or host.endswith(f".{domain}") for domain in normalized_domains):
            return 0
        if host.endswith((".gov", ".gov.in", ".edu", ".ac.in")):
            return 1
        return 2

    return tuple(sorted(sources, key=authority_rank))


__all__ = [
    "ProviderAvailability",
    "ResearchError",
    "ResearchOperation",
    "ResearchResult",
    "ResearchStage",
    "ResearchShadowReport",
    "ResearchRuntime",
    "ResearchSource",
    "provider_availability",
    "provider_catalog",
    "provider_specs",
    "providers_for",
    "available_providers_for",
    "research_escalation_plan",
    "compare_provider_route",
    "log_shadow_route",
    "normalize_sources",
    "rank_sources",
]
