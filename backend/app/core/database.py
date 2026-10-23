from collections.abc import Generator

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def _create_engine(database_url: str) -> Engine:
    normalized_url = (
        "postgresql://" + database_url.removeprefix("postgres://")
        if database_url.startswith("postgres://")
        else database_url
    )
    parsed_url = make_url(normalized_url)
    options = (
        {"connect_args": {"check_same_thread": False}}
        if parsed_url.get_backend_name() == "sqlite"
        else {"pool_pre_ping": True}
    )
    return create_engine(normalized_url, **options)


engine = _create_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def configure_database(database_url: str) -> None:
    global engine, SessionLocal
    engine.dispose()
    engine = _create_engine(database_url)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_database() -> None:
    from app.models.persistence import Base as ModelBase

    ModelBase.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    database = SessionLocal()
    try:
        yield database
    finally:
        database.close()
