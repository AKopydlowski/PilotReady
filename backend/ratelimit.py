# PilotReady
# Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# NOTE: licensing stub - to be reviewed/refined later.

"""Shared rate limiter (anti-spam / anti-abuse).

A single SlowAPI ``Limiter`` instance used both as global middleware (a generous
blanket cap per client) and via per-route decorators on sensitive endpoints
(login, register, support submission). This blunts brute-force, scraping, and
spam floods at the application layer.

NOTE: this protects against abusive *request volume*, not a true volumetric
network DDoS — that needs a CDN/WAF (e.g. Cloudflare) in front of the service.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def _client_key(request: Request) -> str:
    """Identify the caller for rate-limiting.

    Behind Render/Vercel the real client IP arrives in ``X-Forwarded-For``; fall
    back to the socket peer otherwise.
    """

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)


# Generous global default so normal study/exam traffic is never throttled, while
# still capping pathological floods. Sensitive routes set tighter per-route limits.
limiter = Limiter(key_func=_client_key, default_limits=["600/minute"])
