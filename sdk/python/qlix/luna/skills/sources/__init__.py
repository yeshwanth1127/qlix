"""Skill source resolvers — Hermes, OpenClaw, generic GitHub."""

from qlix.luna.skills.sources.base import ResolvedSkill, SourceResolver
from qlix.luna.skills.sources.github import GitHubResolver
from qlix.luna.skills.sources.hermes import HERMES_REPO_URL, HermesResolver
from qlix.luna.skills.sources.openclaw import OPENCLAW_REPO_URL, OpenClawResolver

__all__ = [
    "GitHubResolver",
    "HERMES_REPO_URL",
    "HermesResolver",
    "OPENCLAW_REPO_URL",
    "OpenClawResolver",
    "ResolvedSkill",
    "SourceResolver",
]
