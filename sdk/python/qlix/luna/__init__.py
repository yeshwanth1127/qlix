"""Luna — modular AI assistant backend with composable intelligence primitives."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _pkg_version

from qlix.luna.sdk import Luna, LunaSystem, MemoryHandle, SystemBuilder

try:
    __version__ = _pkg_version("qlix")
except PackageNotFoundError:  # pragma: no cover — uninstalled source tree
    __version__ = "0.0.0+unknown"

__all__ = ["Luna", "LunaSystem", "MemoryHandle", "SystemBuilder", "__version__"]
