from datetime import datetime, timezone
from math import ceil
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.persistence import PlanRecord, ProgressUpdate, SessionRecord
from app.schemas.plan import (
    PersistedStudySession,
    AgentActivityPlan,
    AgentActivityResponse,
    PlanResponse,
    PlanSummary,
    ProgressAnalyticsResponse,
    ProgressHistoryEntry,
    ProgressUpdateRequest,
    SavedPlanResponse,
    StudyPlanRequest,
    StudySession,
    TopicInput,
)


class PlanNotFoundError(LookupError):
    pass


class SessionNotFoundError(LookupError):
    pass


class ProgressConflictError(ValueError):
    pass


def _new_session(plan_id: str, session: StudySession) -> SessionRecord:
    return SessionRecord(
        plan_id=plan_id,
        date=session.date,
        start_time=session.start_time,
        end_time=session.end_time,
        subject_id=session.subject_id,
        subject=session.subject,
        topic_id=session.topic_id,
        topic=session.topic,
        duration_minutes=session.duration_minutes,
    )


def _session_response(record: SessionRecord) -> PersistedStudySession:
    return PersistedStudySession(
        session_id=record.id,
        date=record.date,
        start_time=record.start_time,
        end_time=record.end_time,
        subject_id=record.subject_id,
        subject=record.subject,
        topic_id=record.topic_id,
        topic=record.topic,
        duration_minutes=record.duration_minutes,
        progress_status=record.progress_status,
        actual_minutes=record.actual_minutes,
        is_current=record.is_current,
        progress_history=[
            ProgressHistoryEntry(
                status=event.progress_status,
                actual_minutes=event.actual_minutes,
                recorded_at=event.recorded_at,
            )
            for event in record.progress_history
        ],
    )


def _saved_plan(database: Session, record: PlanRecord) -> SavedPlanResponse:
    result = PlanResponse.model_validate(record.result_data)
    stored_sessions = database.scalars(
        select(SessionRecord)
        .where(
            SessionRecord.plan_id == record.id,
            (SessionRecord.is_current.is_(True))
            | (SessionRecord.progress_status != "scheduled"),
        )
        .order_by(SessionRecord.date, SessionRecord.start_time, SessionRecord.id)
    ).all()
    result_data = result.model_dump()
    result_data.update(
        {
            "plan_id": record.id,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
            "replan_count": record.replan_count,
            "schedule": [_session_response(session) for session in stored_sessions],
        }
    )
    return SavedPlanResponse.model_validate(result_data)


def save_plan(
    database: Session, request: StudyPlanRequest, result: PlanResponse
) -> SavedPlanResponse:
    record = PlanRecord(
        id=str(uuid4()),
        input_data=request.model_dump(mode="json", by_alias=True),
        result_data=result.model_dump(mode="json"),
        revision_count=result.revision_count,
    )
    record.sessions = [_new_session(record.id, session) for session in result.schedule]
    database.add(record)
    database.commit()
    database.refresh(record)
    return _saved_plan(database, record)


def retrieve_plan(database: Session, plan_id: str) -> SavedPlanResponse:
    record = database.get(PlanRecord, plan_id)
    if record is None:
        raise PlanNotFoundError(plan_id)
    return _saved_plan(database, record)


def update_session_progress(
    database: Session,
    plan_id: str,
    session_id: str,
    update: ProgressUpdateRequest,
) -> SavedPlanResponse:
    record = database.get(PlanRecord, plan_id)
    if record is None:
        raise PlanNotFoundError(plan_id)
    session_record = database.scalar(
        select(SessionRecord).where(
            SessionRecord.id == session_id,
            SessionRecord.plan_id == plan_id,
        )
    )
    if session_record is None:
        raise SessionNotFoundError(session_id)
    if session_record.progress_status == "completed":
        raise ProgressConflictError("Completed sessions cannot be changed.")
    if not session_record.is_current:
        raise ProgressConflictError(
            "This session is no longer part of the current schedule."
        )
    if (
        update.status == "partially_completed"
        and update.actual_minutes is not None
        and update.actual_minutes >= session_record.duration_minutes
    ):
        raise ProgressConflictError(
            "Partially completed time must be less than the scheduled duration."
        )

    session_record.progress_status = update.status
    session_record.actual_minutes = update.actual_minutes
    session_record.progress_history.append(
        ProgressUpdate(
            progress_status=update.status,
            actual_minutes=update.actual_minutes,
        )
    )
    record.updated_at = datetime.now(timezone.utc)
    database.commit()
    database.refresh(record)
    return _saved_plan(database, record)


def request_for_replanning(
    database: Session, record: PlanRecord
) -> StudyPlanRequest:
    request = StudyPlanRequest.model_validate(
        record.input_data, context={"allow_past_exam_dates": True}
    )
    sessions = database.scalars(
        select(SessionRecord).where(SessionRecord.plan_id == record.id)
    ).all()
    tracked_minutes = _tracked_minutes_by_topic(sessions)
    subject_topics: dict[int, list[TopicInput]] = {}
    for subject_index, subject in enumerate(request.subjects):
        for topic_index, topic in enumerate(subject.topics):
            topic_id = topic.id or (
                f"{subject.id or f'subject-{subject_index + 1}'}"
                f"-topic-{topic_index + 1}"
            )
            tracked = tracked_minutes.get(topic_id, 0)
            completed_minutes = ceil(topic.completed_hours * 60)
            completed_minutes = min(
                ceil(topic.estimated_hours * 60), completed_minutes + tracked
            )
            updated_topic = topic.model_copy(
                update={"completed_hours": completed_minutes / 60}
            )
            subject_topics.setdefault(subject_index, []).append(updated_topic)

    subjects = [
        subject.model_copy(update={"topics": subject_topics[index]})
        for index, subject in enumerate(request.subjects)
    ]
    return request.model_copy(update={"subjects": subjects})


def _tracked_minutes_by_topic(sessions: list[SessionRecord]) -> dict[str, int]:
    tracked_minutes: dict[str, int] = {}
    for session_record in sessions:
        if session_record.progress_status == "completed":
            minutes = (
                session_record.actual_minutes
                if session_record.actual_minutes is not None
                else session_record.duration_minutes
            )
        elif session_record.progress_status == "partially_completed":
            minutes = session_record.actual_minutes or 0
        else:
            minutes = 0
        tracked_minutes[session_record.topic_id] = (
            tracked_minutes.get(session_record.topic_id, 0) + minutes
        )
    return tracked_minutes


def persist_replan(
    database: Session, record: PlanRecord, result: PlanResponse
) -> SavedPlanResponse:
    existing_trace = list(record.result_data.get("execution_trace", []))
    result_data = result.model_dump(mode="json")
    result_data["execution_trace"] = [*existing_trace, *result_data["execution_trace"]]
    result_data["agent_mode"] = (
        "groq"
        if any(entry.get("provider") == "groq" for entry in result_data["execution_trace"])
        else "deterministic_fallback"
    )
    record.revision_count += result.revision_count
    result_data["revision_count"] = record.revision_count
    record.result_data = result_data
    record.replan_count += 1
    record.updated_at = datetime.now(timezone.utc)

    existing_sessions = database.scalars(
        select(SessionRecord).where(SessionRecord.plan_id == record.id)
    ).all()
    for session_record in existing_sessions:
        if session_record.is_current and session_record.progress_status != "completed":
            session_record.is_current = False
    record.sessions.extend(
        _new_session(record.id, session) for session in result.schedule
    )
    database.commit()
    database.refresh(record)
    return _saved_plan(database, record)


def replan_saved_plan(database: Session, plan_id: str) -> SavedPlanResponse:
    record = database.get(PlanRecord, plan_id)
    if record is None:
        raise PlanNotFoundError(plan_id)
    request = request_for_replanning(database, record)
    from app.agents.graph import generate_plan

    completed_sessions = database.scalars(
        select(SessionRecord).where(
            SessionRecord.plan_id == record.id,
            SessionRecord.progress_status == "completed",
        )
    ).all()
    reserved_sessions = [
        StudySession(
            date=session.date,
            start_time=session.start_time,
            end_time=session.end_time,
            subject_id=session.subject_id,
            subject=session.subject,
            topic_id=session.topic_id,
            topic=session.topic,
            duration_minutes=session.duration_minutes,
        )
        for session in completed_sessions
    ]
    result = generate_plan(request, reserved_sessions=reserved_sessions)
    return persist_replan(database, record, result)


def get_progress_analytics(database: Session) -> ProgressAnalyticsResponse:
    plans = database.scalars(
        select(PlanRecord).order_by(PlanRecord.updated_at.desc())
    ).all()
    sessions = database.scalars(
        select(SessionRecord).where(SessionRecord.is_current.is_(True))
    ).all()
    all_sessions = database.scalars(select(SessionRecord)).all()
    tracked = [
        session for session in all_sessions if session.progress_status != "scheduled"
    ]
    completed = sum(session.progress_status == "completed" for session in tracked)
    partially_completed = sum(
        session.progress_status == "partially_completed" for session in tracked
    )
    missed = sum(session.progress_status == "missed" for session in tracked)
    return ProgressAnalyticsResponse(
        total_plans=len(plans),
        total_sessions=len(sessions),
        tracked_sessions=len(tracked),
        completed_sessions=completed,
        partially_completed_sessions=partially_completed,
        missed_sessions=missed,
        recorded_study_minutes=sum(
            session.actual_minutes or 0 for session in tracked
        ),
        completion_rate_percent=(
            round(completed / len(tracked) * 100, 1) if tracked else 0
        ),
        recent_plans=[
            PlanSummary(
                plan_id=plan.id,
                created_at=plan.created_at,
                updated_at=plan.updated_at,
                session_count=sum(
                    session.is_current for session in plan.sessions
                ),
                passed_feasibility=bool(
                    plan.result_data.get("passed_feasibility", False)
                ),
            )
            for plan in plans[:10]
        ],
    )


def get_agent_activity(database: Session) -> AgentActivityResponse:
    records = database.scalars(
        select(PlanRecord).order_by(PlanRecord.created_at.desc()).limit(50)
    ).all()
    plans = []
    for record in records:
        result = PlanResponse.model_validate(record.result_data)
        plans.append(
            AgentActivityPlan(
                plan_id=record.id,
                created_at=record.created_at,
                updated_at=record.updated_at,
                agent_mode=result.agent_mode,
                execution_trace=result.execution_trace,
            )
        )
    return AgentActivityResponse(plans=plans)
