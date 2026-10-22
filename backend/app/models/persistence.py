from datetime import date, datetime, time, timezone
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, JSON, String, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _new_id() -> str:
    return str(uuid4())


class PlanRecord(Base):
    __tablename__ = "study_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    input_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    result_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    replan_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revision_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    sessions: Mapped[list["SessionRecord"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan"
    )


class SessionRecord(Base):
    __tablename__ = "study_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    plan_id: Mapped[str] = mapped_column(
        ForeignKey("study_plans.id", ondelete="CASCADE"), index=True, nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    subject_id: Mapped[str] = mapped_column(String(100), nullable=False)
    subject: Mapped[str] = mapped_column(String(120), nullable=False)
    topic_id: Mapped[str] = mapped_column(String(100), nullable=False)
    topic: Mapped[str] = mapped_column(String(120), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    progress_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="scheduled"
    )
    actual_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    plan: Mapped[PlanRecord] = relationship(back_populates="sessions")
    progress_history: Mapped[list["ProgressUpdate"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by=lambda: (ProgressUpdate.recorded_at, ProgressUpdate.id),
    )


class ProgressUpdate(Base):
    __tablename__ = "session_progress_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("study_sessions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    progress_status: Mapped[str] = mapped_column(String(32), nullable=False)
    actual_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    session: Mapped[SessionRecord] = relationship(back_populates="progress_history")
