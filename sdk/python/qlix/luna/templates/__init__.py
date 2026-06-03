"""Agent template system — pre-configured agent manifests."""

from qlix.luna.templates.agent_templates import (
    AgentTemplate,
    discover_templates,
    load_template,
)

__all__ = ["AgentTemplate", "discover_templates", "load_template"]
