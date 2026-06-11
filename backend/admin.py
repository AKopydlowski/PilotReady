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
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import Date, Integer, case, cast, delete, distinct, func, select, update
from sqlalchemy.orm import Session

from backend.database import get_session
from backend.models import PageVisit, SupportReport, User, UserProgress
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


class BulkActionRequest(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    action: Literal["set_status", "delete"]
    status: SupportStatus | None = None

    @model_validator(mode="after")
    def status_required_for_set(self) -> "BulkActionRequest":
        if self.action == "set_status" and self.status is None:
            raise ValueError("status is required when action is 'set_status'")
        return self


class BulkActionResponse(BaseModel):
    affected: int


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


@router.delete("/support/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(
    report_id: uuid.UUID,
    _admin: Annotated[User, Depends(get_admin_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """Hard-delete a report. It disappears for the reporting user too."""

    report = session.get(SupportReport, report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    session.delete(report)
    session.commit()


@router.post("/support/bulk", response_model=BulkActionResponse)
def bulk_action(
    payload: BulkActionRequest,
    _admin: Annotated[User, Depends(get_admin_user)],
    session: Annotated[Session, Depends(get_session)],
) -> BulkActionResponse:
    """Apply an action (set status, or delete) to several reports at once."""

    if payload.action == "delete":
        result = session.execute(delete(SupportReport).where(SupportReport.id.in_(payload.ids)))
    else:  # set_status (status presence enforced by the request validator)
        result = session.execute(
            update(SupportReport)
            .where(SupportReport.id.in_(payload.ids))
            .values(status=payload.status, updated_at=func.now())
        )
    session.commit()
    return BulkActionResponse(affected=result.rowcount or 0)


# --------------------------------------------------------------------------- #
# Analytics — admin dashboard (traffic, users, engagement)
# --------------------------------------------------------------------------- #
DAY_SERIES_LEN = 14  # number of daily buckets returned for the mini charts


class CountWindow(BaseModel):
    total: int
    last_24h: int
    last_7d: int
    last_30d: int


class DayCount(BaseModel):
    day: date
    count: int


class AnalyticsOverview(BaseModel):
    generated_at: datetime
    users: CountWindow
    visits: CountWindow
    unique_visitors: CountWindow
    reports: dict[str, int]
    reports_total: int
    total_answers: int
    active_users_7d: int
    signups_by_day: list[DayCount]
    visits_by_day: list[DayCount]


class AnalyticsUserItem(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str | None
    is_admin: bool
    created_at: datetime
    answers_count: int
    correct_count: int
    incorrect_count: int
    reports_count: int
    visits_count: int
    last_active: datetime | None


class AnalyticsUsersResponse(BaseModel):
    total: int
    items: list[AnalyticsUserItem]


def _count(session: Session, model, *conditions) -> int:
    stmt = select(func.count()).select_from(model)
    for condition in conditions:
        stmt = stmt.where(condition)
    return int(session.scalar(stmt) or 0)


def _count_window(session: Session, model, time_col, d1: datetime, d7: datetime, d30: datetime) -> CountWindow:
    return CountWindow(
        total=_count(session, model),
        last_24h=_count(session, model, time_col >= d1),
        last_7d=_count(session, model, time_col >= d7),
        last_30d=_count(session, model, time_col >= d30),
    )


def _distinct_window(session: Session, model, col, time_col, d1, d7, d30) -> CountWindow:
    def n(*conditions) -> int:
        stmt = select(func.count(distinct(col))).select_from(model)
        for condition in conditions:
            stmt = stmt.where(condition)
        return int(session.scalar(stmt) or 0)

    return CountWindow(total=n(), last_24h=n(time_col >= d1), last_7d=n(time_col >= d7), last_30d=n(time_col >= d30))


def _day_series(session: Session, time_col, today: date) -> list[DayCount]:
    """A dense ``DAY_SERIES_LEN``-day series ending today, zero-filled."""

    start = today - timedelta(days=DAY_SERIES_LEN - 1)
    day_expr = cast(time_col, Date)
    rows = session.execute(
        select(day_expr.label("day"), func.count())
        .where(time_col >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc))
        .group_by(day_expr)
    ).all()
    by_day = {row[0]: int(row[1]) for row in rows}
    return [DayCount(day=(start + timedelta(days=i)), count=by_day.get(start + timedelta(days=i), 0)) for i in range(DAY_SERIES_LEN)]


@router.get("/analytics/overview", response_model=AnalyticsOverview)
def analytics_overview(
    _admin: Annotated[User, Depends(get_admin_user)],
    session: Annotated[Session, Depends(get_session)],
) -> AnalyticsOverview:
    now = datetime.now(timezone.utc)
    d1, d7, d30 = now - timedelta(days=1), now - timedelta(days=7), now - timedelta(days=30)

    # Support-report counts by status (mirrors the triage panel badges).
    report_counts = {s: 0 for s in ALL_STATUSES}
    for value, n in session.execute(select(SupportReport.status, func.count()).group_by(SupportReport.status)).all():
        report_counts[value] = int(n)

    return AnalyticsOverview(
        generated_at=now,
        users=_count_window(session, User, User.created_at, d1, d7, d30),
        visits=_count_window(session, PageVisit, PageVisit.created_at, d1, d7, d30),
        unique_visitors=_distinct_window(session, PageVisit, PageVisit.visitor_id, PageVisit.created_at, d1, d7, d30),
        reports=report_counts,
        reports_total=sum(report_counts.values()),
        total_answers=_count(session, UserProgress),
        active_users_7d=int(
            session.scalar(
                select(func.count(distinct(UserProgress.user_id))).where(UserProgress.last_answered_at >= d7)
            )
            or 0
        ),
        signups_by_day=_day_series(session, User.created_at, now.date()),
        visits_by_day=_day_series(session, PageVisit.created_at, now.date()),
    )


@router.get("/analytics/users", response_model=AnalyticsUsersResponse)
def analytics_users(
    _admin: Annotated[User, Depends(get_admin_user)],
    session: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AnalyticsUsersResponse:
    total = _count(session, User)

    users = session.execute(
        select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    ).scalars().all()
    user_ids = [u.id for u in users]

    # Per-user aggregates, computed in three grouped queries and merged in Python
    # so the page stays a handful of round-trips regardless of user count.
    progress_by_user: dict[uuid.UUID, tuple[int, int, int, datetime | None]] = {}
    reports_by_user: dict[uuid.UUID, int] = {}
    visits_by_user: dict[uuid.UUID, int] = {}
    if user_ids:
        correct_sum = func.coalesce(func.sum(case((UserProgress.status == "CORRECT", 1), else_=0)), 0)
        incorrect_sum = func.coalesce(func.sum(case((UserProgress.status == "INCORRECT", 1), else_=0)), 0)
        prog_rows = session.execute(
            select(
                UserProgress.user_id,
                func.count(),
                cast(correct_sum, Integer),
                cast(incorrect_sum, Integer),
                func.max(UserProgress.last_answered_at),
            )
            .where(UserProgress.user_id.in_(user_ids))
            .group_by(UserProgress.user_id)
        ).all()
        for uid, answers, correct, incorrect, last_active in prog_rows:
            progress_by_user[uid] = (int(answers), int(correct), int(incorrect), last_active)

        for uid, n in session.execute(
            select(SupportReport.user_id, func.count())
            .where(SupportReport.user_id.in_(user_ids))
            .group_by(SupportReport.user_id)
        ).all():
            reports_by_user[uid] = int(n)

        for uid, n in session.execute(
            select(PageVisit.user_id, func.count())
            .where(PageVisit.user_id.in_(user_ids))
            .group_by(PageVisit.user_id)
        ).all():
            if uid is not None:
                visits_by_user[uid] = int(n)

    items: list[AnalyticsUserItem] = []
    for u in users:
        answers, correct, incorrect, last_active = progress_by_user.get(u.id, (0, 0, 0, None))
        items.append(
            AnalyticsUserItem(
                id=u.id,
                email=u.email,
                display_name=u.display_name,
                is_admin=is_admin_email(u.email),
                created_at=u.created_at,
                answers_count=answers,
                correct_count=correct,
                incorrect_count=incorrect,
                reports_count=reports_by_user.get(u.id, 0),
                visits_count=visits_by_user.get(u.id, 0),
                last_active=last_active,
            )
        )

    return AnalyticsUsersResponse(total=total, items=items)
