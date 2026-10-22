import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    app_name: str = "StudyPilot AI"
    app_version: str = "0.1.0"
    app_description: str = "An adaptive academic planning system for students."
    cors_origins: tuple[str, ...] = ("http://localhost:5173",)
    timezone: str = "Asia/Kolkata"
    database_url: str = "sqlite:///./studypilot.db"
    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"


def _load_settings() -> Settings:
    configured_origins = os.getenv("STUDYPILOT_CORS_ORIGINS")
    origins = (
        tuple(
            origin.strip()
            for origin in configured_origins.split(",")
            if origin.strip()
        )
        if configured_origins
        else ("http://localhost:5173",)
    )
    return Settings(
        cors_origins=origins,
        database_url=os.getenv(
            "STUDYPILOT_DATABASE_URL", "sqlite:///./studypilot.db"
        ),
        groq_api_key=os.getenv("GROQ_API_KEY") or None,
        groq_model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
    )


def get_settings() -> Settings:
    return _load_settings()


settings = get_settings()
