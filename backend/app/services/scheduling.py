from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from math import ceil, floor
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.schemas.plan import (
    Difficulty,
    ExamPriority,
    FeasibilityFinding,
    FeasibilityReport,
    PreparationLevel,
    SubjectInput,
    StudyPlanRequest,
    StudySession,
    TopicInput,
    TopicCoverage,
    TopicPriority,
)

_DIFFICULTY_POINTS = {
    Difficulty.EASY: 4,
    Difficulty.MEDIUM: 10,
    Difficulty.HARD: 18,
}
_PREPARATION_POINTS = {
    PreparationLevel.NOT_STARTED: 18,
    PreparationLevel.BEGINNER: 13,
    PreparationLevel.INTERMEDIATE: 8,
    PreparationLevel.WELL_PREPARED: 2,
}
_EXAM_PRIORITY_POINTS = {
    ExamPriority.LOW: 0,
    ExamPriority.MEDIUM: 5,
    ExamPriority.HIGH: 10,
}
_WEEKDAYS = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)


@dataclass(frozen=True)
class _TopicRecord:
    subject: SubjectInput
    topic: TopicInput
    subject_id: str
    topic_id: str


def local_now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


def _topic_id(subject_index: int, subject_id: str | None, topic_index: int, topic_id: str | None) -> str:
    return topic_id or f"{subject_id or f'subject-{subject_index + 1}'}-topic-{topic_index + 1}"


def _subject_id(subject_index: int, subject_id: str | None) -> str:
    return subject_id or f"subject-{subject_index + 1}"


def _topic_records(request: StudyPlanRequest) -> list[_TopicRecord]:
    records: list[_TopicRecord] = []
    for subject_index, subject in enumerate(request.subjects):
        subject_id = _subject_id(subject_index, subject.id)
        for topic_index, topic in enumerate(subject.topics):
            records.append(
                _TopicRecord(
                    subject=subject,
                    topic=topic,
                    subject_id=subject_id,
                    topic_id=_topic_id(
                        subject_index, subject.id, topic_index, topic.id
                    ),
                )
            )
    return records


def prioritize_topics(
    request: StudyPlanRequest, as_of: date
) -> list[TopicPriority]:
    ranked: list[tuple[float, int, int, TopicPriority]] = []
    for record in _topic_records(request):
        subject = record.subject
        topic = record.topic
        days_until_exam = max(0, (subject.exam_date - as_of).days)
        urgency_points = 40 / (1 + days_until_exam / 14)
        completion_ratio = topic.completed_hours / topic.estimated_hours
        completion_discount = 12 * completion_ratio
        score = (
            urgency_points
            + _DIFFICULTY_POINTS[topic.difficulty]
            + _PREPARATION_POINTS[topic.preparation_level]
            + _EXAM_PRIORITY_POINTS[subject.priority]
            - completion_discount
        )
        if completion_ratio >= 1:
            score = 0
            explanation = "Topic is already fully completed; no further study is scheduled."
        else:
            explanation = (
                f"Exam in {days_until_exam} day(s) contributes {urgency_points:.1f} "
                f"urgency points; {topic.difficulty.value.lower()} difficulty, "
                f"{topic.preparation_level.value.lower()} preparation, and "
                f"{subject.priority.value.lower()} exam priority contribute "
                f"{score - urgency_points + completion_discount:.1f} additional "
                f"points; {completion_ratio:.0%} completion reduces its score by "
                f"{completion_discount:.1f}."
            )
        priority = TopicPriority(
            topic_id=record.topic_id,
            subject_id=record.subject_id,
            topic_name=topic.name,
            subject_name=subject.name,
            exam_date=subject.exam_date,
            priority_score=round(score, 3),
            rank=0,
            explanation=explanation,
        )
        ranked.append(
            (
                -score,
                days_until_exam,
                len(ranked),
                priority,
            )
        )

    ranked.sort(
        key=lambda item: (
            item[0],
            item[1],
            item[3].subject_name.casefold(),
            item[3].topic_name.casefold(),
        )
    )
    return [
        item[3].model_copy(update={"rank": rank})
        for rank, item in enumerate(ranked, start=1)
    ]


def _minute_of_day(value: time) -> int:
    return value.hour * 60 + value.minute


def _time_from_minute(value: int) -> time:
    return time(hour=value // 60, minute=value % 60)


def create_schedule(
    request: StudyPlanRequest,
    priorities: list[TopicPriority],
    as_of: date,
    now: datetime,
    revision_focus_topic_ids: list[str] | None = None,
    revision_feedback: list[str] | None = None,
    reserved_sessions: list[StudySession] | None = None,
) -> list[StudySession]:
    records = _topic_records(request)
    by_topic_id = {record.topic_id: record for record in records}
    remaining_minutes: dict[str, int] = {}
    for topic_id, record in by_topic_id.items():
        topic = record.topic
        remaining_minutes[topic_id] = max(
            0,
            ceil((topic.estimated_hours - topic.completed_hours) * 60),
        )

    focus_ids = set(revision_focus_topic_ids or [])
    feedback_text = " ".join(revision_feedback or []).casefold()
    focus_ids.update(
        item.topic_id
        for item in priorities
        if item.topic_name.casefold() in feedback_text
        or item.subject_name.casefold() in feedback_text
    )
    ordered_priorities = sorted(
        priorities,
        key=lambda item: (
            item.topic_id not in focus_ids,
            item.rank,
        ),
    )
    requested_days = {day.value for day in request.available_days}
    start_window = _minute_of_day(request.preferred_start_time)
    end_window = _minute_of_day(request.preferred_end_time)
    daily_study_cap = min(
        floor(request.hours_per_day * 60),
        end_window - start_window,
    )
    local_time = now.astimezone(ZoneInfo(settings.timezone))
    reserved_by_date: dict[date, list[StudySession]] = {}
    for reserved in reserved_sessions or []:
        if reserved.date >= as_of:
            reserved_by_date.setdefault(reserved.date, []).append(reserved)
    sessions: list[StudySession] = []
    last_exam = max(subject.exam_date for subject in request.subjects)
    current_date = as_of

    while current_date <= last_exam:
        if _WEEKDAYS[current_date.weekday()] in requested_days:
            cursor = start_window
            if current_date == as_of:
                cursor = max(cursor, local_time.hour * 60 + local_time.minute)
            reserved_today = reserved_by_date.get(current_date, [])
            study_minutes_today = sum(
                session.duration_minutes for session in reserved_today
            )
            previous_reserved_ends = [
                _minute_of_day(session.end_time)
                for session in reserved_today
                if _minute_of_day(session.end_time) <= cursor
            ]
            if previous_reserved_ends:
                cursor = max(
                    cursor,
                    max(previous_reserved_ends) + request.break_duration_minutes,
                )
            has_session_today = False

            while study_minutes_today < daily_study_cap:
                made_progress = False
                for item in ordered_priorities:
                    remaining = remaining_minutes[item.topic_id]
                    if remaining <= 0 or item.exam_date < current_date:
                        continue

                    if has_session_today:
                        cursor += request.break_duration_minutes
                    if cursor >= end_window:
                        break

                    time_available = end_window - cursor
                    daily_budget = daily_study_cap - study_minutes_today
                    duration = min(
                        request.session_duration_minutes,
                        remaining,
                        time_available,
                        daily_budget,
                    )
                    next_reserved = next(
                        (
                            reserved
                            for reserved in sorted(
                                reserved_today, key=lambda item: item.start_time
                            )
                            if _minute_of_day(reserved.end_time) > cursor
                        ),
                        None,
                    )
                    if next_reserved is not None:
                        reserved_start = _minute_of_day(next_reserved.start_time)
                        if cursor >= reserved_start:
                            cursor = _minute_of_day(next_reserved.end_time)
                            has_session_today = True
                            made_progress = True
                            break
                        duration_before_reserved = (
                            reserved_start
                            - cursor
                            - request.break_duration_minutes
                        )
                        if duration_before_reserved <= 0:
                            cursor = _minute_of_day(next_reserved.end_time)
                            has_session_today = True
                            made_progress = True
                            break
                        duration = min(duration, duration_before_reserved)
                    if duration <= 0:
                        continue

                    record = by_topic_id[item.topic_id]
                    end_minute = cursor + duration
                    subject = record.subject
                    topic = record.topic
                    sessions.append(
                        StudySession(
                            date=current_date,
                            start_time=_time_from_minute(cursor),
                            end_time=_time_from_minute(end_minute),
                            subject_id=record.subject_id,
                            subject=subject.name,
                            topic_id=item.topic_id,
                            topic=topic.name,
                            duration_minutes=duration,
                        )
                    )
                    remaining_minutes[item.topic_id] -= duration
                    study_minutes_today += duration
                    cursor = end_minute
                    has_session_today = True
                    made_progress = True

                    if study_minutes_today >= daily_study_cap or cursor >= end_window:
                        break

                if not made_progress:
                    break
        current_date += timedelta(days=1)

    return sessions


def check_feasibility(
    request: StudyPlanRequest,
    priorities: list[TopicPriority],
    sessions: list[StudySession],
    as_of: date,
    reserved_sessions: list[StudySession] | None = None,
) -> FeasibilityReport:
    records = _topic_records(request)
    priority_ranks = {item.topic_id: item.rank for item in priorities}
    records.sort(key=lambda record: priority_ranks.get(record.topic_id, len(records)))
    by_topic_id = {record.topic_id: record for record in records}
    scheduled_by_topic: dict[str, int] = {topic_id: 0 for topic_id in by_topic_id}
    sessions_by_date: dict[date, list[StudySession]] = {}
    findings: list[FeasibilityFinding] = []
    requested_days = {day.value for day in request.available_days}
    start_window = _minute_of_day(request.preferred_start_time)
    end_window = _minute_of_day(request.preferred_end_time)
    daily_cap = min(floor(request.hours_per_day * 60), end_window - start_window)

    for session in sessions:
        record = by_topic_id.get(session.topic_id)
        if record is None:
            findings.append(
                FeasibilityFinding(
                    code="unknown_topic",
                    severity="error",
                    message="A scheduled session refers to an unknown topic.",
                    topic_id=session.topic_id,
                    date=session.date,
                )
            )
            continue

        subject = record.subject
        if (
            session.subject_id != record.subject_id
            or session.subject != subject.name
            or session.topic != record.topic.name
        ):
            findings.append(
                FeasibilityFinding(
                    code="session_identity_mismatch",
                    severity="error",
                    message="A scheduled session does not match its subject and topic.",
                    topic_id=session.topic_id,
                    date=session.date,
                )
            )
        if session.date < as_of:
            findings.append(
                FeasibilityFinding(
                    code="session_in_past",
                    severity="error",
                    message="A session is scheduled before today.",
                    topic_id=session.topic_id,
                    date=session.date,
                )
            )
        if session.date > subject.exam_date:
            findings.append(
                FeasibilityFinding(
                    code="after_deadline",
                    severity="error",
                    message=f"{session.topic} is scheduled after the {session.subject} exam.",
                    topic_id=session.topic_id,
                    date=session.date,
                )
            )
        if _WEEKDAYS[session.date.weekday()] not in requested_days:
            findings.append(
                FeasibilityFinding(
                    code="unavailable_day",
                    severity="error",
                    message="A session is scheduled on a day that is not available.",
                    topic_id=session.topic_id,
                    date=session.date,
                )
            )

        start_minute = _minute_of_day(session.start_time)
        end_minute = _minute_of_day(session.end_time)
        actual_duration = end_minute - start_minute
        if (
            start_minute < start_window
            or end_minute > end_window
            or actual_duration <= 0
        ):
            findings.append(
                FeasibilityFinding(
                    code="outside_time_window",
                    severity="error",
                    message="A session falls outside the preferred study window.",
                    topic_id=session.topic_id,
                    date=session.date,
                )
            )
        if actual_duration != session.duration_minutes:
            findings.append(
                FeasibilityFinding(
                    code="duration_mismatch",
                    severity="error",
                    message="A session's duration does not match its start and end times.",
                    topic_id=session.topic_id,
                    date=session.date,
                )
            )
        if session.duration_minutes > request.session_duration_minutes:
            findings.append(
                FeasibilityFinding(
                    code="session_too_long",
                    severity="error",
                    message="A session exceeds the preferred session duration.",
                    topic_id=session.topic_id,
                    date=session.date,
                )
            )

        scheduled_by_topic[session.topic_id] += session.duration_minutes
        sessions_by_date.setdefault(session.date, []).append(session)

    for session in reserved_sessions or []:
        if session.date >= as_of:
            sessions_by_date.setdefault(session.date, []).append(session)

    for session_date, daily_sessions in sessions_by_date.items():
        ordered = sorted(daily_sessions, key=lambda item: item.start_time)
        total_minutes = sum(item.duration_minutes for item in ordered)
        if total_minutes > daily_cap:
            findings.append(
                FeasibilityFinding(
                    code="daily_limit_exceeded",
                    severity="error",
                    message=(
                        f"Scheduled study time on {session_date.isoformat()} "
                        "exceeds the daily limit."
                    ),
                    date=session_date,
                )
            )

        for previous, following in zip(ordered, ordered[1:]):
            gap = _minute_of_day(following.start_time) - _minute_of_day(
                previous.end_time
            )
            if gap < 0:
                findings.append(
                    FeasibilityFinding(
                        code="schedule_conflict",
                        severity="error",
                        message="Study sessions overlap.",
                        topic_id=following.topic_id,
                        date=session_date,
                    )
                )
            elif gap < request.break_duration_minutes:
                findings.append(
                    FeasibilityFinding(
                        code="break_too_short",
                        severity="error",
                        message="The break between sessions is shorter than requested.",
                        topic_id=following.topic_id,
                        date=session_date,
                    )
                )

    coverage: list[TopicCoverage] = []
    uncovered: list[TopicCoverage] = []
    for record in records:
        subject = record.subject
        topic = record.topic
        topic_id = record.topic_id
        estimated = ceil(topic.estimated_hours * 60)
        completed = ceil(topic.completed_hours * 60)
        scheduled = scheduled_by_topic[topic_id]
        required_remaining = max(
            0,
            ceil((topic.estimated_hours - topic.completed_hours) * 60),
        )
        remaining = max(0, required_remaining - scheduled)
        topic_coverage = TopicCoverage(
            subject_id=record.subject_id,
            subject=subject.name,
            topic_id=topic_id,
            topic=topic.name,
            estimated_minutes=estimated,
            completed_minutes=completed,
            scheduled_minutes=scheduled,
            remaining_minutes=remaining,
        )
        coverage.append(topic_coverage)
        if remaining > 0:
            uncovered.append(topic_coverage)
            findings.append(
                FeasibilityFinding(
                    code="uncovered_topic",
                    severity="error",
                    message=(
                        f"{topic.name} has {remaining} minute(s) of study time "
                        "left unscheduled before its exam."
                    ),
                    topic_id=topic_id,
                )
            )
        elif scheduled > required_remaining:
            findings.append(
                FeasibilityFinding(
                    code="over_scheduled_topic",
                    severity="error",
                    message=f"{topic.name} is scheduled for more than its remaining study time.",
                    topic_id=topic_id,
                )
            )

    if uncovered:
        findings.append(
            FeasibilityFinding(
                code="insufficient_study_time",
                severity="error",
                message=(
                    "Available study windows cannot cover all remaining topic "
                    "estimates before their exam deadlines."
                ),
            )
        )

    return FeasibilityReport(
        passed=not any(finding.severity == "error" for finding in findings),
        findings=findings,
        coverage=coverage,
    )
