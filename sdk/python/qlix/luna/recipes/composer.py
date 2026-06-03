"""Composer bridges — convert a Recipe into OperatorManifest.

These are pure-function transformations that let the unified Recipe format
drive the operator system without that system needing to know about
recipes directly.

The eval-suite composer (``recipe_to_eval_suite``) was removed in the SDK
build because the ``evals`` subsystem is not shipped — it lives server-side.
The function is kept as a stub that raises a clear error.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, List, Optional

if TYPE_CHECKING:
    from qlix.luna.operators.types import OperatorManifest
    from qlix.luna.recipes.loader import Recipe


def recipe_to_eval_suite(
    recipe,
    benchmarks: Optional[List[str]] = None,
    max_samples: Optional[int] = None,
    judge_model: Optional[str] = None,
):
    """Stub. The eval framework is not bundled with the SDK build."""
    raise RuntimeError(
        "recipe_to_eval_suite() is unavailable in the Qlix SDK build. "
        "Eval suites run server-side; use the Qlix backend evaluation API instead."
    )


def recipe_to_operator(recipe: "Recipe") -> "OperatorManifest":
    """Build an ``OperatorManifest`` from a recipe.

    Raises:
        ValueError: If schedule information is missing.
    """
    from qlix.luna.operators.types import OperatorManifest

    if not recipe.schedule_type:
        raise ValueError(
            f"Recipe '{recipe.name}' has no [schedule] section.  "
            "Operator recipes must define schedule_type and schedule_value."
        )

    prompt = recipe.system_prompt or ""
    prompt_path = recipe.system_prompt_path or ""

    return OperatorManifest(
        id=recipe.name,
        name=recipe.name,
        version=recipe.version,
        description=recipe.description,
        tools=list(recipe.tools),
        system_prompt=prompt,
        system_prompt_path=prompt_path,
        max_turns=recipe.max_turns or 20,
        temperature=recipe.temperature or 0.3,
        schedule_type=recipe.schedule_type,
        schedule_value=recipe.schedule_value or "300",
        required_capabilities=list(recipe.required_capabilities),
    )


__all__ = ["recipe_to_eval_suite", "recipe_to_operator"]
