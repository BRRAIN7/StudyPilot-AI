import { useEffect, useState } from 'react'
import {
  fetchAgentActivity,
  type AgentActivityPlan,
} from './lib/api'

const agentNames: Record<string, string> = {
  priority_agent: 'Priority Agent',
  planner_agent: 'Planner Agent',
  feasibility_agent: 'Feasibility Agent',
  reviewer_agent: 'Reviewer Agent',
  revision_router: 'Revision router',
  finalize: 'Plan finalization',
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function providerLabel(provider: string | null): string {
  if (provider === 'groq') return 'Groq LLM call'
  if (provider === 'deterministic_fallback') return 'Deterministic fallback'
  if (provider === 'deterministic') return 'Deterministic'
  if (provider === 'langgraph_conditional') return 'LangGraph conditional route'
  return provider ?? 'Provider not recorded'
}

export function AgentActivityPage() {
  const [plans, setPlans] = useState<AgentActivityPlan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchAgentActivity(controller.signal)
      .then((response) => {
        setPlans(response.plans)
        setSelectedPlanId((current) =>
          response.plans.some((plan) => plan.planId === current)
            ? current
            : response.plans[0]?.planId ?? '',
        )
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load saved agent activity.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [])

  const selectedPlan = plans.find((plan) => plan.planId === selectedPlanId)

  return (
    <>
      <div className="page-heading">
        <p className="page-kicker">INSPECT RECORDED AGENT WORK</p>
        <h1>Agent Activity</h1>
        <p className="page-description">
          Review the execution trace stored with each generated or replanned
          study plan. Provider labels come directly from the recorded trace.
        </p>
      </div>

      {isLoading && (
        <p className="request-loading" role="status">
          <span className="request-spinner" aria-hidden="true" />
          Loading saved execution traces…
        </p>
      )}
      {error && (
        <div className="request-error" role="alert">
          <strong>Agent activity could not be loaded.</strong>
          <p>{error}</p>
          <span>Check the backend connection and revisit this page to retry.</span>
        </div>
      )}
      {!isLoading && !error && plans.length === 0 && (
        <section className="placeholder-card">
          <div className="placeholder-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="placeholder-label">NO RECORDED RUNS</p>
          <h2>No saved agent activity yet</h2>
          <p>Generate a study plan to save and inspect its real execution trace.</p>
        </section>
      )}
      {!isLoading && !error && plans.length > 0 && (
        <section className="activity-panel">
          <div className="activity-plan-picker">
            <label htmlFor="activity-plan-select">Saved study plan</label>
            <select
              id="activity-plan-select"
              className="planner-input"
              value={selectedPlanId}
              onChange={(event) => setSelectedPlanId(event.target.value)}
            >
              {plans.map((plan) => (
                <option key={plan.planId} value={plan.planId}>
                  {formatDateTime(plan.createdAt)} · {plan.planId.slice(0, 8)}
                </option>
              ))}
            </select>
            {selectedPlan && (
              <span>
                Updated {formatDateTime(selectedPlan.updatedAt)} ·{' '}
                {selectedPlan.agentMode === 'groq'
                  ? 'At least one recorded Groq call'
                  : 'No successful Groq calls recorded'}
              </span>
            )}
          </div>

          {!selectedPlan || selectedPlan.executionTrace.length === 0 ? (
            <p className="result-empty">
              This saved plan has no execution trace entries.
            </p>
          ) : (
            <ol className="trace-list activity-trace-list">
              {selectedPlan.executionTrace.map((entry, index) => (
                <li
                  className="trace-entry"
                  key={`${entry.node}-${entry.revision}-${index}`}
                >
                  <span className="trace-step">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="trace-entry-content">
                    <div className="trace-title-line">
                      <strong>{agentNames[entry.node] ?? entry.node}</strong>
                      <span className={`trace-provider provider-${entry.provider ?? 'unknown'}`}>
                        {providerLabel(entry.provider)}
                      </span>
                    </div>
                    <p>{entry.decision}</p>
                    <div className="trace-meta">
                      <span>Execution {index + 1}</span>
                      <span>Revision {entry.revision}</span>
                      {entry.routedTo && (
                        <span>
                          Routed to {agentNames[entry.routedTo] ?? entry.routedTo}
                        </span>
                      )}
                    </div>
                    {entry.feedback.length > 0 && (
                      <ul className="trace-feedback">
                        {entry.feedback.map((message, feedbackIndex) => (
                          <li key={`${message}-${feedbackIndex}`}>{message}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  )
}
