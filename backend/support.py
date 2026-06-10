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
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.database import get_session
from backend.models import SupportReport
from backend.security import get_current_user_id

router = APIRouter(prefix="/api/support", tags=["support"])

SupportKind = Literal["BUG", "SUGGESTION", "OTHER"]


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
    message: str
    context: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


@router.post("", response_model=SupportReportResponse, status_code=status.HTTP_201_CREATED)
def create_report(
    payload: SupportCreateRequest,
    current_user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> SupportReportResponse:
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
