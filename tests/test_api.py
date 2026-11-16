# PilotReady
# Copyright (c) 2026 Aleksander Kopydłowski. All rights reserved.
# Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""API integration tests (auth, study progress, exam engine).

They need a real PostgreSQL database that is safe to write to, so they only run
when ``TEST_DATABASE_URL`` points at one — the ``DATABASE_URL`` from ``.env`` is
never used, which keeps a production database out of reach:

    TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/pilotready_test pytest

The database must already hold the question bank (``scripts/seed_db.py``).
"""

from __future__ import annotations

import os
import uuid

import pytest

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not set")


@pytest.fixture(scope="module")
def client():
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL or ""
    os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production-use-0123456789")

    from fastapi.testclient import TestClient

    from backend.main import app
    from backend.ratelimit import limiter

    limiter.enabled = False  # the suite registers and logs in far faster than a human
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def auth(client) -> dict[str, str]:
    email = f"test-{uuid.uuid4().hex[:12]}@example.com"
    response = client.post("/api/auth/register", json={"email": email, "password": "correct-horse-battery"})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_endpoints_require_authentication(client) -> None:
    assert client.get("/api/categories").status_code == 401
    assert client.post("/api/exam/start").status_code == 401
    assert client.get("/api/exam/history").status_code == 401


def test_login_rejects_wrong_password_and_unknown_email(client) -> None:
    email = f"login-{uuid.uuid4().hex[:12]}@example.com"
    assert client.post("/api/auth/register", json={"email": email, "password": "correct-horse-battery"}).status_code == 201
    assert client.post("/api/auth/login", json={"email": email, "password": "correct-horse-battery"}).status_code == 200
    wrong = client.post("/api/auth/login", json={"email": email, "password": "nope-nope-nope"})
    unknown = client.post("/api/auth/login", json={"email": "nobody-" + email, "password": "nope-nope-nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()  # no hint about which emails exist


def test_categories_cover_the_whole_bank(client, auth) -> None:
    categories = client.get("/api/categories", headers=auth).json()
    assert len(categories) == 10
    assert sum(category["total"] for category in categories) == 2053
    assert all(category["correct"] == 0 and category["incorrect"] == 0 for category in categories)


def test_questions_are_served_compressed(client, auth) -> None:
    response = client.get("/api/questions/AIR_LAW", headers={**auth, "Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers.get("content-encoding") == "gzip"
    assert len(response.json()) > 100


def test_progress_is_graded_by_the_server(client, auth) -> None:
    question = client.get("/api/questions/COMMUNICATIONS", headers=auth).json()[0]
    wrong_text = next(answer["text"] for answer in question["answers"] if answer["text"] != question["correct_answer"])

    # A client claiming CORRECT while sending a wrong answer is not believed.
    response = client.post(
        "/api/progress",
        headers=auth,
        json={"question_id": question["id"], "selected_text": wrong_text, "status": "CORRECT"},
    )
    assert response.status_code == 200 and response.json()["status"] == "INCORRECT"
    mistakes = client.get("/api/mistakes?category=COMMUNICATIONS", headers=auth).json()
    assert [item["id"] for item in mistakes] == [question["id"]]

    response = client.post(
        "/api/progress", headers=auth, json={"question_id": question["id"], "selected_text": question["correct_answer"]}
    )
    assert response.json()["status"] == "CORRECT" and response.json()["attempts_count"] == 2
    assert client.get("/api/mistakes?category=COMMUNICATIONS", headers=auth).json() == []

    # Legacy payload (status only) still works; an empty one is rejected.
    assert client.post("/api/progress", headers=auth, json={"question_id": question["id"], "status": "correct"}).status_code == 200
    assert client.post("/api/progress", headers=auth, json={"question_id": question["id"]}).status_code == 422
    assert client.post("/api/progress", headers=auth, json={"question_id": str(uuid.uuid4()), "status": "CORRECT"}).status_code == 404


def test_exam_follows_the_ulc_blueprint_and_hides_answers(client, auth) -> None:
    exam = client.post("/api/exam/start", headers=auth).json()
    assert exam["total_questions"] == 120
    assert exam["total_duration_minutes"] == 230
    assert [section["question_count"] for section in exam["sections"]] == [16, 12, 12, 12, 16, 16, 12, 12, 12]
    assert exam["deadline_at"] > exam["started_at"]
    for section in exam["sections"]:
        for question in section["questions"]:
            assert set(question) == {"id", "external_id", "category", "question_text", "answers"}
            assert [answer["key"] for answer in question["answers"]] == ["A", "B", "C", "D"]
            assert all(set(answer) == {"key", "text"} for answer in question["answers"])


def test_exam_grades_the_whole_paper_and_records_history(client, auth) -> None:
    exam = client.post("/api/exam/start", headers=auth).json()
    questions = [question for section in exam["sections"] for question in section["questions"]]

    # Submitting a single answer must not shrink the paper to one question.
    partial = client.post(
        "/api/exam/submit",
        headers=auth,
        json={"exam_id": exam["exam_id"], "answers": [{"question_id": questions[0]["id"], "selected_text": "x"}]},
    ).json()
    assert partial["total_questions"] == 120
    assert partial["passed"] is False
    assert partial["total_correct"] == 0
    assert sum(1 for result in partial["results"] if result["answered"]) == 1

    # The same paper cannot be graded twice.
    again = client.post("/api/exam/submit", headers=auth, json={"exam_id": exam["exam_id"], "answers": []})
    assert again.status_code == 409

    # The verdict reveals correct answers, so a second paper can be aced.
    exam = client.post("/api/exam/start", headers=auth).json()
    questions = [question for section in exam["sections"] for question in section["questions"]]
    probe = client.post(
        "/api/exam/submit",
        headers=auth,
        json={"answers": [{"question_id": question["id"], "selected_text": None} for question in questions]},
    ).json()  # no exam_id -> stateless grading, leaves the recorded attempt open
    key = {result["question_id"]: result["correct_answer"] for result in probe["results"]}
    perfect = client.post(
        "/api/exam/submit",
        headers=auth,
        json={
            "exam_id": exam["exam_id"],
            "answers": [{"question_id": question["id"], "selected_text": key[question["id"]]} for question in questions],
        },
    ).json()
    assert perfect["passed"] is True
    assert perfect["total_correct"] == 120
    assert all(section["passed"] and section["score_percent"] == 100.0 for section in perfect["sections"])

    history = client.get("/api/exam/history", headers=auth).json()
    assert history["taken"] == 2 and history["passed"] == 1
    assert history["best_score_percent"] == 100.0
    assert [item["passed"] for item in history["items"]] == [True, False]
    assert len(history["items"][0]["sections"]) == 9

    # Exam answers feed study progress: 120 questions are now mastered.
    categories = client.get("/api/categories", headers=auth).json()
    assert sum(category["correct"] for category in categories) >= 120


def test_another_users_exam_cannot_be_submitted(client, auth) -> None:
    exam = client.post("/api/exam/start", headers=auth).json()
    other_email = f"other-{uuid.uuid4().hex[:12]}@example.com"
    token = client.post("/api/auth/register", json={"email": other_email, "password": "correct-horse-battery"}).json()["access_token"]
    other = {"Authorization": f"Bearer {token}"}

    response = client.post("/api/exam/submit", headers=other, json={"exam_id": exam["exam_id"], "answers": []}).json()
    assert response["total_questions"] == 0  # treated as an unknown paper, nothing graded
    assert client.get("/api/exam/history", headers=other).json()["taken"] == 0
    # ...and the owner's attempt is still open.
    assert client.post("/api/exam/submit", headers=auth, json={"exam_id": exam["exam_id"], "answers": []}).status_code == 200
