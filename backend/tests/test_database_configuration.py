from sqlalchemy import text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateTable

from app.core.config import _load_settings
from app.core.database import _create_engine
from app.models.persistence import Base


def test_postgresql_connection_string_is_read_from_environment(monkeypatch) -> None:
    database_url = (
        "postgresql://study_user:replace_me@db.example.invalid:5432/postgres"
        "?sslmode=require"
    )
    monkeypatch.setenv("STUDYPILOT_DATABASE_URL", database_url)

    assert _load_settings().database_url == database_url


def test_postgresql_engine_accepts_standard_and_legacy_urls() -> None:
    for database_url in (
        "postgresql://study_user:replace_me@db.example.invalid:5432/postgres"
        "?sslmode=require",
        "postgres://study_user:replace_me@db.example.invalid:5432/postgres"
        "?sslmode=require",
    ):
        engine = _create_engine(database_url)
        session = None
        try:
            assert engine.dialect.name == "postgresql"
            assert engine.url.database == "postgres"
            assert engine.url.query["sslmode"] == "require"
            session = sessionmaker(bind=engine)()
            assert session.get_bind().dialect.name == "postgresql"
            for table in Base.metadata.sorted_tables:
                assert str(CreateTable(table).compile(dialect=engine.dialect))
        finally:
            if session is not None:
                session.close()
            engine.dispose()


def test_sqlite_engine_remains_usable_for_local_development() -> None:
    engine = _create_engine("sqlite://")
    try:
        assert engine.dialect.name == "sqlite"
        with engine.connect() as connection:
            assert connection.execute(text("SELECT 1")).scalar_one() == 1
    finally:
        engine.dispose()
