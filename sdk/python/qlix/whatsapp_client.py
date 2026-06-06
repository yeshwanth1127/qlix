"""Async HTTP client for the Qlix WhatsApp sidecar (qlix-whatsapp-service)."""

from __future__ import annotations

import logging
from typing import Any, Literal

import httpx

logger = logging.getLogger(__name__)

NotificationLevel = Literal["info", "warning", "error"]


class WhatsAppClient:
    """Calls the Node Baileys microservice; degrades gracefully on failure."""

    def __init__(self, base_url: str, secret: str, *, timeout_s: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout_s

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-Service-Secret": self._secret,
        }

    async def send(self, message: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                res = await client.post(
                    f"{self._base_url}/send",
                    headers=self._headers(),
                    json={"message": message},
                )
            if res.status_code != 200:
                logger.warning("WhatsApp send failed: %s %s", res.status_code, res.text[:200])
                return False
            return True
        except Exception as exc:
            logger.warning("WhatsApp send error: %s", exc)
            return False

    async def request_approval(
        self,
        context: str,
        action_id: str,
        scope: str,
        agent_name: str,
    ) -> bool:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                res = await client.post(
                    f"{self._base_url}/send-approval",
                    headers=self._headers(),
                    json={
                        "context": context,
                        "action_id": action_id,
                        "scope": scope,
                        "agent_name": agent_name,
                    },
                )
            if res.status_code != 200:
                logger.warning(
                    "WhatsApp approval request failed: %s %s",
                    res.status_code,
                    res.text[:200],
                )
                return False
            return True
        except Exception as exc:
            logger.warning("WhatsApp request_approval error: %s", exc)
            return False

    async def notify(
        self,
        message: str,
        level: NotificationLevel = "info",
        *,
        connector_id: str,
    ) -> bool:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                res = await client.post(
                    f"{self._base_url}/send-notification",
                    headers=self._headers(),
                    json={
                        "connector_id": connector_id,
                        "message": message,
                        "level": level,
                    },
                )
            if res.status_code != 200:
                logger.warning("WhatsApp notify failed: %s %s", res.status_code, res.text[:200])
                return False
            return True
        except Exception as exc:
            logger.warning("WhatsApp notify error: %s", exc)
            return False

    async def send_document(
        self,
        connector_id: str,
        file_path: str,
        *,
        file_name: str | None = None,
        mimetype: str | None = None,
    ) -> bool:
        payload: dict[str, Any] = {
            "connector_id": connector_id,
            "file_path": file_path,
        }
        if file_name:
            payload["file_name"] = file_name
        if mimetype:
            payload["mimetype"] = mimetype
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                res = await client.post(
                    f"{self._base_url}/send-document",
                    headers=self._headers(),
                    json=payload,
                )
            if res.status_code != 200:
                logger.warning("WhatsApp send_document failed: %s %s", res.status_code, res.text[:200])
                return False
            return True
        except Exception as exc:
            logger.warning("WhatsApp send_document error: %s", exc)
            return False

    async def health_check(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                res = await client.get(
                    f"{self._base_url}/health",
                    headers=self._headers(),
                )
            if res.status_code != 200:
                return {}
            data = res.json()
            return data if isinstance(data, dict) else {}
        except Exception as exc:
            logger.warning("WhatsApp health_check error: %s", exc)
            return {}
