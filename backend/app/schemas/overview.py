from datetime import date, datetime, time

from pydantic import Field

from app.schemas.plan import (
    APIModel,
    Difficulty,
    ExamPriority,
    PreparationLevel,
    ProgressStatus,
)


class OverviewSession(APIModel):
    plan_id: str
    session_id: str
    date: date
    start_time: time
    end_time: time
    subject: str
    topic: str
    topic_id: str
    duration_minutes: int
    progress_status: ProgressStatus
    actual_minutes: int | None
    is_current: bool


class OverviewTopic(APIModel):
    topic_id: str
    topic_name: str
    difficulty: Difficulty | None = None
    preparation_level: PreparationLevel | None = None
    estimated_hours: float | None = None
    source_plan_id: str
    sessions: list[OverviewSession] = Field(default_factory=list)


class OverviewSubject(APIModel):
    subject_name: str
    exam_date: date | None = None
    priority: ExamPriority | None = None
    source_plan_id: str
    topics: list[OverviewTopic] = Field(default_factory=list)


class OverviewPlan(APIModel):
    plan_id: str
    created_at: datetime
    updated_at: datetime
    session_count: int
    passed_feasibility: bool


class OverviewActivity(APIModel):
    plan_id: str
    node: str
    decision: str
    revision: int
    feedback: list[str]
    routed_to: str | None
    provider: str | None


class AcademicOverviewResponse(APIModel):
    total_plans: int
    total_scheduled_sessions: int
    completed_sessions: int
    partially_completed_sessions: int
    missed_sessions: int
    tracked_sessions: int
    completion_rate_percent: float
    recorded_study_minutes: int
    recent_plans: list[OverviewPlan]
    upcoming_sessions: list[OverviewSession]
    recent_agent_activity: list[OverviewActivity]
    subjects: list[OverviewSubject]
