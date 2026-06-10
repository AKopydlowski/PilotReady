# PilotReady
# Copyright (c) 2026 PilotReady. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
#
# NOTE: licensing stub - to be reviewed/refined later.

"""Authentication endpoints: register, login, and "who am I".

Accounts are email + password. Passwords are hashed with bcrypt before they ever
touch the database (see ``backend.security``); a successful register/login hands
back a signed JWT the SPA stores and sends as ``Authorization: Bearer <token>``
on every subsequent request.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.database import get_session
from backend.models import User
from backend.security import (
    create_access_token,
    get_current_user_id,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class RegisterRequest(BaseModel):
    email: EmailStr
    # 8–128 chars. bcrypt only reads the first 72 bytes, which is plenty.
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    display_name: str | None = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, session: Annotated[Session, Depends(get_session)]) -> AuthResponse:
    email = payload.email.strip().lower()

    existing = session.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=(payload.display_name or None),
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    return AuthResponse(
        access_token=create_access_token(user.id),
        user=UserResponse(id=user.id, email=user.email, display_name=user.display_name),
    )


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, session: Annotated[Session, Depends(get_session)]) -> AuthResponse:
    email = payload.email.strip().lower()
    user = session.scalar(select(User).where(User.email == email))

    # Always run a verify (even when the user is missing or has no usable hash)
    # so timing does not reveal whether an email exists.
    password_ok = verify_password(payload.password, user.password_hash if user else "")
    if user is None or not user.password_hash or not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    return AuthResponse(
        access_token=create_access_token(user.id),
        user=UserResponse(id=user.id, email=user.email, display_name=user.display_name),
    )


@router.get("/me", response_model=UserResponse)
def me(
    current_user_id: Annotated[uuid.UUID, Depends(get_current_user_id)],
    session: Annotated[Session, Depends(get_session)],
) -> UserResponse:
    user = session.get(User, current_user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists")
    return UserResponse(id=user.id, email=user.email, display_name=user.display_name)
