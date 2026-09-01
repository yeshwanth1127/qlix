"""Authoritative, compatibility-safe capability metadata for Qlix runtimes.

The catalog owns the stable name, description and input schema for managed
tools.  Dynamic MCP and product-specific tools remain supplied by their
existing builders; this prevents a metadata rollout from removing a feature.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from .contracts import CapabilityDescriptor


_CATALOG_PATH = Path(__file__).resolve().parent / "data/capability_catalog.json"


@lru_cache(maxsize=1)
def load_capability_catalog() -> dict[str, Any]:
    return json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))


def capability_descriptor(name: str) -> CapabilityDescriptor:
    raw = load_capability_catalog()["capabilities"].get(name)
    if not isinstance(raw, dict):
        raise KeyError(f"Unknown Qlix capability: {name}")
    return CapabilityDescriptor.from_wire(raw)


def catalog_tool_definitions(
    *,
    runtime: Literal["cloud", "hybrid"],
    browser_mode: Literal["collapsed", "expanded"] = "collapsed",
) -> list[dict[str, Any]]:
    catalog = load_capability_catalog()
    array_name = (
        "hybrid"
        if runtime == "hybrid"
        else "cloudCollapsed"
        if browser_mode == "collapsed"
        else "cloudExpanded"
    )
    names = catalog["toolArrays"][array_name]
    definitions: list[dict[str, Any]] = []
    for name in names:
        descriptor = capability_descriptor(name)
        definitions.append(
            {
                "type": "function",
                "function": {
                    "name": descriptor.name,
                    "description": descriptor.description,
                    "parameters": dict(descriptor.input_schema),
                },
            }
        )
    return definitions


def canonicalize_tool_definitions(definitions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Use catalog metadata for known tools without dropping dynamic tools.

    A legacy builder remains the authority for availability and tool-specific
    runtime wiring.  When its emitted name is represented in the catalog, the
    stable descriptor becomes the model-facing definition.  Invalid or
    unknown entries deliberately pass through unchanged for compatibility.
    """
    canonical: list[dict[str, Any]] = []
    capabilities = load_capability_catalog().get("capabilities", {})
    for definition in definitions:
        function = definition.get("function") if isinstance(definition, dict) else None
        name = function.get("name") if isinstance(function, dict) else None
        raw = capabilities.get(name) if isinstance(name, str) else None
        if not isinstance(raw, dict):
            canonical.append(definition)
            continue
        try:
            descriptor = CapabilityDescriptor.from_wire(raw)
        except (TypeError, ValueError):
            canonical.append(definition)
            continue
        replacement = dict(definition)
        replacement["function"] = {
            **function,
            "name": descriptor.name,
            "description": descriptor.description,
            "parameters": dict(descriptor.input_schema),
        }
        canonical.append(replacement)
    return canonical


__all__ = ["capability_descriptor", "canonicalize_tool_definitions", "catalog_tool_definitions", "load_capability_catalog"]
