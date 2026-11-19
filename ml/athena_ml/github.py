"""Minimal GitHub REST client (stdlib only) that honours rate limits."""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

API = "https://api.github.com"


def find_token() -> str | None:
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        return token
    try:
        out = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or None
    except (OSError, subprocess.TimeoutExpired):
        return None


class GitHub:
    def __init__(self, token: str | None = None, opener: Callable[[urllib.request.Request], Any] | None = None,
                 sleep: Callable[[float], None] = time.sleep):
        self.token = token if token is not None else find_token()
        self._open = opener or (lambda req: urllib.request.urlopen(req, timeout=60))
        self._sleep = sleep
        self._last_search = 0.0

    def get(self, path: str, params: dict[str, Any] | None = None, retries: int = 6) -> dict[str, Any]:
        url = path if path.startswith("http") else API + path
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "athena-ml", "X-GitHub-Api-Version": "2022-11-28"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if "/search/" in url:  # search is limited to ~30/min and has a secondary limit: pace it
            gap = 3.0 - (time.time() - self._last_search)
            if gap > 0:
                self._sleep(gap)
            self._last_search = time.time()
        for attempt in range(retries + 1):
            try:
                with self._open(urllib.request.Request(url, headers=headers)) as resp:
                    remaining = resp.headers.get("X-RateLimit-Remaining")
                    body = json.loads(resp.read().decode("utf-8"))
                    if remaining is not None and int(remaining) <= 1:
                        reset = int(resp.headers.get("X-RateLimit-Reset", "0"))
                        self._sleep(max(1.0, min(reset - time.time(), 65.0)))
                    return body
            except urllib.error.HTTPError as err:
                retry_after = err.headers.get("Retry-After") if err.headers else None
                body = ""
                try:
                    body = err.read().decode("utf-8", "replace").lower()
                except Exception:
                    pass
                secondary = err.code in (403, 429) and "secondary rate limit" in body
                limited = err.code in (403, 429) and (retry_after or secondary or (err.headers and err.headers.get("X-RateLimit-Remaining") == "0"))
                if err.code in (502, 503) or limited:
                    if attempt == retries:
                        raise
                    self._sleep(float(retry_after) if retry_after else (90.0 * (attempt + 1) if secondary else min(65.0, 5.0 * (attempt + 1))))
                    continue
                raise
        raise RuntimeError("unreachable")
