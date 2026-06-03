"""Qlix SDK — signed, audited tool execution for AI agents."""

from .exceptions import (
    DeviceNotVerifiedError,
    HttpError,
    IdentityError,
    JITTimeoutError,
    PermissionDeniedError,
    QlixError,
    ReplayError,
    ScopeError,
    SignatureError,
)
from .identity import (
    AgentIdentity,
    ENV_AGENT_FILE,
    extract_sdk_agent_file,
    load_identity,
    parse_identity,
    resolve_agent_json_path,
    save_sdk_agent_json,
)
from .agent import AgentMeta, agent, register_connector_scopes
from .dev import dev_mode, is_dev_mode
from .runner import AgentRunner, RunResult, runner
from .sdk import QlixSDK
from .serve import serve
from .signer import canonicalize, sign_payload, verify_payload
from .tool import ToolMeta, tool

__all__ = [
    "AgentMeta",
    "ENV_AGENT_FILE",
    "AgentIdentity",
    "DeviceNotVerifiedError",
    "HttpError",
    "IdentityError",
    "JITTimeoutError",
    "PermissionDeniedError",
    "QlixError",
    "QlixSDK",
    "ReplayError",
    "ToolMeta",
    "AgentRunner",
    "RunResult",
    "agent",
    "dev_mode",
    "is_dev_mode",
    "register_connector_scopes",
    "runner",
    "serve",
    "tool",
    "ScopeError",
    "SignatureError",
    "canonicalize",
    "extract_sdk_agent_file",
    "load_identity",
    "parse_identity",
    "resolve_agent_json_path",
    "save_sdk_agent_json",
    "sign_payload",
    "verify_payload",
]

__version__ = "0.1.0"
