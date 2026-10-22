import { useEffect, useState } from 'react'
import {
  fetchAcademicOverview,
  fetchHealth,
  type AcademicOverview,
} from './lib/api'

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`))
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours && remainder) return `${hours}h ${remainder}m`
  if (hours) return `${hours}h`
  return `${remainder}m`
}

function agentLabel(node: string): string {
  const labels: Record<string, string> = {
    priority_agent: 'Priority Agent',
    planner_agent: 'Planner Agent',
    feasibility_agent: 'Feasibility Agent',
    reviewer_agent: 'Reviewer Agent',
    revision_router: 'Revision router',
    finalize: 'Plan finalization',
  }
  return labels[node] ?? node
}

function providerLabel(provider: string | null): string {
  if (provider === 'groq') return 'Groq'
  if (provider === 'deterministic_fallback') return 'Deterministic fallback'
  if (provider === 'deterministic') return 'Deterministic'
  if (provider === 'langgraph_conditional') return 'Conditional route'
  return provider ?? 'Provider not recorded'
}

function BackendConnectionStatus() {
  const [state, setState] = useState<'loading' | 'connected' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    fetchHealth(controller.signal)
      .then(() => setState('connected'))
      .catch(() => {
        if (!controller.signal.aborted) setState('error')
      })
    return () => controller.abort()
  }, [])

  const label =
    state === 'loading'
      ? 'Checking backend…'
      : state === 'connected'
        ? 'Backend connected'
        : 'Backend unavailable'

  return (
    <span className={`backend-status is-${state}`} role="status" aria-live="polite">
      <span className="backend-status-dot" aria-hidden="true" />
      {label}
    </span>
  )
}

export function DashboardPage({
  onCreatePlan,
  onOpenPlan,
  onOpenAnalytics,
  onOpenActivity,
}: {
  onCreatePlan: () => void
  onOpenPlan: (planId: string) => void
  onOpenAnalytics: () => void
  onOpenActivity: () => void
}) {
  const [overview, setOverview] = useState<AcademicOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchAcademicOverview(controller.signal)
      .then((data) => setOverview(data))
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load the academic overview.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [reloadCount])

  return (
    <>
      <div className="page-heading dashboard-heading">
        <p className="page-kicker">YOUR STUDY SPACE AT A GLANCE</p>
        <div className="dashboard-title-row">
          <div>
            <h1>Dashboard</h1>
            <p className="page-description">
              A live overview of saved plans, session progress, and recorded agent work.
            </p>
          </div>
          <BackendConnectionStatus />
        </div>
      </div>

      <div className="dashboard-actions" aria-label="Dashboard actions">
        <button className="generate-button" type="button" onClick={onCreatePlan}>
          Create a study plan <span aria-hidden="true">→</span>
        </button>
        <button className="secondary-action" type="button" onClick={onOpenAnalytics}>
          Progress Analytics
        </button>
        <button className="secondary-action" type="button" onClick={onOpenActivity}>
          Agent Activity
        </button>
      </div>

      {isLoading && (
        <p className="request-loading" role="status">
          <span className="request-spinner" aria-hidden="true" />
          Loading your academic overview…
        </p>
      )}
      {error && (
        <div className="request-error" role="alert">
          <strong>Dashboard data could not be loaded.</strong>
          <p>{error}</p>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              setIsLoading(true)
              setError('')
              setReloadCount((count) => count + 1)
            }}
          >
            Try again
          </button>
        </div>
      )}
      {!isLoading && !error && overview && (
        <>
          <section className="analytics-metrics dashboard-metrics" aria-label="Academic summary">
            <article className="analytics-metric">
              <span>Saved plans</span>
              <strong>{overview.totalPlans}</strong>
              <small>Plans stored in this workspace</small>
            </article>
            <article className="analytics-metric">
              <span>Scheduled sessions</span>
              <strong>{overview.totalScheduledSessions}</strong>
              <small>Sessions in current saved schedules</small>
            </article>
            <article className="analytics-metric">
              <span>Completion rate</span>
              <strong>{overview.completionRatePercent}%</strong>
              <small>
                Completed ÷ {overview.trackedSessions} sessions with a recorded outcome
              </small>
            </article>
            <article className="analytics-metric">
              <span>Recorded study time</span>
              <strong>{formatMinutes(overview.recordedStudyMinutes)}</strong>
              <small>Only minutes explicitly entered in progress updates</small>
            </article>
          </section>

          <section className="analytics-outcomes" aria-label="Recorded session outcomes">
            <div><span className="outcome-dot is-completed" />Completed <strong>{overview.completedSessions}</strong></div>
            <div><span className="outcome-dot is-partial" />Partially completed <strong>{overview.partiallyCompletedSessions}</strong></div>
            <div><span className="outcome-dot is-missed" />Missed <strong>{overview.missedSessions}</strong></div>
            <small>Outcomes count each saved session record once, including recorded outcomes from replaced schedules.</small>
          </section>

          <div className="dashboard-content-grid">
            <section className="analytics-plan-section">
              <div className="result-section-heading">
                <h2>Upcoming sessions</h2>
                <span>{overview.upcomingSessions.length}</span>
              </div>
              {overview.upcomingSessions.length === 0 ? (
                <p className="result-empty">
                  No upcoming scheduled sessions. Create a plan or replan an existing one.
                </p>
              ) : (
                <div className="dashboard-session-list">
                  {overview.upcomingSessions.map((session) => (
                    <article className="dashboard-session-row" key={session.sessionId}>
                      <div className="dashboard-session-date">
                        <strong>{formatDate(session.date)}</strong>
                        <span>{session.startTime.slice(0, 5)}–{session.endTime.slice(0, 5)}</span>
                      </div>
                      <div className="dashboard-session-subject">
                        <strong>{session.topic}</strong>
                        <span>{session.subject} · {session.durationMinutes} min</span>
                      </div>
                      <button
                        className="text-action"
                        type="button"
                        onClick={() => onOpenPlan(session.planId)}
                      >
                        Open plan
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="analytics-plan-section">
              <div className="result-section-heading">
                <h2>Recently updated plans</h2>
                <span>{overview.recentPlans.length}</span>
              </div>
              {overview.recentPlans.length === 0 ? (
                <p className="result-empty">
                  Your saved plans will appear here after you generate one.
                </p>
              ) : (
                <div className="analytics-plan-list">
                  {overview.recentPlans.slice(0, 5).map((plan) => (
                    <article className="analytics-plan-row" key={plan.planId}>
                      <div>
                        <strong>Plan {plan.planId.slice(0, 8)}</strong>
                        <span>Updated {formatDateTime(plan.updatedAt)} · {plan.sessionCount} current sessions</span>
                      </div>
                      <span className={`feasibility-indicator ${plan.passedFeasibility ? 'is-passed' : 'is-failed'}`}>
                        {plan.passedFeasibility ? 'Feasible' : 'Needs review'}
                      </span>
                      <button className="secondary-action" type="button" onClick={() => onOpenPlan(plan.planId)}>
                        Open plan
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="analytics-plan-section dashboard-activity-section">
            <div className="result-section-heading">
              <h2>Recent agent activity</h2>
              <button className="text-action" type="button" onClick={onOpenActivity}>
                View all activity
              </button>
            </div>
            {overview.recentAgentActivity.length === 0 ? (
              <p className="result-empty">
                No saved agent traces yet. Generate a plan to see actual node executions.
              </p>
            ) : (
              <ol className="dashboard-activity-list">
                {overview.recentAgentActivity.slice(0, 5).map((entry, index) => (
                  <li key={`${entry.planId}-${entry.node}-${entry.revision}-${index}`}>
                    <div>
                      <strong>{agentLabel(entry.node)}</strong>
                      <span>Plan {entry.planId.slice(0, 8)} · Revision {entry.revision}</span>
                    </div>
                    <p>{entry.decision}</p>
                    <span className={`trace-provider provider-${entry.provider ?? 'unknown'}`}>
                      {providerLabel(entry.provider)}
                    </span>
                    <button className="text-action" type="button" onClick={() => onOpenPlan(entry.planId)}>
                      Open plan
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </>
  )
}
