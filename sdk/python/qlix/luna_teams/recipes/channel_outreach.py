"""Example recipe for channel outreach.

Recipes are optional composition metadata.  They are not commander tools and
do not add channel behavior to the Luna-Teams core.
"""

from __future__ import annotations

from typing import Any


LEAD_RESULT_SCHEMA: dict[str, Any] = {
    "$id": "qlix.recipe.channel_outreach.leads.v1",
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "summary": {"type": "string"},
        "findings": {},
        "leads": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "name": {"type": "string"},
                    "phone": {"type": "string"},
                    "city": {"type": "string"},
                },
                "required": ["phone"],
            },
        },
    },
}


CHANNEL_OUTREACH_RECIPE: dict[str, Any] = {
    "id": "channel_outreach.v1",
    "description": "Filter records, contact matches, wait for replies, then continue.",
    "contracts": [LEAD_RESULT_SCHEMA],
    "wait": {
        "kind": "channel_inbound",
        "side_effects": ["live_artifact", "deliver_on_resume"],
    },
}
