import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    app_name: str = "StudyPilot AI"
    app_version: str = "0.1.0"
    app_description: str = "An adaptive academic planning system for students."
    cors_origins: tuple[str, ...] = ("http://localhost:5173",)


def _load_settings() -> Settings:
    configured_origins = os.getenv("STUDYPILOT_CORS_ORIGINS")
    if not configured_origins:
        return Settings()

    origins = tuple(
        origin.strip()
        for origin in configured_origins.split(",")
        if origin.strip()
    )
    return Settings(cors_origins=origins)


settings = _load_settings()
