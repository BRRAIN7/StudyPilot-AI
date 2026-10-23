import pytest
from fastapi.testclient import TestClient

from app.core.config import _load_settings
from app.main import app

client = TestClient(app)


def test_health_endpoint_reports_healthy() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_root_endpoint_returns_application_information() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {
        "name": "StudyPilot AI",
        "version": "0.1.0",
        "description": "An adaptive academic planning system for students.",
    }


def test_health_endpoint_allows_vite_development_origin() -> None:
    response = client.get(
        "/health",
        headers={"Origin": "http://localhost:5173"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_default_cors_allows_vite_localhost_variants(
    monkeypatch,
) -> None:
    monkeypatch.delenv("STUDYPILOT_CORS_ORIGINS", raising=False)

    assert _load_settings().cors_origins == (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )


def test_production_cors_uses_explicit_frontend_origins(monkeypatch) -> None:
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv(
        "STUDYPILOT_CORS_ORIGINS",
        "https://studypilot.example,https://preview.studypilot.example",
    )

    assert _load_settings().cors_origins == (
        "https://studypilot.example",
        "https://preview.studypilot.example",
    )


def test_cors_rejects_wildcard_origin(monkeypatch) -> None:
    monkeypatch.setenv("STUDYPILOT_CORS_ORIGINS", "*")

    with pytest.raises(ValueError, match="explicit origins"):
        _load_settings()
