from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.agents import graph as graph_module
from app.main import app

client = TestClient(app)
TIMEZONE = ZoneInfo("Asia/Kolkata")


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
    monkeypatch,
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
    assert any(
        entry["node"] == "reviewer_agent" for entry in body["executionTrace"]
    )


def test_generate_plan_api_returns_validation_error_for_invalid_payload() -> None:
    invalid = payload()
    invalid["hoursPerDay"] = 0

    response = client.post("/api/plan/generate", json=invalid)

    assert response.status_code == 422
    assert response.json()["detail"]


def test_plan_endpoint_allows_vite_post_preflight() -> None:
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
