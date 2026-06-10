# PilotReady
# Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# NOTE: licensing stub - to be reviewed/refined later.

"""Admin-only endpoints.

Access is restricted to accounts whose email is configured in ``ADMIN_EMAILS``
(see ``backend.security``). Currently exposes the support-report triage panel:
list every user's reports and move them between statuses.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.database import get_session
from backend.models import SupportReport, User
from backend.security import get_current_user_id, is_admin_email

router = APIRouter(prefix="/api/admin", tags=["admin"])

SupportStatus = Literal["NEW", "IN_PROGRESS", "RESOLVED", "REJECTED"]
SupportKind = Literal["BUG", "SUGGESTION", "OTHER"]
ALL_STATUSES: tuple[SupportStatus, ...] = ("NEW", "IN_PROGRESS", "RESOLVED", "REJECTED")


def get_admin_user(
    current_user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> User:
    """Dependency: allow the request only if the caller is a configured admin."""

    user = session.get(User, current_user_id)
    if user is None or not is_admin_email(user.email):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class AdminSupportItem(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    message: str
    context: str | None
    created_at: datetime
    updated_at: datetime
    user_id: uuid.UUID
    user_email: str
    user_display_name: str | None


class AdminSupportListResponse(BaseModel):
    total: int
    counts: dict[str, int]
    items: list[AdminSupportItem]


class StatusUpdateRequest(BaseModel):
    status: SupportStatus


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.get("/support", response_model=AdminSupportListResponse)
def list_reports(
    _admin: Annotated[User, Depends(get_admin_user)],
    session: Annotated[Session, Depends(get_session)],
    report_status: Annotated[SupportStatus | None, Query(alias="status")] = None,
    kind: Annotated[SupportKind | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminSupportListResponse:
    # Status counts across ALL reports (so the UI badges show true totals).
    count_rows = session.execute(
        select(SupportReport.status, func.count()).group_by(SupportReport.status)
    ).all()
    counts = {s: 0 for s in ALL_STATUSES}
    for value, n in count_rows:
        counts[value] = int(n)
    total = sum(counts.values())

    query = select(SupportReport, User.email, User.display_name).join(User, User.id == SupportReport.user_id)
    if report_status is not None:
        query = query.where(SupportReport.status == report_status)
    if kind is not None:
        query = query.where(SupportReport.kind == kind)
    query = query.order_by(SupportReport.created_at.desc()).limit(limit).offset(offset)

    items = [
        AdminSupportItem(
            id=report.id,
            kind=report.kind,
            status=report.status,
            message=report.message,
            context=report.context,
            created_at=report.created_at,
            updated_at=report.updated_at,
            user_id=report.user_id,
            user_email=email,
            user_display_name=display_name,
        )
        for report, email, display_name in session.execute(query).all()
    ]

    return AdminSupportListResponse(total=total, counts=counts, items=items)


@router.patch("/support/{report_id}", response_model=AdminSupportItem)
def update_report_status(
    report_id: uuid.UUID,
    payload: StatusUpdateRequest,
    _admin: Annotated[User, Depends(get_admin_user)],
    session: Annotated[Session, Depends(get_session)],
) -> AdminSupportItem:
    report = session.get(SupportReport, report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    report.status = payload.status
    session.commit()
    session.refresh(report)

    author = session.get(User, report.user_id)
    return AdminSupportItem(
        id=report.id,
        kind=report.kind,
        status=report.status,
        message=report.message,
        context=report.context,
        created_at=report.created_at,
        updated_at=report.updated_at,
        user_id=report.user_id,
        user_email=author.email if author else "",
        user_display_name=author.display_name if author else None,
    )
