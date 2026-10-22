from datetime import date as Date
from datetime import datetime, time
from enum import StrEnum
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.config import settings


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class APIModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class Difficulty(StrEnum):
    EASY = "Easy"
    MEDIUM = "Medium"
    HARD = "Hard"


class PreparationLevel(StrEnum):
    NOT_STARTED = "Not Started"
    BEGINNER = "Beginner"
    INTERMEDIATE = "Intermediate"
    WELL_PREPARED = "Well Prepared"


class ExamPriority(StrEnum):
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"


class Weekday(StrEnum):
    MONDAY = "monday"
    TUESDAY = "tuesday"
    WEDNESDAY = "wednesday"
    THURSDAY = "thursday"
    FRIDAY = "friday"
    SATURDAY = "saturday"
    SUNDAY = "sunday"


class TopicInput(APIModel):
    id: str | None = Field(default=None, min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    difficulty: Difficulty
    preparation_level: PreparationLevel
    estimated_hours: float = Field(ge=0.25, le=100)
    completed_hours: float = Field(default=0, ge=0, le=100)

    @field_validator("name")
    @classmethod
    def topic_name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Topic name must not be blank.")
        return value

    @field_validator("id")
    @classmethod
    def topic_id_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("Topic ID must not be blank.")
        return value

    @model_validator(mode="after")
    def completed_hours_must_not_exceed_estimate(self) -> "TopicInput":
        if self.completed_hours > self.estimated_hours:
            raise ValueError("Completed hours cannot exceed estimated study hours.")
        return self


class SubjectInput(APIModel):
    id: str | None = Field(default=None, min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    exam_date: Date
    priority: ExamPriority
    topics: list[TopicInput] = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def subject_name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Subject name must not be blank.")
        return value

    @field_validator("id")
    @classmethod
    def subject_id_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("Subject ID must not be blank.")
        return value

    @field_validator("exam_date")
    @classmethod
    def exam_date_must_not_be_in_the_past(cls, value: Date) -> Date:
        today = datetime.now(ZoneInfo(settings.timezone)).date()
        if value < today:
            raise ValueError("Exam date cannot be in the past.")
        return value


class StudyPlanRequest(APIModel):
    subjects: list[SubjectInput] = Field(min_length=1, max_length=30)
    available_days: list[Weekday] = Field(min_length=1)
    hours_per_day: float = Field(ge=1, le=16)
    preferred_start_time: time
    preferred_end_time: time
    session_duration_minutes: int = Field(ge=15, le=240)
    break_duration_minutes: int = Field(ge=0, le=120)

    @field_validator("available_days")
    @classmethod
    def available_days_must_be_unique(
        cls, value: list[Weekday]
    ) -> list[Weekday]:
        if len(value) != len(set(value)):
            raise ValueError("Available days must not contain duplicates.")
        return value

    @model_validator(mode="after")
    def validate_time_window(self) -> "StudyPlanRequest":
        if self.preferred_end_time <= self.preferred_start_time:
            raise ValueError("Preferred end time must be later than start time.")

        window_minutes = (
            self.preferred_end_time.hour * 60
            + self.preferred_end_time.minute
            - self.preferred_start_time.hour * 60
            - self.preferred_start_time.minute
        )
        if self.hours_per_day * 60 > window_minutes:
            raise ValueError(
                "Maximum study hours per day cannot exceed the preferred time window."
            )
        if self.session_duration_minutes > self.hours_per_day * 60:
            raise ValueError(
                "Session duration cannot exceed maximum study hours per day."
            )
        subject_ids = [
            subject.id or f"subject-{subject_index + 1}"
            for subject_index, subject in enumerate(self.subjects)
        ]
        if len(subject_ids) != len(set(subject_ids)):
            raise ValueError("Subject IDs must be unique.")
        topic_ids = [
            topic.id or f"{subject_id}-topic-{topic_index + 1}"
            for subject_id, subject in zip(subject_ids, self.subjects)
            for topic_index, topic in enumerate(subject.topics)
        ]
        if len(topic_ids) != len(set(topic_ids)):
            raise ValueError("Topic IDs must be unique.")
        return self

    @field_validator("preferred_start_time", "preferred_end_time")
    @classmethod
    def preferred_times_use_minute_precision(cls, value: time) -> time:
        if value.second or value.microsecond:
            raise ValueError("Preferred times must use minute precision.")
        return value


class TopicPriority(APIModel):
    topic_id: str
    subject_id: str
    topic_name: str
    subject_name: str
    exam_date: Date
    priority_score: float
    rank: int
    explanation: str


class StudySession(APIModel):
    date: Date
    start_time: time
    end_time: time
    subject_id: str
    subject: str
    topic_id: str
    topic: str
    duration_minutes: int = Field(gt=0)


class TopicCoverage(APIModel):
    subject_id: str
    subject: str
    topic_id: str
    topic: str
    estimated_minutes: int
    completed_minutes: int
    scheduled_minutes: int
    remaining_minutes: int


class FeasibilityFinding(APIModel):
    code: str
    severity: Literal["error", "warning", "info"]
    message: str
    topic_id: str | None = None
    date: Date | None = None


class FeasibilityReport(APIModel):
    passed: bool
    findings: list[FeasibilityFinding]
    coverage: list[TopicCoverage]


class ReviewerDecision(APIModel):
    approved: bool
    rationale: str
    feedback: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PriorityAgentInput(APIModel):
    request: StudyPlanRequest
    as_of: Date


class PriorityAgentOutput(APIModel):
    priorities: list[TopicPriority]


class PriorityExplanation(APIModel):
    topic_id: str
    explanation: str = Field(min_length=1, max_length=500)


class PriorityExplanationOutput(APIModel):
    explanations: list[PriorityExplanation]


class PlannerAgentInput(APIModel):
    request: StudyPlanRequest
    priorities: list[TopicPriority]
    revision: int
    revision_feedback: list[str]
    revision_focus_topic_ids: list[str]
    as_of: Date
    now: datetime


class PlannerAgentOutput(APIModel):
    schedule: list[StudySession]


class PlannerAdviceOutput(APIModel):
    focus_topic_ids: list[str] = Field(default_factory=list)
    rationale: str = Field(min_length=1, max_length=500)


class FeasibilityAgentInput(APIModel):
    request: StudyPlanRequest
    priorities: list[TopicPriority]
    schedule: list[StudySession]
    as_of: Date


class ReviewerAgentInput(APIModel):
    request: StudyPlanRequest
    priorities: list[TopicPriority]
    schedule: list[StudySession]
    feasibility: FeasibilityReport
    revision: int


class AgentTraceEntry(APIModel):
    node: str
    decision: str
    revision: int
    feedback: list[str] = Field(default_factory=list)
    routed_to: str | None = None
    provider: str | None = None


class PlanResponse(APIModel):
    timezone: str = settings.timezone
    schedule: list[StudySession]
    topic_priorities: list[TopicPriority]
    feasibility: FeasibilityReport
    reviewer_feedback: ReviewerDecision
    revision_count: int
    passed_feasibility: bool
    warnings: list[str]
    agent_mode: Literal["groq", "deterministic_fallback"]
    execution_trace: list[AgentTraceEntry]
