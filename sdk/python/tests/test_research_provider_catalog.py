from __future__ import annotations

import unittest
from unittest.mock import patch
import json
from pathlib import Path

from qlix.research_providers import (
    normalize_sources,
    provider_availability,
    provider_specs,
    providers_for,
    research_escalation_plan,
    rank_sources,
    compare_provider_route,
    log_shadow_route,
)


class ResearchProviderCatalogTests(unittest.TestCase):
    def test_catalog_preserves_every_existing_provider_family(self) -> None:
        ids = {spec["id"] for spec in provider_specs()}
        self.assertTrue(
            {
                "tavily", "duckduckgo", "direct_http", "exa_agent_reach", "jina_reader",
                "twitter_cli", "reddit_cli", "xiaohongshu_cli", "youtube_ytdlp",
                "bilibili_cli", "github_cli", "agent_browser", "cloudflare_browser_run",
                "luna_browser", "generic_remote_cdp", "browserbase",
            }.issubset(ids)
        )

    def test_legacy_public_surfaces_keep_deterministic_provider_order(self) -> None:
        self.assertEqual(
            [spec["id"] for spec in providers_for("search", runtime="local", public_tool="web_search")],
            ["tavily", "duckduckgo"],
        )
        self.assertEqual(
            [spec["id"] for spec in providers_for("search", runtime="cloud", public_tool="research_web_search")],
            ["exa_agent_reach"],
        )
        self.assertEqual(
            [spec["id"] for spec in providers_for("read", runtime="cloud", public_tool="research_read_url", platform="github")],
            ["github_cli", "jina_reader"],
        )

    def test_browser_is_only_selected_when_escalation_is_explicit(self) -> None:
        self.assertEqual(providers_for("browser", runtime="cloud", public_tool="browser"), ())
        self.assertEqual(
            [spec["id"] for spec in providers_for("browser", runtime="cloud", public_tool="browser", include_browser_escalation=True)],
            ["generic_remote_cdp", "browserbase", "agent_browser", "cloudflare_browser_run"],
        )

    def test_availability_reports_missing_requirements_without_secrets(self) -> None:
        tavily = next(spec for spec in provider_specs() if spec["id"] == "tavily")
        with patch.dict("os.environ", {}, clear=True), patch("importlib.util.find_spec", return_value=None):
            availability = provider_availability(tavily)
        self.assertFalse(availability.available)
        self.assertIn("env:TAVILY_API_KEY", availability.missing)
        self.assertIn("python:tavily", availability.missing)

    def test_escalation_plan_is_search_then_read_then_browser(self) -> None:
        cloud = research_escalation_plan(runtime="cloud")
        self.assertEqual([stage.operation for stage in cloud], ["search", "read", "browser"])
        self.assertEqual(cloud[0].providers, ("exa_agent_reach",))
        self.assertEqual(cloud[1].providers, ("jina_reader",))
        hybrid = research_escalation_plan(runtime="hybrid")
        self.assertEqual([stage.operation for stage in hybrid], ["search", "read"])

    def test_sources_are_normalized_and_deduplicated(self) -> None:
        sources = normalize_sources(
            [
                {"href": "https://example.com/a", "title": "A", "body": "first", "date": "2026-08-01"},
                {"url": "https://example.com/a", "title": "duplicate"},
                {"link": "https://example.com/b", "name": "B", "content": "second"},
            ],
            provider="test",
            retrieved_at="2026-08-23T10:00:00Z",
        )
        self.assertEqual([source.url for source in sources], ["https://example.com/a", "https://example.com/b"])
        self.assertEqual(sources[0].published_at, "2026-08-01")
        self.assertEqual(sources[1].provider, "test")

    def test_official_source_preference_is_explicit_and_stable(self) -> None:
        sources = normalize_sources(
            [
                {"url": "https://blog.example.net/post", "title": "Commentary"},
                {"url": "https://docs.vendor.com/release", "title": "Official"},
                {"url": "https://agency.gov/report", "title": "Government"},
            ],
            provider="test",
        )
        self.assertEqual(rank_sources(sources), sources)
        ranked = rank_sources(sources, prefer_authoritative=True, official_domains=("vendor.com",))
        self.assertEqual([source.title for source in ranked], ["Official", "Government", "Commentary"])

    def test_every_provider_route_has_a_keyless_replay_fixture(self) -> None:
        fixture_path = Path(__file__).resolve().parents[1] / "qlix/data/research_provider_replay.v1.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        seen: set[str] = set()
        for case in fixture["cases"]:
            report = compare_provider_route(
                case["operation"],
                runtime=case["runtime"],
                public_tool=case["publicTool"],
                platform=case.get("platform"),
                include_browser_escalation=case.get("includeBrowserEscalation", False),
                legacy_providers=tuple(case["providers"]),
            )
            self.assertTrue(report.matches, case["id"])
            seen.update(case["providers"])
            seen.update(case.get("fallbacks", []))
        self.assertEqual(seen, {spec["id"] for spec in provider_specs()})

    def test_shadow_mode_is_opt_in_and_does_not_execute_providers(self) -> None:
        import logging

        logger = logging.getLogger("qlix.test.research-shadow")
        with patch.dict("os.environ", {}, clear=True):
            self.assertIsNone(
                log_shadow_route(
                    logger,
                    "search",
                    runtime="cloud",
                    public_tool="research_web_search",
                    legacy_providers=("exa_agent_reach",),
                )
            )
        with patch.dict("os.environ", {"QLIX_RESEARCH_SHADOW": "1"}, clear=True):
            report = log_shadow_route(
                logger,
                "search",
                runtime="cloud",
                public_tool="research_web_search",
                legacy_providers=("exa_agent_reach",),
            )
        self.assertIsNotNone(report)
        self.assertTrue(report.matches)


if __name__ == "__main__":
    unittest.main()
