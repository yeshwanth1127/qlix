"""HTTP requests with SSRF validation on the initial URL and every redirect."""

from __future__ import annotations

from typing import Any

import httpx

from .ssrf import check_ssrf


def request_with_ssrf_protection(
    method: str,
    url: str,
    *,
    max_redirects: int = 10,
    **kwargs: Any,
) -> httpx.Response:
    error = check_ssrf(url)
    if error:
        raise ValueError(error)
    with httpx.Client(follow_redirects=False) as client:
        request = client.build_request(method, url, **kwargs)
        for _ in range(max_redirects + 1):
            response = client.send(request)
            next_request = response.next_request
            if next_request is None:
                return response
            error = check_ssrf(str(next_request.url))
            if error:
                response.close()
                raise ValueError(f"Redirect blocked by SSRF protection: {error}")
            request = next_request
    raise httpx.TooManyRedirects(f"More than {max_redirects} redirects", request=request)


__all__ = ["request_with_ssrf_protection"]
