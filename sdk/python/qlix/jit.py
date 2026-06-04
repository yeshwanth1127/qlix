"""JIT approval client.

Targets backend endpoints that DO NOT EXIST YET (per the SDK plan). Wire format
is the contract; once the backend ships /api/v1/jit/request and /api/v1/jit/poll
this layer becomes live without code changes here.

Expected backend contract:

    POST /api/v1/jit/request
      body: { signature, signedPayload: { did, actionType, payload, timestampMs } }
      201: { jitRequestId: str, expiresAtMs: int }

    GET /api/v1/jit/poll/{jitRequestId}
      200: { status: 'pending' | 'approved' | 'denied' | 'expired',
             jitToken?: str  # one-time, only when approved
           }
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

from .exceptions import JITTimeoutError, PermissionDeniedError
from .http_client import QlixHttpClient
from .signer import sign_payload

POLL_INTERVAL_S = 2.0
DEFAULT_TIMEOUT_S = 290.0


@dataclass(frozen=True)
class JITApproval:
    jit_request_id: str
    jit_token: str


class JITClient:
    def __init__(
        self,
        *,
        http: QlixHttpClient,
        did: str,
        private_key_hex: str,
        poll_interval_s: float = POLL_INTERVAL_S,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> None:
        self._http = http
        self._did = did
        self._private_key_hex = private_key_hex
        self._poll_interval_s = poll_interval_s
        self._timeout_s = timeout_s

    async def request_and_wait(
        self,
        *,
        action_type: str,
        payload: dict[str, Any],
    ) -> JITApproval:
        signed = {
            "did": self._did,
            "actionType": action_type,
            "payload": payload,
            "timestampMs": int(time.time() * 1000),
        }
        signature = sign_payload(signed, private_key_hex=self._private_key_hex)
        body = {"signature": signature, "signedPayload": signed}

        response = await self._http.post_json("/api/v1/jit/request", body)
        request_id = response.get("jitRequestId") or response.get("jit_request_id")
        if not isinstance(request_id, str) or not request_id:
            raise PermissionDeniedError("JIT request did not return a request id")

        return await self._poll(request_id)

    async def _poll(self, request_id: str) -> JITApproval:
        deadline = asyncio.get_event_loop().time() + self._timeout_s
        while True:
            result = await self._http.get_json(f"/api/v1/jit/poll/{request_id}")
            status = result.get("status")
            if status == "approved":
                token = result.get("jitToken") or result.get("jit_token")
                if not isinstance(token, str) or not token:
                    raise PermissionDeniedError(
                        "JIT approval missing one-time token"
                    )
                return JITApproval(jit_request_id=request_id, jit_token=token)
            if status == "denied":
                raise PermissionDeniedError("User denied JIT approval")
            if status == "expired":
                raise JITTimeoutError("JIT approval expired before user decided")

            if asyncio.get_event_loop().time() >= deadline:
                raise JITTimeoutError(
                    f"JIT approval not granted within {self._timeout_s}s"
                )
            await asyncio.sleep(self._poll_interval_s)
