"""Tools primitive — tool system with ABC interface and built-in tools."""

from __future__ import annotations

from qlix.luna.tools._stubs import BaseTool, ToolExecutor, ToolSpec

# Import built-in tools to trigger @ToolRegistry.register() decorators.
# Each is wrapped in try/except so the package loads even before the
# individual tool modules are created.
try:
    import qlix.luna.tools.calculator  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.think  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.retrieval  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.llm_tool  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.file_read  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.web_search  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.open_system_url  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.code_interpreter  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.code_interpreter_docker  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.repl  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.storage_tools  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.mcp_adapter  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.channel_tools  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.http_request  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.shell_exec  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.memory_manage  # noqa: F401
except ImportError:
    pass
try:
    import qlix.luna.tools.user_profile_manage  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.skill_manage  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.file_write  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.apply_patch  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.git_tool  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.db_query  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.pdf_tool  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.image_tool  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.audio_tool  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.knowledge_tools  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.text_to_speech  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.digest_collect  # noqa: F401
except ImportError:
    pass

__all__ = ["BaseTool", "ToolExecutor", "ToolSpec"]
