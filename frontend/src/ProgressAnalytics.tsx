import { useEffect, useState } from 'react'
import {
  fetchProgressAnalytics,
  type ProgressAnalytics,
} from './lib/api'

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours && remainder) return `${hours}h ${remainder}m`
  if (hours) return `${hours}h`
  return `${remainder}m`
}

export function ProgressAnalyticsPage({
  onOpenPlan,
}: {
  onOpenPlan: (planId: string) => void
}) {
  const [analytics, setAnalytics] = useState<ProgressAnalytics | null>(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchProgressAnalytics(controller.signal)
      .then((result) => setAnalytics(result))
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load saved progress.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [reloadCount])

  return (
    <>
      <div className="page-heading">
        <p className="page-kicker">MEASURE WHAT YOU HAVE RECORDED</p>
        <h1>Progress Analytics</h1>
        <p className="page-description">
          A summary of saved plans and session outcomes recorded in this
          workspace. Only explicitly recorded study time is included.
        </p>
      </div>

      {isLoading && (
        <p className="request-loading" role="status">
          <span className="request-spinner" aria-hidden="true" />
          Loading saved progress…
        </p>
      )}
      {error && (
        <div className="request-error analytics-error" role="alert">
          <strong>Progress could not be loaded.</strong>
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
      {!isLoading && !error && analytics && (
        <>
          <section className="analytics-metrics" aria-label="Study progress metrics">
            <article className="analytics-metric">
              <span>Saved plans</span>
              <strong>{analytics.totalPlans}</strong>
              <small>{analytics.totalSessions} current scheduled sessions</small>
            </article>
            <article className="analytics-metric">
              <span>Completed sessions</span>
              <strong>{analytics.completedSessions}</strong>
              <small>{analytics.trackedSessions} sessions have a recorded outcome</small>
            </article>
            <article className="analytics-metric">
              <span>Completion rate</span>
              <strong>{analytics.completionRatePercent}%</strong>
              <small>Completed outcomes among sessions with recorded progress</small>
            </article>
            <article className="analytics-metric">
              <span>Recorded study time</span>
              <strong>{formatMinutes(analytics.recordedStudyMinutes)}</strong>
              <small>Only minutes explicitly entered during progress updates</small>
            </article>
          </section>

          <section className="analytics-outcomes" aria-label="Session outcomes">
            <div>
              <span className="outcome-dot is-completed" />
              Completed <strong>{analytics.completedSessions}</strong>
            </div>
            <div>
              <span className="outcome-dot is-partial" />
              Partially completed{' '}
              <strong>{analytics.partiallyCompletedSessions}</strong>
            </div>
            <div>
              <span className="outcome-dot is-missed" />
              Missed <strong>{analytics.missedSessions}</strong>
            </div>
          </section>

          <section className="analytics-plan-section">
            <div className="result-section-heading">
              <h2>Recent saved plans</h2>
              <span>{analytics.recentPlans.length}</span>
            </div>
            {analytics.recentPlans.length === 0 ? (
              <p className="result-empty">
                No saved plans yet. Generate a study plan to begin tracking
                progress here.
              </p>
            ) : (
              <div className="analytics-plan-list">
                {analytics.recentPlans.map((plan) => (
                  <article className="analytics-plan-row" key={plan.planId}>
                    <div>
                      <strong>Plan {plan.planId.slice(0, 8)}</strong>
                      <span>
                        Updated {formatDate(plan.updatedAt)} · {plan.sessionCount}{' '}
                        current sessions
                      </span>
                    </div>
                    <span
                      className={`feasibility-indicator ${
                        plan.passedFeasibility ? 'is-passed' : 'is-failed'
                      }`}
                    >
                      {plan.passedFeasibility ? 'Feasible' : 'Needs review'}
                    </span>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => onOpenPlan(plan.planId)}
                    >
                      Open saved plan
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}
