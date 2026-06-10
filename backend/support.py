# PilotReady
# Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# NOTE: licensing stub - to be reviewed/refined later.

"""Support / feedback endpoints.

Logged-in users can submit bug reports and suggestions from the in-app support
tab; each report is stored against their account. ``/api/support/mine`` lets a
user see their own past submissions.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.database import get_session
from backend.models import SupportReport
from backend.ratelimit import limiter
from backend.security import get_current_user_id

router = APIRouter(prefix="/api/support", tags=["support"])

SupportKind = Literal["BUG", "SUGGESTION", "OTHER"]

# Anti-spam: at most this many reports per user per rolling hour.
MAX_REPORTS_PER_USER_PER_HOUR = 15

# How long after submitting a user may still cancel (withdraw) their own report.
CANCEL_WINDOW_MINUTES = 10


class SupportCreateRequest(BaseModel):
    kind: SupportKind = "BUG"
    message: str = Field(min_length=1, max_length=4000)
    # Optional technical context the client may attach (e.g. user-agent).
    context: str | None = Field(default=None, max_length=400)

    @field_validator("message")
    @classmethod
    def message_not_blank(cls, value: str) -> str:
        # Reject whitespace-only messages at the schema level (422) so they never
        # reach the DB check constraint as an empty string (which would 500).
        stripped = value.strip()
        if not stripped:
            raise ValueError("message must not be blank")
        return stripped


class SupportReportResponse(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    message: str
    context: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


@router.post("", response_model=SupportReportResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/hour")
def create_report(
    request: Request,
    payload: SupportCreateRequest,
    current_user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> SupportReportResponse:
    # Per-account anti-spam cap (independent of the per-IP limiter above): block a
    # single logged-in user from flooding reports regardless of their network.
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = session.scalar(
        select(func.count())
        .select_from(SupportReport)
        .where(SupportReport.user_id == current_user_id, SupportReport.created_at >= one_hour_ago)
    )
    if recent and recent >= MAX_REPORTS_PER_USER_PER_HOUR:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many reports submitted recently. Please try again later.",
        )

    report = SupportReport(
        user_id=current_user_id,
        kind=payload.kind,
        message=payload.message.strip(),
        context=(payload.context.strip() if payload.context else None),
    )
    session.add(report)
    session.commit()
    session.refresh(report)
    return SupportReportResponse.model_validate(report)


@router.get("/mine", response_model=list[SupportReportResponse])
def my_reports(
    current_user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> list[SupportReportResponse]:
    rows = session.scalars(
        select(SupportReport)
        .where(SupportReport.user_id == current_user_id)
        .order_by(SupportReport.created_at.desc())
    ).all()
    return [SupportReportResponse.model_validate(row) for row in rows]


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_report(
    report_id: uuid.UUID,
    current_user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """Let a user withdraw their own report within CANCEL_WINDOW_MINUTES.

    Uses 404 for both "not found" and "not yours" so a user cannot probe other
    people's report ids.
    """

    report = session.get(SupportReport, report_id)
    if report is None or report.user_id != current_user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    age = datetime.now(timezone.utc) - report.created_at
    if age > timedelta(minutes=CANCEL_WINDOW_MINUTES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Reports can only be cancelled within {CANCEL_WINDOW_MINUTES} minutes.",
        )

    session.delete(report)
    session.commit()
