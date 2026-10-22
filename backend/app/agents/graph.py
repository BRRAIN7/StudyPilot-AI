from collections.abc import Callable
from datetime import date, datetime, time
import logging
from typing import TypedDict
from zoneinfo import ZoneInfo

from langgraph.graph import END, START, StateGraph

from app.core.config import settings
from app.schemas.plan import (
    AgentTraceEntry,
    FeasibilityAgentInput,
    FeasibilityReport,
    PlannerAdviceOutput,
    PlannerAgentInput,
    PlannerAgentOutput,
    PlanResponse,
    PriorityExplanationOutput,
    PriorityAgentInput,
    PriorityAgentOutput,
    ReviewerAgentInput,
    ReviewerDecision,
    StudyPlanRequest,
    StudySession,
    TopicPriority,
)
from app.services.scheduling import (
    check_feasibility,
    create_schedule,
    local_now,
    prioritize_topics,
)

MAX_REVISIONS = 2
LOGGER = logging.getLogger(__name__)
ReviewerModel = Callable[[ReviewerAgentInput], ReviewerDecision]
PriorityModel = Callable[
    [PriorityAgentInput, list[TopicPriority]], PriorityExplanationOutput
]
PlannerModel = Callable[[PlannerAgentInput], PlannerAdviceOutput]


class GroqAgentError(RuntimeError):
    """A configured Groq agent failed to return a structured response."""


class PlanGraphState(TypedDict, total=False):
    request: StudyPlanRequest
    reserved_sessions: list[StudySession]
    as_of: date
    now: datetime
    priorities: list[TopicPriority]
    schedule: list[StudySession]
    feasibility: FeasibilityReport
    reviewer_feedback: ReviewerDecision
    revision_count: int
    revision_feedback: list[str]
    revision_focus_topic_ids: list[str]
    trace: list[AgentTraceEntry]
    route: str
    warnings: list[str]
    agent_mode: str


def create_groq_agents() -> tuple[PriorityModel, PlannerModel, ReviewerModel] | None:
    if not settings.groq_api_key:
        return None

    try:
        from langchain_groq import ChatGroq

        def model_for(output_model: type):
            return ChatGroq(
                model="qwen/qwen3.8-27b",
                api_key=settings.groq_api_key,
                temperature=0,
                timeout=settings.groq_timeout_seconds,
                max_retries=1,
            ).with_structured_output(output_model)

        priority_model = model_for(PriorityExplanationOutput)
        planner_model = model_for(PlannerAdviceOutput)
        reviewer_model = model_for(ReviewerDecision)
    except Exception:
        LOGGER.warning(
            "Groq agents could not be initialized; deterministic fallback is active."
        )
        return None

    def invoke_structured(
        model,
        instruction: str,
        payload: str,
        output_type: type,
    ):
        try:
            result = model.invoke(
                [
                    ("system", instruction),
                    ("human", payload),
                ]
            )
        except Exception:
            raise GroqAgentError(
                "A configured Groq agent could not complete its request."
            ) from None
        try:
            return (
                result
                if isinstance(result, output_type)
                else output_type.model_validate(result)
            )
        except Exception:
            raise GroqAgentError(
                "A configured Groq agent returned malformed structured output."
            ) from None

    def explain_priorities(
        agent_input: PriorityAgentInput,
        priorities: list[TopicPriority],
    ) -> PriorityExplanationOutput:
        return invoke_structured(
            priority_model,
            "Explain the supplied deterministic topic ranking using only the "
            "provided exam urgency, difficulty, preparation, and exam priority. "
            "Do not reorder topics or invent scores. Return one concise explanation "
            "for each supplied topic ID.",
            PriorityAgentInput(
                request=agent_input.request,
                as_of=agent_input.as_of,
            ).model_dump_json(by_alias=True)
            + "\nDeterministic ranking:\n"
            + PriorityExplanationOutput(
                explanations=[
                    {
                        "topic_id": item.topic_id,
                        "explanation": item.explanation,
                    }
                    for item in priorities
                ]
            ).model_dump_json(by_alias=True),
            PriorityExplanationOutput,
        )

    def advise_planner(agent_input: PlannerAgentInput) -> PlannerAdviceOutput:
        return invoke_structured(
            planner_model,
            "You are advising the deterministic study scheduler. Select only known "
            "topic IDs to focus on in response to the prior agent feedback. Do not "
            "create dates, times, or durations; Python enforces all schedule "
            "arithmetic and deadlines. If the existing draft is sound, return no "
            "focus IDs.",
            agent_input.model_dump_json(by_alias=True),
            PlannerAdviceOutput,
        )

    def review(agent_input: ReviewerAgentInput) -> ReviewerDecision:
        return invoke_structured(
            reviewer_model,
            "Review a deterministic academic study schedule for coverage, workload "
            "balance, and sensible prioritization. Do not redo arithmetic or alter "
            "the schedule. Treat feasibility findings as authoritative: never "
            "approve when they contain errors. Return only actionable feedback "
            "supported by the supplied data.",
            agent_input.model_dump_json(by_alias=True),
            ReviewerDecision,
        )

    return explain_priorities, advise_planner, review


def _deterministic_review(
    agent_input: ReviewerAgentInput,
) -> ReviewerDecision:
    errors = [
        finding.message
        for finding in agent_input.feasibility.findings
        if finding.severity == "error"
    ]
    uncovered = [
        coverage
        for coverage in agent_input.feasibility.coverage
        if coverage.remaining_minutes > 0
    ]
    feedback = errors[:]
    for coverage in uncovered:
        message = (
            f"Rebalance time for {coverage.topic} ({coverage.subject}) or add "
            "availability so its remaining work fits before the exam."
        )
        if message not in feedback:
            feedback.append(message)

    first_session_by_topic: dict[str, tuple[date, time]] = {}
    for session in agent_input.schedule:
        current = first_session_by_topic.get(session.topic_id)
        session_position = (session.date, session.start_time)
        if current is None or session_position < current:
            first_session_by_topic[session.topic_id] = session_position
    for lower_priority in agent_input.priorities:
        lower_position = first_session_by_topic.get(lower_priority.topic_id)
        if lower_position is None:
            continue
        for higher_priority in agent_input.priorities[: lower_priority.rank - 1]:
            higher_position = first_session_by_topic.get(higher_priority.topic_id)
            if (
                higher_position is not None
                and higher_position > lower_position
                and higher_priority.exam_date <= lower_priority.exam_date
            ):
                feedback.append(
                    f"Schedule {higher_priority.topic_name} before "
                    f"{lower_priority.topic_name} where both deadlines allow."
                )

    daily_minutes: dict[date, int] = {}
    for session in agent_input.schedule:
        daily_minutes[session.date] = (
            daily_minutes.get(session.date, 0) + session.duration_minutes
        )
    workload_warnings: list[str] = []
    if len(daily_minutes) > 1:
        lightest = min(daily_minutes.values())
        heaviest = max(daily_minutes.values())
        if lightest and heaviest >= 2 * lightest:
            workload_warnings.append(
                "Study workload varies substantially between scheduled days."
            )

    approved = agent_input.feasibility.passed and not uncovered and not feedback
    rationale = (
        "The draft covers all remaining topic estimates and passes deterministic "
        "feasibility checks."
        if approved
        else "The draft needs revision because feasibility checks found uncovered "
        "work or schedule constraints."
    )
    return ReviewerDecision(
        approved=approved,
        rationale=rationale,
        feedback=feedback,
        warnings=workload_warnings,
    )


def build_plan_graph(
    priority_model: PriorityModel | None = None,
    planner_model: PlannerModel | None = None,
    reviewer_model: ReviewerModel | None = None,
):
    def priority_agent(state: PlanGraphState) -> dict[str, object]:
        agent_input = PriorityAgentInput(
            request=state["request"],
            as_of=state["as_of"],
        )
        output = PriorityAgentOutput(
            priorities=prioritize_topics(agent_input.request, agent_input.as_of)
        )
        provider = "deterministic_fallback"
        feedback: list[str] = []
        if priority_model is not None:
            try:
                explanations = priority_model(agent_input, output.priorities)
                known_topics = {item.topic_id for item in output.priorities}
                returned_topic_ids = [
                    item.topic_id for item in explanations.explanations
                ]
                if (
                    len(returned_topic_ids) != len(set(returned_topic_ids))
                    or set(returned_topic_ids) != known_topics
                ):
                    raise GroqAgentError(
                        "A configured Groq agent returned incomplete priority explanations."
                    )
                explanation_by_id = {
                    item.topic_id: item.explanation
                    for item in explanations.explanations
                    if item.topic_id in known_topics
                }
                output = PriorityAgentOutput(
                    priorities=[
                        item.model_copy(
                            update={
                                "explanation": explanation_by_id.get(
                                    item.topic_id, item.explanation
                                )
                            }
                        )
                        for item in output.priorities
                    ]
                )
                provider = "groq"
            except Exception:
                feedback.append(
                    "Groq prioritization explanation failed; deterministic explanations were retained."
                )
                LOGGER.warning(
                    "Priority agent Groq call failed; deterministic fallback used."
                )
        else:
            feedback.append(
                "Groq is not configured; deterministic priority explanations were used."
            )
        event = AgentTraceEntry(
            node="priority_agent",
            decision=(
                f"ranked {len(output.priorities)} topics"
                if provider == "groq"
                else f"ranked {len(output.priorities)} topics using deterministic fallback"
            ),
            revision=state.get("revision_count", 0),
            feedback=feedback,
            routed_to="planner_agent",
            provider=provider,
        )
        return {"priorities": output.priorities, "trace": [*state.get("trace", []), event]}

    def planner_agent(state: PlanGraphState) -> dict[str, object]:
        agent_input = PlannerAgentInput(
            request=state["request"],
            priorities=state["priorities"],
            revision=state.get("revision_count", 0),
            revision_feedback=state.get("revision_feedback", []),
            revision_focus_topic_ids=state.get("revision_focus_topic_ids", []),
            as_of=state["as_of"],
            now=state["now"],
            reserved_sessions=state.get("reserved_sessions", []),
        )
        provider = "deterministic_fallback"
        planner_feedback = list(agent_input.revision_feedback)
        if planner_model is not None:
            try:
                advice = planner_model(agent_input)
                valid_topic_ids = {item.topic_id for item in agent_input.priorities}
                planner_feedback.append(advice.rationale)
                agent_input = agent_input.model_copy(
                    update={
                        "revision_focus_topic_ids": list(
                            dict.fromkeys(
                                [
                                    *agent_input.revision_focus_topic_ids,
                                    *(
                                        topic_id
                                        for topic_id in advice.focus_topic_ids
                                        if topic_id in valid_topic_ids
                                    ),
                                ]
                            )
                        ),
                        "revision_feedback": planner_feedback,
                    }
                )
                provider = "groq"
            except Exception:
                planner_feedback.append(
                    "Groq planner advice failed; deterministic scheduling used."
                )
                LOGGER.warning(
                    "Planner agent Groq call failed; deterministic fallback used."
                )
        else:
            planner_feedback.append(
                "Groq is not configured; deterministic scheduling was used."
            )
        output = PlannerAgentOutput(
            schedule=create_schedule(
                agent_input.request,
                agent_input.priorities,
                agent_input.as_of,
                agent_input.now,
                agent_input.revision_focus_topic_ids,
                agent_input.revision_feedback,
                agent_input.reserved_sessions,
            )
        )
        event = AgentTraceEntry(
            node="planner_agent",
            decision=(
                f"proposed {len(output.schedule)} deterministic study sessions"
                if provider == "groq"
                else f"proposed {len(output.schedule)} deterministic study sessions without Groq advice"
            ),
            revision=agent_input.revision,
            feedback=planner_feedback,
            routed_to="feasibility_agent",
            provider=provider,
        )
        return {
            "schedule": output.schedule,
            "trace": [*state.get("trace", []), event],
        }

    def feasibility_agent(state: PlanGraphState) -> dict[str, object]:
        agent_input = FeasibilityAgentInput(
            request=state["request"],
            priorities=state["priorities"],
            schedule=state["schedule"],
            as_of=state["as_of"],
            reserved_sessions=state.get("reserved_sessions", []),
        )
        report = check_feasibility(
            agent_input.request,
            agent_input.priorities,
            agent_input.schedule,
            agent_input.as_of,
            agent_input.reserved_sessions,
        )
        feedback = [
            finding.message
            for finding in report.findings
            if finding.severity == "error"
        ]
        event = AgentTraceEntry(
            node="feasibility_agent",
            decision="passed" if report.passed else "requested revision",
            revision=state.get("revision_count", 0),
            feedback=feedback,
            routed_to="reviewer_agent",
            provider="deterministic",
        )
        return {
            "feasibility": report,
            "trace": [*state.get("trace", []), event],
        }

    def reviewer_agent(state: PlanGraphState) -> dict[str, object]:
        agent_input = ReviewerAgentInput(
            request=state["request"],
            priorities=state["priorities"],
            schedule=state["schedule"],
            feasibility=state["feasibility"],
            revision=state.get("revision_count", 0),
            reserved_sessions=state.get("reserved_sessions", []),
        )
        deterministic = _deterministic_review(agent_input)
        provider = "deterministic_fallback"
        trace_feedback = list(deterministic.feedback)
        if reviewer_model is None:
            decision = deterministic
            trace_feedback.append(
                "Groq is not configured; deterministic review was used."
            )
        else:
            try:
                model_decision = reviewer_model(agent_input)
                decision = ReviewerDecision(
                    approved=deterministic.approved and model_decision.approved,
                    rationale=model_decision.rationale,
                    feedback=list(dict.fromkeys(
                        [*deterministic.feedback, *model_decision.feedback]
                    )),
                    warnings=list(dict.fromkeys(
                        [*deterministic.warnings, *model_decision.warnings]
                    )),
                )
                provider = "groq"
                trace_feedback = decision.feedback
            except Exception:
                decision = deterministic
                trace_feedback.append(
                    "Groq review failed; deterministic review was used."
                )
                LOGGER.warning(
                    "Reviewer agent Groq call failed; deterministic fallback used."
                )

        event = AgentTraceEntry(
            node="reviewer_agent",
            decision="approved" if decision.approved else "requested revision",
            revision=state.get("revision_count", 0),
            feedback=trace_feedback,
            routed_to="revision_router",
            provider=provider,
        )
        return {
            "reviewer_feedback": decision,
            "trace": [*state.get("trace", []), event],
        }

    def record_routing(state: PlanGraphState) -> dict[str, object]:
        rejected = (
            not state["feasibility"].passed
            or not state["reviewer_feedback"].approved
        )
        revision_count = state.get("revision_count", 0)
        can_retry = rejected and revision_count < MAX_REVISIONS
        target = "planner_agent" if can_retry else "finalize"
        next_revision = revision_count + 1 if can_retry else revision_count
        feedback = list(
            dict.fromkeys(
                [
                    *state["reviewer_feedback"].feedback,
                    *(
                        finding.message
                        for finding in state["feasibility"].findings
                        if finding.severity == "error"
                    ),
                ]
            )
        )
        focus_ids = [
            coverage.topic_id
            for coverage in state["feasibility"].coverage
            if coverage.remaining_minutes > 0
        ]
        decision = (
            "revision requested"
            if can_retry
            else "retry limit reached"
            if rejected
            else "approved"
        )
        event = AgentTraceEntry(
            node="revision_router",
            decision=decision,
            revision=next_revision,
            feedback=feedback,
            routed_to=target,
            provider="langgraph_conditional",
        )
        return {
            "route": target,
            "revision_count": next_revision,
            "revision_feedback": feedback if can_retry else [],
            "revision_focus_topic_ids": focus_ids if can_retry else [],
            "trace": [*state.get("trace", []), event],
        }

    def select_route(state: PlanGraphState) -> str:
        return state["route"]

    def finalize(state: PlanGraphState) -> dict[str, object]:
        warnings = list(state["reviewer_feedback"].warnings)
        if not state["feasibility"].passed:
            warnings.append(
                "The best available draft is infeasible; inspect feasibility findings "
                "and uncovered topic minutes before using it."
            )
        if not state["reviewer_feedback"].approved:
            warnings.append(
                "The reviewer did not approve the draft within the configured revision limit."
            )
        event = AgentTraceEntry(
            node="finalize",
            decision="feasible" if state["feasibility"].passed else "infeasible",
            revision=state.get("revision_count", 0),
            feedback=warnings,
            provider="deterministic",
        )
        return {
            "warnings": list(dict.fromkeys(warnings)),
            "trace": [*state.get("trace", []), event],
        }

    graph = StateGraph(PlanGraphState)
    graph.add_node("priority_agent", priority_agent)
    graph.add_node("planner_agent", planner_agent)
    graph.add_node("feasibility_agent", feasibility_agent)
    graph.add_node("reviewer_agent", reviewer_agent)
    graph.add_node("revision_router", record_routing)
    graph.add_node("finalize", finalize)
    graph.add_edge(START, "priority_agent")
    graph.add_edge("priority_agent", "planner_agent")
    graph.add_edge("planner_agent", "feasibility_agent")
    graph.add_edge("feasibility_agent", "reviewer_agent")
    graph.add_edge("reviewer_agent", "revision_router")
    graph.add_conditional_edges(
        "revision_router",
        select_route,
        {"planner_agent": "planner_agent", "finalize": "finalize"},
    )
    graph.add_edge("finalize", END)
    return graph.compile()


def generate_plan(
    request: StudyPlanRequest,
    *,
    priority_model: PriorityModel | None = None,
    planner_model: PlannerModel | None = None,
    reviewer_model: ReviewerModel | None = None,
    reserved_sessions: list[StudySession] | None = None,
    now: datetime | None = None,
) -> PlanResponse:
    local_datetime = now or local_now()
    if local_datetime.tzinfo is None:
        local_datetime = local_datetime.replace(tzinfo=ZoneInfo(settings.timezone))
    local_datetime = local_datetime.astimezone(ZoneInfo(settings.timezone))
    injected_models = any(
        model is not None
        for model in (priority_model, planner_model, reviewer_model)
    )
    configured_models = create_groq_agents() if not injected_models else None
    if configured_models is not None:
        priority_model, planner_model, reviewer_model = configured_models
    state = build_plan_graph(
        priority_model,
        planner_model,
        reviewer_model,
    ).invoke(
        {
            "request": request,
            "reserved_sessions": reserved_sessions or [],
            "as_of": local_datetime.date(),
            "now": local_datetime,
            "revision_count": 0,
            "revision_feedback": [],
            "revision_focus_topic_ids": [],
            "trace": [],
        }
    )
    return PlanResponse(
        schedule=state["schedule"],
        topic_priorities=state["priorities"],
        feasibility=state["feasibility"],
        reviewer_feedback=state["reviewer_feedback"],
        revision_count=state["revision_count"],
        passed_feasibility=state["feasibility"].passed,
        warnings=state["warnings"],
        agent_mode=(
            "groq"
            if any(entry.provider == "groq" for entry in state["trace"])
            else "deterministic_fallback"
        ),
        execution_trace=state["trace"],
    )
