from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.agents import graph as graph_module
from app.main import app
from app.schemas.plan import (
    PlannerAdviceOutput,
    PlannerAgentInput,
    PriorityAgentInput,
    PriorityExplanation,
    PriorityExplanationOutput,
    ReviewerAgentInput,
    ReviewerDecision,
    StudyPlanRequest,
    StudySession,
    TopicPriority,
)
from app.services.scheduling import check_feasibility, prioritize_topics

client = TestClient(app)
TIMEZONE = ZoneInfo("Asia/Kolkata")


def today() -> date:
    return datetime.now(TIMEZONE).date()


def valid_payload(*, exam_offset: int = 7, hours_per_day: float = 2) -> dict:
    exam_date = (today() + timedelta(days=exam_offset)).isoformat()
    return {
        "subjects": [
            {
                "id": "subject-1",
                "name": "Algorithms",
                "examDate": exam_date,
                "priority": "High",
                "topics": [
                    {
                        "id": "topic-1",
                        "name": "Graph traversal",
                        "difficulty": "Hard",
                        "preparationLevel": "Beginner",
                        "estimatedHours": 1.5,
                    }
                ],
            }
        ],
        "availableDays": [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ],
        "hoursPerDay": hours_per_day,
        "preferredStartTime": "08:00",
        "preferredEndTime": "12:00",
        "sessionDurationMinutes": 45,
        "breakDurationMinutes": 10,
    }


def parse_request(payload: dict | None = None) -> StudyPlanRequest:
    return StudyPlanRequest.model_validate(payload or valid_payload())


def fixed_now() -> datetime:
    return datetime.combine(
        today(),
        time(0, 0),
        tzinfo=TIMEZONE,
    )


def test_request_rejects_invalid_time_window_and_duplicate_days() -> None:
    payload = valid_payload()
    payload["preferredEndTime"] = "07:00"
    with pytest.raises(ValidationError, match="later than start time"):
        parse_request(payload)

    payload = valid_payload()
    payload["availableDays"] = ["monday", "monday"]
    with pytest.raises(ValidationError, match="must not contain duplicates"):
        parse_request(payload)

    payload = valid_payload()
    payload["subjects"][0]["topics"][0]["id"] = "duplicate-topic"
    payload["subjects"].append(
        {
            "id": "subject-2",
            "name": "Algorithms II",
            "examDate": (today() + timedelta(days=8)).isoformat(),
            "priority": "Medium",
            "topics": [
                {
                    "id": "duplicate-topic",
                    "name": "Trees",
                    "difficulty": "Easy",
                    "preparationLevel": "Beginner",
                    "estimatedHours": 1,
                }
            ],
        }
    )
    with pytest.raises(ValidationError, match="Topic IDs must be unique"):
        parse_request(payload)


def test_priority_ranks_urgent_difficult_unprepared_topics_higher() -> None:
    payload = valid_payload()
    payload["subjects"].append(
        {
            "id": "subject-2",
            "name": "Discrete Mathematics",
            "examDate": (today() + timedelta(days=20)).isoformat(),
            "priority": "Low",
            "topics": [
                {
                    "id": "topic-2",
                    "name": "Sets",
                    "difficulty": "Easy",
                    "preparationLevel": "Well Prepared",
                    "estimatedHours": 1,
                }
            ],
        }
    )
    priorities = prioritize_topics(parse_request(payload), today())

    assert priorities[0].topic_id == "topic-1"
    assert priorities[0].rank == 1
    assert "urgency points" in priorities[0].explanation
    assert priorities[-1].rank == 2


def test_completed_topic_is_not_scheduled_and_loses_priority() -> None:
    payload = valid_payload()
    payload["subjects"][0]["topics"][0]["completedHours"] = 1.5
    request = parse_request(payload)
    priorities = prioritize_topics(request, today())

    assert priorities[0].priority_score == 0
    assert "already fully completed" in priorities[0].explanation
    report = check_feasibility(request, priorities, [], today())
    assert report.passed
    assert report.coverage[0].remaining_minutes == 0


def test_generated_sessions_fit_deadlines_and_cover_remaining_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)
    result = graph_module.generate_plan(parse_request(), now=fixed_now())

    assert result.schedule
    assert result.passed_feasibility
    assert result.feasibility.coverage[0].scheduled_minutes == 90
    assert all(session.date <= today() + timedelta(days=7) for session in result.schedule)
    assert all(session.duration_minutes <= 45 for session in result.schedule)


def test_feasibility_detects_overlapping_sessions() -> None:
    request = parse_request()
    priorities = prioritize_topics(request, today())
    session = StudySession(
        date=today(),
        start_time=time(8, 0),
        end_time=time(8, 30),
        subject_id="subject-1",
        subject="Algorithms",
        topic_id="topic-1",
        topic="Graph traversal",
        duration_minutes=30,
    )
    duplicate_sessions = [session.model_copy() for _ in range(4)]

    report = check_feasibility(
        request,
        priorities,
        duplicate_sessions,
        today(),
    )

    assert not report.passed
    assert any(finding.code == "schedule_conflict" for finding in report.findings)
    assert any(
        finding.code == "over_scheduled_topic" for finding in report.findings
    )


def test_short_availability_returns_uncovered_work_and_insufficient_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)
    payload = valid_payload(exam_offset=0, hours_per_day=1)
    payload["subjects"][0]["topics"][0]["estimatedHours"] = 5
    payload["preferredEndTime"] = "09:00"
    payload["sessionDurationMinutes"] = 60
    request = parse_request(payload)

    result = graph_module.generate_plan(request, now=fixed_now())

    codes = {finding.code for finding in result.feasibility.findings}
    assert not result.passed_feasibility
    assert "uncovered_topic" in codes
    assert "insufficient_study_time" in codes
    assert result.feasibility.coverage[0].remaining_minutes == 240


def test_revision_feedback_reorders_plan_and_can_resolve_deadline_miss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)
    payload = valid_payload(exam_offset=3, hours_per_day=1)
    payload["preferredEndTime"] = "09:00"
    payload["sessionDurationMinutes"] = 60
    payload["subjects"][0]["examDate"] = (
        today() + timedelta(days=2)
    ).isoformat()
    payload["subjects"][0]["priority"] = "Low"
    payload["subjects"][0]["topics"][0].update(
        {
            "name": "Urgent basics",
            "difficulty": "Easy",
            "preparationLevel": "Well Prepared",
            "estimatedHours": 2,
        }
    )
    payload["subjects"].append(
        {
            "id": "subject-2",
            "name": "Advanced algorithms",
            "examDate": (today() + timedelta(days=3)).isoformat(),
            "priority": "High",
            "topics": [
                {
                    "id": "topic-2",
                    "name": "Advanced graph theory",
                    "difficulty": "Hard",
                    "preparationLevel": "Not Started",
                    "estimatedHours": 2,
                }
            ],
        }
    )

    result = graph_module.generate_plan(parse_request(payload), now=fixed_now())
    router_events = [
        event
        for event in result.execution_trace
        if event.node == "revision_router"
    ]
    planner_events = [
        event
        for event in result.execution_trace
        if event.node == "planner_agent"
    ]

    assert result.passed_feasibility
    assert result.revision_count == 1
    assert [event.revision for event in planner_events] == [0, 1]
    assert router_events[0].decision == "revision requested"
    assert router_events[0].routed_to == "planner_agent"
    assert router_events[-1].routed_to == "finalize"


def test_graph_stops_after_two_revisions_and_trace_matches_executions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)
    payload = valid_payload(exam_offset=0, hours_per_day=1)
    payload["preferredEndTime"] = "09:00"
    payload["sessionDurationMinutes"] = 60
    payload["subjects"][0]["topics"][0]["estimatedHours"] = 5

    result = graph_module.generate_plan(parse_request(payload), now=fixed_now())
    planner_events = [
        event for event in result.execution_trace if event.node == "planner_agent"
    ]
    routing_events = [
        event for event in result.execution_trace if event.node == "revision_router"
    ]

    assert result.revision_count == graph_module.MAX_REVISIONS == 2
    assert [event.revision for event in planner_events] == [0, 1, 2]
    assert len(routing_events) == 3
    assert routing_events[-1].decision == "retry limit reached"
    assert routing_events[-1].routed_to == "finalize"
    assert not result.passed_feasibility


def test_execution_trace_records_each_agent_and_fallback_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)

    result = graph_module.generate_plan(parse_request(), now=fixed_now())
    executed_nodes = [entry.node for entry in result.execution_trace]

    assert executed_nodes[:5] == [
        "priority_agent",
        "planner_agent",
        "feasibility_agent",
        "reviewer_agent",
        "revision_router",
    ]
    assert executed_nodes[-1] == "finalize"
    assert result.agent_mode == "deterministic_fallback"
    assert next(
        entry for entry in result.execution_trace if entry.node == "reviewer_agent"
    ).provider == "deterministic_fallback"


def test_reviewer_model_is_called_with_structured_input_and_its_rejection_routes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    def reviewer(agent_input: ReviewerAgentInput) -> ReviewerDecision:
        nonlocal calls
        calls += 1
        assert agent_input.feasibility.passed
        return ReviewerDecision(
            approved=False,
            rationale="The reviewer requests a focused revision.",
            feedback=["Review this workload balance."],
        )

    monkeypatch.setattr(graph_module, "create_groq_agents", lambda: None)
    result = graph_module.generate_plan(
        parse_request(),
        reviewer_model=reviewer,
        now=fixed_now(),
    )

    assert calls == 3
    assert result.revision_count == 2
    assert result.agent_mode == "groq"
    planner_revisions = [
        entry
        for entry in result.execution_trace
        if entry.node == "planner_agent" and entry.revision == 1
    ]
    assert any(
        "Review this workload balance." in item
        for item in planner_revisions[0].feedback
    )
    assert any(
        "Review this workload balance." in entry.feedback
        for entry in result.execution_trace
        if entry.node == "revision_router"
    )


def test_priority_planner_and_reviewer_models_are_mockable_and_traced() -> None:
    def priority_model(
        agent_input: PriorityAgentInput,
        priorities: list[TopicPriority],
    ) -> PriorityExplanationOutput:
        assert agent_input.request.subjects[0].name == "Algorithms"
        assert agent_input.as_of == today()
        return PriorityExplanationOutput(
            explanations=[
                PriorityExplanation(
                    topic_id=priorities[0].topic_id,
                    explanation="Mocked grounded priority explanation.",
                )
            ]
        )

    def planner_model(
        agent_input: PlannerAgentInput,
    ) -> PlannerAdviceOutput:
        assert agent_input.revision == 0
        assert agent_input.request.subjects[0].topics[0].name == "Graph traversal"
        return PlannerAdviceOutput(
            focus_topic_ids=["topic-1", "unknown-topic"],
            rationale="Focus on graph traversal first.",
        )

    def reviewer_model(agent_input: ReviewerAgentInput) -> ReviewerDecision:
        assert agent_input.schedule
        return ReviewerDecision(
            approved=True,
            rationale="The draft is suitable.",
        )

    result = graph_module.generate_plan(
        parse_request(),
        priority_model=priority_model,
        planner_model=planner_model,
        reviewer_model=reviewer_model,
        now=fixed_now(),
    )

    assert result.passed_feasibility
    assert result.agent_mode == "groq"
    assert result.topic_priorities[0].explanation == (
        "Mocked grounded priority explanation."
    )
    assert all(
        entry.provider == "groq"
        for entry in result.execution_trace
        if entry.node in {"priority_agent", "planner_agent", "reviewer_agent"}
    )
    planner_event = next(
        entry for entry in result.execution_trace if entry.node == "planner_agent"
    )
    assert planner_event.feedback == ["Focus on graph traversal first."]
