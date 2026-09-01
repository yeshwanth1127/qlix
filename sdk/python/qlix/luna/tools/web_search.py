"""Web search tool — Tavily API with DuckDuckGo fallback."""

from __future__ import annotations

import logging
import os
from typing import Any

from qlix.luna.core.registry import ToolRegistry
from qlix.luna.core.types import ToolResult
from qlix.luna.security.ssrf import check_ssrf
from qlix.luna.security.safe_http import request_with_ssrf_protection
from qlix.luna.tools._stubs import BaseTool, ToolSpec

logger = logging.getLogger(__name__)


@ToolRegistry.register("web_search")
class WebSearchTool(BaseTool):
    """Search the web via Tavily API."""

    tool_id = "web_search"
    is_local = False

    def __init__(self, api_key: str | None = None, max_results: int = 5):
        self._api_key = api_key or os.environ.get("TAVILY_API_KEY")
        self._max_results = max_results

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="web_search",
            description=(
                "Search the web for current information."
                " Returns relevant search results."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query."},
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum results to return.",
                    },
                },
                "required": ["query"],
            },
            category="search",
            metadata={"requires_api_key": "TAVILY_API_KEY", "fallback": "duckduckgo"},
        )

    @staticmethod
    def _is_url(text: str) -> bool:
        """Check if text is a URL."""
        stripped = text.strip()
        return stripped.startswith("http://") or stripped.startswith("https://")

    @staticmethod
    def _extract_url(text: str) -> str | None:
        """Extract the first URL from text, if any."""
        import re as _re

        match = _re.search(r"https?://[^\s,;\"'<>]+", text)
        return match.group(0).rstrip(".,;)") if match else None

    @staticmethod
    def _normalize_url(url: str) -> str:
        """Convert known PDF URLs to their HTML equivalents."""
        import re as _re

        # arxiv: /pdf/ID → /abs/ID (abstract page with full metadata)
        m = _re.match(r"(https?://arxiv\.org)/pdf/(.+?)(?:\.pdf)?$", url)
        if m:
            return f"{m.group(1)}/abs/{m.group(2)}"
        return url

    @staticmethod
    def _fetch_url(url: str, max_chars: int = 6000) -> str:
        """Fetch a URL and return extracted text content."""
        import re as _re

        import httpx

        url = WebSearchTool._normalize_url(url)
        ssrf_error = check_ssrf(url)
        if ssrf_error:
            raise ValueError(ssrf_error)
        resp = request_with_ssrf_protection(
            "GET",
            url.strip(),
            timeout=30.0,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; Luna/1.0; +https://github.com/luna)"
            },
        )
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/pdf" in content_type:
            return (
                "[This URL points to a PDF file which"
                f" cannot be read directly. URL: {url}]"
            )
        html = resp.text
        # Strip script/style tags and their contents
        html = _re.sub(
            r"<(script|style)[^>]*>.*?</\1>",
            "",
            html,
            flags=_re.DOTALL | _re.IGNORECASE,
        )
        # Strip HTML tags
        text = _re.sub(r"<[^>]+>", " ", html)
        # Collapse whitespace
        text = _re.sub(r"\s+", " ", text).strip()
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n[Content truncated]"
        return text

    def _duckduckgo_search(self, query: str, max_results: int) -> str:
        """Search using DuckDuckGo as fallback."""
        from ddgs import DDGS

        ddgs = DDGS()
        results = list(ddgs.text(query, max_results=max_results))
        formatted = "\n\n".join(
            f"**{r.get('title', 'Untitled')}**\n"
            f"{r.get('href', '')}\n{r.get('body', '')}"
            for r in results
        )
        return formatted

    def execute(self, **params: Any) -> ToolResult:
        query = params.get("query", "")
        if not query:
            return ToolResult(
                tool_name="web_search",
                content="No query provided.",
                success=False,
            )

        # If the query contains a URL, fetch it directly instead of searching
        url = self._extract_url(query) if not self._is_url(query) else query.strip()
        if url:
            from qlix.research_providers import available_providers_for, log_shadow_route

            log_shadow_route(
                logger,
                "read",
                runtime="local",
                public_tool="web_search",
                legacy_providers=("direct_http",),
            )
            route = available_providers_for(
                "read", runtime="local", public_tool="web_search"
            )
            if not any(spec["id"] == "direct_http" for spec in route):
                return ToolResult(
                    tool_name="web_search",
                    content="Secure URL reader is unavailable in this installation.",
                    success=False,
                )
            try:
                content = self._fetch_url(url)
                return ToolResult(
                    tool_name="web_search",
                    content=content or "No content found at URL.",
                    success=True,
                    metadata={"url": url, "mode": "fetch"},
                )
            except Exception as exc:
                return ToolResult(
                    tool_name="web_search",
                    content=f"Failed to fetch URL: {exc}",
                    success=False,
                )

        max_results = params.get("max_results", self._max_results)
        from qlix.research_providers import available_providers_for, log_shadow_route

        log_shadow_route(
            logger,
            "search",
            runtime="local",
            public_tool="web_search",
            legacy_providers=("tavily", "duckduckgo"),
        )
        route = available_providers_for(
            "search", runtime="local", public_tool="web_search"
        )
        for provider in route:
            provider_id = str(provider["id"])
            try:
                if provider_id == "tavily":
                    from tavily import TavilyClient

                    response = TavilyClient(api_key=self._api_key).search(query, max_results=max_results)
                    results = response.get("results", [])
                    formatted = "\n\n".join(
                        f"**{r.get('title', 'Untitled')}**\n{r.get('url', '')}\n{r.get('content', '')}"
                        for r in results
                    )
                    return ToolResult("web_search", formatted or "No results found.", True,
                                      metadata={"num_results": len(results), "engine": provider_id})
                if provider_id == "duckduckgo":
                    formatted = self._duckduckgo_search(query, max_results)
                    return ToolResult("web_search", formatted or "No results found.", True,
                                      metadata={"engine": provider_id})
            except Exception as exc:
                logger.debug("Research provider %s failed (%s); trying next provider", provider_id, type(exc).__name__)

        try:
            # Preserve the legacy final fallback for installations whose optional
            # dependency probe cannot see a lazily installed DDGS package.
            formatted = self._duckduckgo_search(query, max_results)
            return ToolResult("web_search", formatted or "No results found.", True,
                              metadata={"engine": "duckduckgo"})
        except ImportError:
            return ToolResult(
                tool_name="web_search",
                content=(
                    "tavily-python not installed and ddgs not available."
                    " Install with: pip install tavily-python ddgs"
                ),
                success=False,
            )
        except Exception as exc:
            return ToolResult(
                tool_name="web_search",
                content=f"Search error: {exc}",
                success=False,
            )


__all__ = ["WebSearchTool"]
