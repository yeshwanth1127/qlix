"""Async HTTP wrapper over httpx with retry + typed error mapping."""

from __future__ import annotations

import asyncio
import random
from typing import Any

import httpx

from .exceptions import (
    DeviceNotVerifiedError,
    HttpError,
    PermissionDeniedError,
    ReplayError,
    ScopeError,
)

DEFAULT_TIMEOUT_S = 15.0
DEFAULT_RETRIES = 5
RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}

# Maps backend `error.code` strings to typed exception classes.
ERROR_CODE_MAP: dict[str, type[Exception]] = {
    "device_not_verified": DeviceNotVerifiedError,
    "permission_denied": PermissionDeniedError,
    "scope_not_granted": ScopeError,
    "stale_timestamp": ReplayError,
    "jit_token_required": PermissionDeniedError,
    "jit_token_invalid": PermissionDeniedError,
}


class QlixHttpClient:
    def __init__(
        self,
        *,
        base_url: str,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        retries: int = DEFAULT_RETRIES,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_s
        self._retries = retries
        self._owned_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=self._base_url,
            timeout=timeout_s,
        )

    async def aclose(self) -> None:
        if self._owned_client:
            await self._client.aclose()

    async def __aenter__(self) -> "QlixHttpClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def post_json(
        self,
        path: str,
        body: dict[str, Any],
        *,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        return await self._request("POST", path, json=body, headers=headers)

    async def get_json(
        self,
        path: str,
        *,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        return await self._request("GET", path, headers=headers)

    async def patch_json(
        self,
        path: str,
        body: dict[str, Any],
        *,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        return await self._request("PATCH", path, json=body, headers=headers)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        last_exc: Exception | None = None
        for attempt in range(self._retries):
            try:
                response = await self._client.request(
                    method, path, json=json, headers=headers
                )
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                last_exc = exc
                await self._sleep_backoff(attempt)
                continue

            if response.status_code in RETRYABLE_STATUS and attempt < self._retries - 1:
                await self._sleep_backoff(attempt)
                continue

            return self._handle_response(response)

        # Exhausted retries on transport error. Some httpx exceptions (e.g. timeouts)
        # stringify to "", so fall back to the exception type for a legible message.
        detail = str(last_exc) if last_exc and str(last_exc) else type(last_exc).__name__ if last_exc else "unknown error"
        raise HttpError(
            f"Network failure after {self._retries} attempts: {detail}",
            status_code=0,
            body=None,
        )

    @staticmethod
    async def _sleep_backoff(attempt: int) -> None:
        # Exponential backoff with jitter: 0.2, 0.4, 0.8 ... + 0-100ms.
        delay = 0.2 * (2**attempt) + random.uniform(0.0, 0.1)
        await asyncio.sleep(delay)

    @staticmethod
    def _handle_response(response: httpx.Response) -> dict[str, Any]:
        if 200 <= response.status_code < 300:
            if not response.content:
                return {}
            try:
                return response.json()
            except ValueError as exc:
                raise HttpError(
                    "Backend returned non-JSON response",
                    status_code=response.status_code,
                    body=response.text,
                ) from exc

        body: Any
        try:
            body = response.json()
        except ValueError:
            body = response.text

        code = ""
        message = f"HTTP {response.status_code}"
        if isinstance(body, dict):
            err = body.get("error") if isinstance(body.get("error"), dict) else None
            if err:
                code = str(err.get("code", ""))
                message = str(err.get("message", message))

        exc_cls = ERROR_CODE_MAP.get(code)
        if exc_cls is not None:
            raise exc_cls(message)
        raise HttpError(message, status_code=response.status_code, body=body)
