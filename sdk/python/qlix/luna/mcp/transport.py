"""MCP transport implementations."""

from __future__ import annotations

import json
import subprocess
import threading
from abc import ABC, abstractmethod
from collections import deque
from typing import TYPE_CHECKING, Any, List, Optional

from qlix.luna.mcp.protocol import MCPRequest, MCPResponse

# Cap how many interleaved notification/log lines we'll skip while waiting for the
# matching JSON-RPC response, so a misbehaving server can't spin us forever.
_MAX_SKIP_LINES = 1000

if TYPE_CHECKING:
    from qlix.luna.mcp.server import MCPServer


class MCPTransport(ABC):
    """Abstract transport layer for MCP communication."""

    @abstractmethod
    def send(self, request: MCPRequest) -> MCPResponse:
        """Send a request and return the response."""

    def send_notification(self, request: MCPRequest) -> None:
        """Send a JSON-RPC notification (no response expected).

        The default implementation delegates to :meth:`send` and discards the
        response.  Transports may override this when the server returns no
        body for notifications (e.g. HTTP 202 Accepted).
        """
        self.send(request)

    @abstractmethod
    def close(self) -> None:
        """Release transport resources."""


class InProcessTransport(MCPTransport):
    """Direct in-process transport for testing.

    Routes requests directly to an ``MCPServer`` instance without
    serialization overhead.
    """

    def __init__(self, server: MCPServer) -> None:
        self._server = server

    def send(self, request: MCPRequest) -> MCPResponse:
        """Dispatch request directly to the server."""
        return self._server.handle(request)

    def close(self) -> None:
        """No resources to release."""


class StdioTransport(MCPTransport):
    """JSON-RPC over stdin/stdout subprocess transport.

    Launches a subprocess and communicates via JSON lines on
    stdin/stdout.
    """

    def __init__(self, command: List[str], *, env: Optional[dict] = None) -> None:
        self._command = command
        self._env = env
        self._process: Optional[subprocess.Popen[str]] = None
        self._stderr_tail: deque[str] = deque(maxlen=50)
        self._stderr_thread: Optional[threading.Thread] = None
        self._start()

    def _start(self) -> None:
        """Start the subprocess.

        When ``env`` is provided it is layered on top of the current process
        environment (so PATH etc. are preserved while server-specific secrets
        like API keys are injected).

        A daemon thread continuously drains stderr into a bounded ring buffer.
        Without this, a chatty server fills the ~64 KB stderr pipe, blocks on its
        own write, and deadlocks against our blocking ``stdout.readline()``.
        """
        import os

        proc_env = None
        if self._env:
            proc_env = {**os.environ, **{str(k): str(v) for k, v in self._env.items()}}
        self._process = subprocess.Popen(
            self._command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=proc_env,
        )
        self._stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self._stderr_thread.start()

    def _drain_stderr(self) -> None:
        """Continuously read stderr into a bounded buffer (kept for diagnostics)."""
        proc = self._process
        if proc is None or proc.stderr is None:
            return
        try:
            for line in proc.stderr:
                self._stderr_tail.append(line.rstrip("\n"))
        except Exception:
            pass

    def send(self, request: MCPRequest) -> MCPResponse:
        """Write the request as a JSON line and read back the matching response.

        MCP stdio servers may interleave JSON-RPC notifications and log messages on
        stdout. A naive "read one line" pairs our request with whatever line comes
        next — often a notification — and mis-parses it as the response. Instead we
        read until we see a response object whose ``id`` matches our request id,
        skipping notifications (no/null id) and unrelated lines.
        """
        proc = self._process
        if proc is None or proc.stdin is None or proc.stdout is None:
            raise RuntimeError("Transport process is not running")

        line = request.to_json() + "\n"
        proc.stdin.write(line)
        proc.stdin.flush()

        expected_id = request.id
        for _ in range(_MAX_SKIP_LINES):
            response_line = proc.stdout.readline()
            if not response_line:
                tail = "\n".join(self._stderr_tail)
                raise RuntimeError(
                    f"No response from subprocess. stderr:\n{tail}" if tail else "No response from subprocess"
                )
            stripped = response_line.strip()
            if not stripped:
                continue
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                continue  # non-JSON noise on stdout
            if not isinstance(parsed, dict):
                continue
            # Notifications / server-initiated requests have no response id to match.
            if parsed.get("id") is None:
                continue
            # Compare loosely: some servers echo a numeric id back as a string.
            if expected_id is not None and str(parsed.get("id")) != str(expected_id):
                continue  # a response to some other request
            return MCPResponse.from_json(stripped)

        raise RuntimeError("No matching JSON-RPC response from subprocess (too many interleaved lines)")

    def close(self) -> None:
        """Terminate the subprocess."""
        if self._process is not None:
            try:
                self._process.terminate()
                self._process.wait(timeout=5)
            except Exception:
                pass
            self._process = None


class StreamableHTTPTransport(MCPTransport):
    """MCP Streamable HTTP transport (JSON-RPC over HTTP).

    Uses a persistent ``httpx.Client`` session, tracks the
    ``Mcp-Session-Id`` header, and sends the ``Accept`` header
    required by the MCP Streamable HTTP specification.
    """

    def __init__(
        self,
        url: str,
        *,
        headers: Optional[dict] = None,
        connect_timeout: float = 10.0,
        request_timeout: float = 60.0,
    ) -> None:
        import httpx

        self._url = url
        self._session_id: Optional[str] = None
        self._extra_headers = {str(k): str(v) for k, v in (headers or {}).items()}
        self._client = httpx.Client(
            timeout=httpx.Timeout(
                connect=connect_timeout,
                read=request_timeout,
                write=request_timeout,
                pool=connect_timeout,
            ),
        )

    def _safe_url(self) -> str:
        """Return scheme://host:port without path or query (avoids leaking tokens)."""
        from urllib.parse import urlparse

        parsed = urlparse(self._url)
        return f"{parsed.scheme}://{parsed.netloc}"

    def _build_headers(self) -> dict:
        """Build common request headers."""
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        headers.update(self._extra_headers)
        if self._session_id is not None:
            headers["Mcp-Session-Id"] = self._session_id
        return headers

    def _post(self, request: MCPRequest) -> Any:
        """Post a request and return the raw httpx response."""
        import httpx

        headers = self._build_headers()
        try:
            response = self._client.post(
                self._url,
                json=request.to_dict(),
                headers=headers,
            )
            response.raise_for_status()
        except httpx.ConnectError as exc:
            raise RuntimeError(
                f"Failed to connect to MCP server at {self._safe_url()}: {exc}"
            ) from exc
        except httpx.TimeoutException as exc:
            raise RuntimeError(
                f"Timeout communicating with MCP server at {self._safe_url()}: {exc}"
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(
                f"MCP server at {self._safe_url()} returned HTTP "
                f"{exc.response.status_code}"
            ) from exc

        # Track session id from the first response
        new_session_id = response.headers.get("mcp-session-id")
        if new_session_id is not None:
            self._session_id = new_session_id
        return response

    @staticmethod
    def _extract_json_from_sse(text: str) -> str:
        """Extract JSON payload from an SSE response body.

        MCP Streamable HTTP servers may respond with ``text/event-stream``
        instead of ``application/json``.  In that case the body looks like::

            event: message
            data: {"jsonrpc":"2.0", ...}

        This helper finds the last ``data:`` line and returns its content,
        which is the actual JSON-RPC response.
        """
        last_data = ""
        for line in text.splitlines():
            if line.startswith("data:"):
                last_data = line[len("data:") :].strip()
        if not last_data:
            raise RuntimeError(
                "SSE response contained no 'data:' lines"
                " — cannot extract JSON-RPC payload"
            )
        return last_data

    def send(self, request: MCPRequest) -> MCPResponse:
        """Send request via HTTP POST following the MCP Streamable HTTP spec.

        Handles both ``application/json`` and ``text/event-stream`` responses
        as allowed by the MCP Streamable HTTP specification.
        """
        response = self._post(request)
        content_type = response.headers.get("content-type", "")
        body = response.text
        if "text/event-stream" in content_type or body.lstrip().startswith("event:"):
            body = self._extract_json_from_sse(body)
        return MCPResponse.from_json(body)

    def send_notification(self, request: MCPRequest) -> None:
        """Send a notification — accept any 2xx, don't parse the body."""
        # Track session id but don't try to parse a JSON-RPC response.
        # Servers may return 202 Accepted with an empty body.
        self._post(request)

    def close(self) -> None:
        """Close the underlying httpx client."""
        self._client.close()


# Backward-compatible alias
SSETransport = StreamableHTTPTransport


__all__ = [
    "InProcessTransport",
    "MCPTransport",
    "SSETransport",
    "StdioTransport",
    "StreamableHTTPTransport",
]
