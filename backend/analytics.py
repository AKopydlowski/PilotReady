# PilotReady
# Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# NOTE: licensing stub - to be reviewed/refined later.

"""Lightweight, privacy-respecting traffic tracking.

The SPA pings ``POST /api/analytics/visit`` once per browser session (including
before login) so the admin panel can show how many people visit the site and
how many of them convert into registered users. We store only an anonymous,
client-generated ``visitor_id`` (a localStorage uuid) — never an IP address or
any other personal identifier — plus an optional ``user_id`` when the caller is
already logged in.

The endpoint is open to anonymous callers but rate-limited (see ``ratelimit``)
to keep it cheap to operate and resistant to spam/abuse.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database import get_session
from backend.models import PageVisit
from backend.ratelimit import limiter
from backend.security import get_optional_user_id

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class VisitRequest(BaseModel):
    # Anonymous per-browser id (uuid) generated client-side. Capped so a crafted
    # client cannot bloat the column.
    visitor_id: str = Field(min_length=8, max_length=64)
    path: str | None = Field(default=None, max_length=200)


@router.post("/visit", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("120/hour")
def record_visit(
    request: Request,  # noqa: ARG001 — required by slowapi to key the rate limit
    payload: VisitRequest,
    session: Annotated[Session, Depends(get_session)],
    user_id: Annotated[uuid.UUID | None, Depends(get_optional_user_id)] = None,
) -> None:
    visit = PageVisit(
        visitor_id=payload.visitor_id.strip(),
        user_id=user_id,
        path=(payload.path or None),
    )
    session.add(visit)
    session.commit()
