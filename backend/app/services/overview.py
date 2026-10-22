from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.persistence import PlanRecord, SessionRecord
from app.schemas.overview import (
    AcademicOverviewResponse,
    OverviewActivity,
    OverviewPlan,
    OverviewSession,
    OverviewSubject,
    OverviewTopic,
)
from app.schemas.plan import AgentTraceEntry
from app.services.scheduling import local_now


def _value(data: dict, camel: str, snake: str, default=None):
    return data.get(camel, data.get(snake, default))


def _normal(value: str) -> str:
    return " ".join(value.split()).casefold()


def _overview_session(record: SessionRecord) -> OverviewSession:
    return OverviewSession(
        plan_id=record.plan_id,
        session_id=record.id,
        date=record.date,
        start_time=record.start_time,
        end_time=record.end_time,
        subject=record.subject,
        topic=record.topic,
        topic_id=record.topic_id,
        duration_minutes=record.duration_minutes,
        progress_status=record.progress_status,
        actual_minutes=record.actual_minutes,
        is_current=record.is_current,
    )


def get_academic_overview(database: Session) -> AcademicOverviewResponse:
    plans = database.scalars(
        select(PlanRecord).order_by(PlanRecord.updated_at.desc())
    ).all()
    sessions = database.scalars(
        select(SessionRecord).order_by(
            SessionRecord.date, SessionRecord.start_time, SessionRecord.id
        )
    ).all()
    sessions_by_plan: dict[str, list[SessionRecord]] = {}
    sessions_by_topic: dict[tuple[str, str], list[OverviewSession]] = {}
    unique_sessions = {session.id: session for session in sessions}
    for session in unique_sessions.values():
        sessions_by_plan.setdefault(session.plan_id, []).append(session)
        topic_key = (_normal(session.subject), _normal(session.topic))
        sessions_by_topic.setdefault(topic_key, []).append(_overview_session(session))

    subjects_by_name: dict[str, dict] = {}
    for plan in plans:
        input_data = plan.input_data if isinstance(plan.input_data, dict) else {}
        subject_data = _value(input_data, "subjects", "subjects", [])
        if not isinstance(subject_data, list):
            continue
        for subject_index, raw_subject in enumerate(subject_data):
            if not isinstance(raw_subject, dict):
                continue
            subject_name = _value(raw_subject, "name", "name")
            if not isinstance(subject_name, str) or not subject_name.strip():
                continue
            subject_name = subject_name.strip()
            subject_key = _normal(subject_name)
            if subject_key not in subjects_by_name:
                subjects_by_name[subject_key] = {
                    "name": subject_name,
                    "exam_date": _value(raw_subject, "examDate", "exam_date"),
                    "priority": _value(raw_subject, "priority", "priority"),
                    "source_plan_id": plan.id,
                    "topics": {},
                }
            subject = subjects_by_name[subject_key]
            raw_topics = _value(raw_subject, "topics", "topics", [])
            if not isinstance(raw_topics, list):
                continue
            subject_id = _value(
                raw_subject, "id", "id", f"subject-{subject_index + 1}"
            )
            for topic_index, raw_topic in enumerate(raw_topics):
                if not isinstance(raw_topic, dict):
                    continue
                topic_name = _value(raw_topic, "name", "name")
                if not isinstance(topic_name, str) or not topic_name.strip():
                    continue
                topic_name = topic_name.strip()
                topic_key = _normal(topic_name)
                topic_id = _value(
                    raw_topic,
                    "id",
                    "id",
                    f"{subject_id}-topic-{topic_index + 1}",
                )
                topic = subject["topics"].get(topic_key)
                if topic is None:
                    topic = {
                        "name": topic_name,
                        "topic_id": topic_id,
                        "difficulty": _value(raw_topic, "difficulty", "difficulty"),
                        "preparation_level": _value(
                            raw_topic, "preparationLevel", "preparation_level"
                        ),
                        "estimated_hours": _value(
                            raw_topic, "estimatedHours", "estimated_hours"
                        ),
                        "source_plan_id": plan.id,
                        "session_key": (subject_key, topic_key),
                    }
                    subject["topics"][topic_key] = topic

    overview_subjects = []
    for subject in subjects_by_name.values():
        overview_topics = [
            OverviewTopic(
                topic_id=topic["topic_id"],
                topic_name=topic["name"],
                difficulty=topic["difficulty"],
                preparation_level=topic["preparation_level"],
                estimated_hours=topic["estimated_hours"],
                source_plan_id=topic["source_plan_id"],
                sessions=sessions_by_topic.get(topic["session_key"], []),
            )
            for topic in subject["topics"].values()
        ]
        overview_subjects.append(
            OverviewSubject(
                subject_name=subject["name"],
                exam_date=subject["exam_date"],
                priority=subject["priority"],
                source_plan_id=subject["source_plan_id"],
                topics=overview_topics,
            )
        )

    now = local_now()
    current_sessions = [
        session for session in unique_sessions.values() if session.is_current
    ]
    upcoming = [
        _overview_session(session)
        for session in current_sessions
        if session.progress_status == "scheduled"
        and (
            session.date > now.date()
            or (
                session.date == now.date()
                and session.start_time > now.time().replace(tzinfo=None)
            )
        )
    ]
    upcoming.sort(key=lambda item: (item.date, item.start_time, item.session_id))

    tracked_sessions = [
        session
        for session in unique_sessions.values()
        if session.progress_status != "scheduled"
    ]
    completed = sum(session.progress_status == "completed" for session in tracked_sessions)
    partially_completed = sum(
        session.progress_status == "partially_completed"
        for session in tracked_sessions
    )
    missed = sum(session.progress_status == "missed" for session in tracked_sessions)

    recent_plans = [
        OverviewPlan(
            plan_id=plan.id,
            created_at=plan.created_at,
            updated_at=plan.updated_at,
            session_count=sum(
                session.is_current for session in sessions_by_plan.get(plan.id, [])
            ),
            passed_feasibility=bool(
                plan.result_data.get("passed_feasibility", False)
            ),
        )
        for plan in plans[:10]
    ]

    recent_activity: list[OverviewActivity] = []
    for plan in plans:
        raw_trace = (
            plan.result_data.get("execution_trace", [])
            if isinstance(plan.result_data, dict)
            else []
        )
        if not isinstance(raw_trace, list):
            continue
        for raw_entry in reversed(raw_trace):
            try:
                entry = AgentTraceEntry.model_validate(raw_entry)
            except (TypeError, ValueError):
                continue
            recent_activity.append(
                OverviewActivity(
                    plan_id=plan.id,
                    node=entry.node,
                    decision=entry.decision,
                    revision=entry.revision,
                    feedback=entry.feedback,
                    routed_to=entry.routed_to,
                    provider=entry.provider,
                )
            )
            if len(recent_activity) == 8:
                break
        if len(recent_activity) == 8:
            break

    return AcademicOverviewResponse(
        total_plans=len(plans),
        total_scheduled_sessions=len(current_sessions),
        completed_sessions=completed,
        partially_completed_sessions=partially_completed,
        missed_sessions=missed,
        tracked_sessions=len(tracked_sessions),
        completion_rate_percent=(
            round(completed / len(tracked_sessions) * 100, 1)
            if tracked_sessions
            else 0
        ),
        recorded_study_minutes=sum(
            session.actual_minutes or 0 for session in unique_sessions.values()
        ),
        recent_plans=recent_plans,
        upcoming_sessions=upcoming[:8],
        recent_agent_activity=recent_activity,
        subjects=overview_subjects,
    )
