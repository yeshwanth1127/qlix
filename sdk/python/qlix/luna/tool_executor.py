"""Stable imports for tool dispatch types (re-exported from canonical modules)."""

from .core.types import ToolCall, ToolResult
from .tools._stubs import ToolExecutor

__all__ = ["ToolCall", "ToolExecutor", "ToolResult"]
