from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect

from app.agents import graph as graph_module
from app.core import database as database_module
from app.main import app

TIMEZONE = ZoneInfo("Asia/Kolkata")


@pytest.fixture
def client(tmp_path):
    database_module.configure_database(
        f"sqlite:///{tmp_path.as_posix()}/study-test.db"
    )
    database_module.init_database()
    with TestClient(app) as test_client:
        yield test_client
    database_module.engine.dispose()


def payload() -> dict:
    return {
        "subjects": [
            {
                "id": "subject-1",
                "name": "Biology",
                "examDate": (
                    datetime.now(TIMEZONE).date() + timedelta(days=5)
                ).isoformat(),
                "priority": "Medium",
                "topics": [
                    {
                        "id": "topic-1",
                        "name": "Cell structure",
                        "difficulty": "Medium",
                        "preparationLevel": "Beginner",
                        "estimatedHours": 1,
                    }
                ],
            }
        ],
        "availableDays": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
        "hoursPerDay": 2,
        "preferredStartTime": "08:00",
        "preferredEndTime": "11:00",
        "sessionDurationMinutes": 60,
        "breakDurationMinutes": 10,
    }


def test_generate_plan_api_returns_structured_plan(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)

    response = client.post("/api/plan/generate", json=payload())

    assert response.status_code == 200
    body = response.json()
    assert body["schedule"]
    assert body["timezone"] == "Asia/Kolkata"
    assert body["topicPriorities"][0]["topicId"] == "topic-1"
    assert body["passedFeasibility"] is True
    assert body["agentMode"] == "deterministic_fallback"
    assert body["planId"]
    assert body["schedule"][0]["sessionId"]
    assert any(
        entry["node"] == "reviewer_agent" for entry in body["executionTrace"]
    )


def test_generate_plan_api_returns_validation_error_for_invalid_payload(
    client: TestClient,
) -> None:
    invalid = payload()
    invalid["hoursPerDay"] = 0

    response = client.post("/api/plan/generate", json=invalid)

    assert response.status_code == 422
    assert response.json()["detail"]


def test_plan_endpoint_allows_vite_post_preflight(client: TestClient) -> None:
    response = client.options(
        "/api/plan/generate",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "POST" in response.headers["access-control-allow-methods"]


def test_database_initializes_and_saved_plan_can_be_retrieved(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)
    names = set(inspect(database_module.engine).get_table_names())
    assert {"study_plans", "study_sessions", "session_progress_history"} <= names

    created = client.post("/api/plan/generate", json=payload()).json()
    retrieved = client.get(f"/api/plan/{created['planId']}")

    assert retrieved.status_code == 200
    assert retrieved.json()["planId"] == created["planId"]
    assert retrieved.json()["schedule"] == created["schedule"]


def test_progress_updates_validate_ids_and_preserve_update_history(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)
    saved = client.post("/api/plan/generate", json=payload()).json()
    plan_id = saved["planId"]
    session_id = saved["schedule"][0]["sessionId"]

    updated = client.patch(
        f"/api/plan/{plan_id}/sessions/{session_id}/progress",
        json={"status": "partially_completed", "actualMinutes": 15},
    )
    assert updated.status_code == 200
    session = next(
        item for item in updated.json()["schedule"] if item["sessionId"] == session_id
    )
    assert session["progressStatus"] == "partially_completed"
    assert session["actualMinutes"] == 15
    assert len(session["progressHistory"]) == 1

    assert client.get("/api/plan/unknown-plan").status_code == 404
    assert client.patch(
        f"/api/plan/{plan_id}/sessions/unknown-session/progress",
        json={"status": "missed"},
    ).status_code == 404
    assert client.patch(
        f"/api/plan/{plan_id}/sessions/{session_id}/progress",
        json={"status": "misspelled"},
    ).status_code == 422


def test_replanning_keeps_completed_sessions_and_records_real_agent_trace(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)
    request = payload()
    request["subjects"][0]["topics"][0]["estimatedHours"] = 2
    saved = client.post("/api/plan/generate", json=request).json()
    completed = saved["schedule"][0]

    progress = client.patch(
        f"/api/plan/{saved['planId']}/sessions/{completed['sessionId']}/progress",
        json={"status": "completed", "actualMinutes": 30},
    )
    assert progress.status_code == 200
    assert client.patch(
        f"/api/plan/{saved['planId']}/sessions/{completed['sessionId']}/progress",
        json={"status": "missed"},
    ).status_code == 409

    replanned = client.post(f"/api/plan/{saved['planId']}/replan")
    assert replanned.status_code == 200
    body = replanned.json()
    preserved = next(
        session
        for session in body["schedule"]
        if session["sessionId"] == completed["sessionId"]
    )
    assert preserved["progressStatus"] == "completed"
    assert preserved["actualMinutes"] == 30
    assert body["replanCount"] == 1
    assert sum(
        entry["node"] == "priority_agent" for entry in body["executionTrace"]
    ) >= 2
    assert any(
        entry["node"] == "revision_router" for entry in body["executionTrace"]
    )
    assert sum(
        session["sessionId"] == completed["sessionId"]
        for session in body["schedule"]
    ) == 1
    assert all(
        session["endTime"] <= completed["startTime"]
        or session["startTime"] >= completed["endTime"]
        for session in body["schedule"]
        if session["sessionId"] != completed["sessionId"]
        and session["date"] == completed["date"]
    )


def test_missed_session_replanning_reports_insufficient_remaining_time(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)
    request = payload()
    request["subjects"][0]["examDate"] = (
        datetime.now(TIMEZONE).date() + timedelta(days=1)
    ).isoformat()
    request["subjects"][0]["topics"][0]["estimatedHours"] = 5
    request["hoursPerDay"] = 1
    request["preferredEndTime"] = "09:00"
    request["sessionDurationMinutes"] = 60
    saved = client.post("/api/plan/generate", json=request).json()
    assert saved["schedule"]
    missed = saved["schedule"][0]
    client.patch(
        f"/api/plan/{saved['planId']}/sessions/{missed['sessionId']}/progress",
        json={"status": "missed"},
    )

    response = client.post(f"/api/plan/{saved['planId']}/replan")
    assert response.status_code == 200
    result = response.json()
    assert result["passedFeasibility"] is False
    assert any(
        item["code"] == "insufficient_study_time"
        for item in result["feasibility"]["findings"]
    )
    assert any(
        session["sessionId"] == missed["sessionId"]
        and session["progressStatus"] == "missed"
        and not session["isCurrent"]
        for session in result["schedule"]
    )


def test_progress_analytics_reflect_saved_outcomes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)
    saved = client.post("/api/plan/generate", json=payload()).json()
    session = saved["schedule"][0]
    client.patch(
        f"/api/plan/{saved['planId']}/sessions/{session['sessionId']}/progress",
        json={"status": "completed", "actualMinutes": 25},
    )

    response = client.get("/api/progress/analytics")
    assert response.status_code == 200
    metrics = response.json()
    assert metrics["totalPlans"] == 1
    assert metrics["completedSessions"] == 1
    assert metrics["recordedStudyMinutes"] == 25
    assert metrics["completionRatePercent"] == 100
