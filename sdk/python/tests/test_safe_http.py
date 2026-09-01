from __future__ import annotations

import unittest
from unittest.mock import patch

import httpx

from qlix.luna.security.safe_http import request_with_ssrf_protection
from qlix.luna.security.ssrf import _check_ssrf_python, check_ssrf
from qlix.cloud_research_runtime import execute_research_read_url, execute_research_video


class SsrfCompatibilityTests(unittest.TestCase):
    def test_python_guard_blocks_private_and_credentialed_urls(self) -> None:
        self.assertIsNotNone(_check_ssrf_python("http://127.0.0.1/private"))
        self.assertIsNotNone(_check_ssrf_python("http://user:pass@example.com"))
        self.assertIsNotNone(_check_ssrf_python("file:///etc/passwd"))

    def test_missing_rust_extension_uses_protected_python_guard(self) -> None:
        with patch("qlix.luna._rust_bridge.get_rust_module", side_effect=ImportError("missing")):
            self.assertIsNotNone(check_ssrf("http://169.254.169.254/latest/meta-data"))

    def test_redirect_target_is_checked_before_second_request(self) -> None:
        calls = []

        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(302, headers={"location": "http://127.0.0.1/private"}, request=request)

        client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)
        with patch("qlix.luna.security.safe_http.httpx.Client", return_value=client), patch(
            "qlix.luna.security.safe_http.check_ssrf", side_effect=[None, "private address"]
        ):
            with self.assertRaisesRegex(ValueError, "Redirect blocked"):
                request_with_ssrf_protection("GET", "https://public.example/start")
        self.assertEqual(calls, ["https://public.example/start"])

    def test_managed_research_blocks_private_read_and_video_urls(self) -> None:
        read = execute_research_read_url({"url": "http://127.0.0.1/private"})
        video = execute_research_video({"url": "http://169.254.169.254/video"})
        self.assertTrue(read.startswith("[failed] SSRF protection blocked"))
        self.assertTrue(video.startswith("[failed] SSRF protection blocked"))


if __name__ == "__main__":
    unittest.main()
