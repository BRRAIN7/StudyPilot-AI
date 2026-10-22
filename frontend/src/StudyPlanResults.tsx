import { useState, type ReactNode } from 'react'
import type {
  ProgressStatus,
  SavedStudyPlan,
} from './lib/api'

const agentNames: Record<string, string> = {
  priority_agent: 'Priority Agent',
  planner_agent: 'Planner Agent',
  feasibility_agent: 'Feasibility Agent',
  reviewer_agent: 'Reviewer Agent',
  revision_router: 'Revision router',
  finalize: 'Plan finalization',
}

function formatDate(value: string, timezone: string): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(date)
}

function formatTime(value: string): string {
  const [hours = '0', minutes = '00'] = value.split(':')
  const date = new Date()
  date.setHours(Number(hours), Number(minutes), 0, 0)
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours && remainingMinutes) return `${hours}h ${remainingMinutes}m`
  if (hours) return `${hours}h`
  return `${remainingMinutes}m`
}

function ResultSection({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <section className="result-section">
      <div className="result-section-heading">
        <h2>{title}</h2>
        {count !== undefined && <span>{count}</span>}
      </div>
      {children}
    </section>
  )
}

export function StudyPlanResults({
  plan,
  onEdit,
  onProgressUpdate,
  progressBusySessionId,
  progressMessage,
  progressError,
  onReplan,
  isReplanning,
}: {
  plan: SavedStudyPlan
  onEdit: () => void
  onProgressUpdate: (
    sessionId: string,
    status: Exclude<ProgressStatus, 'scheduled'>,
    actualMinutes?: number,
  ) => void
  progressBusySessionId: string | null
  progressMessage: string
  progressError: string
  onReplan: () => void
  isReplanning: boolean
}) {
  const [actualMinutesBySession, setActualMinutesBySession] = useState<
    Record<string, string>
  >({})
  const groupedSessions = new Map<
    string,
    SavedStudyPlan['schedule']
  >()
  for (const session of [...plan.schedule].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.startTime.localeCompare(right.startTime),
  )) {
    const group = groupedSessions.get(session.date) ?? []
    group.push(session)
    groupedSessions.set(session.date, group)
  }

  const hasIssues =
    !plan.passedFeasibility ||
    !plan.reviewerFeedback.approved ||
    plan.warnings.length > 0

  return (
    <div className="plan-results">
      <div className={`plan-outcome ${hasIssues ? 'has-issues' : 'is-feasible'}`}>
        <div className="plan-outcome-copy">
          <span className="plan-outcome-label">
            {hasIssues ? 'REVIEW BEFORE YOU RELY ON THIS PLAN' : 'PLAN READY'}
          </span>
          <h2>
            {plan.passedFeasibility
              ? 'All scheduled work fits the current constraints'
              : 'This plan has unresolved feasibility issues'}
          </h2>
          <p>
            {plan.passedFeasibility
              ? plan.reviewerFeedback.rationale
              : 'Some topic estimates or schedule constraints remain unresolved. Review the findings below.'}
          </p>
        </div>
        <span className="plan-outcome-badge">
          {plan.passedFeasibility ? 'Feasibility passed' : 'Issues found'}
        </span>
      </div>

      <div className="plan-result-toolbar">
        <div>
          <span className="plan-mode-badge">
            {plan.agentMode === 'groq'
              ? 'LLM-backed agents'
              : 'Deterministic fallback'}
          </span>
          <span className="plan-result-meta">
            {plan.revisionCount} {plan.revisionCount === 1 ? 'revision' : 'revisions'}
            {' · '}
            {plan.timezone}
            {' · '}
            {plan.replanCount} {plan.replanCount === 1 ? 'replan' : 'replans'}
          </span>
        </div>
        <div className="plan-toolbar-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={onReplan}
            disabled={isReplanning || progressBusySessionId !== null}
          >
            {isReplanning ? 'Replanning…' : 'Replan remaining schedule'}
          </button>
          <button className="secondary-action" type="button" onClick={onEdit}>
            Back to planner
          </button>
        </div>
      </div>
      {progressMessage && (
        <p className="progress-notice" role="status">{progressMessage}</p>
      )}
      {progressError && (
        <div className="request-error" role="alert">
          <strong>Progress update failed.</strong>
          <p>{progressError}</p>
        </div>
      )}
      {isReplanning && (
        <p className="request-loading" role="status">
          <span className="request-spinner" aria-hidden="true" />
          Rechecking remaining workload, deadlines, and agent feedback…
        </p>
      )}

      <ResultSection title="Study sessions" count={plan.schedule.length}>
        {groupedSessions.size === 0 ? (
          <p className="result-empty">
            No sessions were scheduled. Check the exam dates and available study
            days, then revise your inputs.
          </p>
        ) : (
          <div className="session-days">
            {[...groupedSessions.entries()].map(([day, sessions]) => (
              <section className="session-day" key={day}>
                <h3>{formatDate(day, plan.timezone)}</h3>
                <div className="session-list">
                  {sessions.map((session, index) => (
                    <article
                      className="session-row"
                      key={`${session.topicId}-${session.date}-${session.startTime}-${index}`}
                    >
                      <div className="session-time">
                        <strong>{formatTime(session.startTime)}</strong>
                        <span>to {formatTime(session.endTime)}</span>
                      </div>
                      <div className="session-details">
                        <strong>{session.topic}</strong>
                        <span>{session.subject}</span>
                      </div>
                      <span className="session-duration">
                        {minutesLabel(session.durationMinutes)}
                      </span>
                      <div className="session-progress">
                        <span className={`session-status is-${session.progressStatus}`}>
                          {session.progressStatus.replaceAll('_', ' ')}
                        </span>
                        {session.isCurrent &&
                          session.progressStatus === 'scheduled' && (
                            <div className="session-progress-controls">
                              <label className="actual-time-field">
                                Actual minutes
                                <input
                                  type="number"
                                  min="0"
                                  max={session.durationMinutes}
                                  step="1"
                                  value={actualMinutesBySession[session.sessionId] ?? ''}
                                  onChange={(event) =>
                                    setActualMinutesBySession((current) => ({
                                      ...current,
                                      [session.sessionId]: event.target.value,
                                    }))
                                  }
                                  placeholder="Optional"
                                  aria-label={`Actual minutes for ${session.topic}`}
                                  disabled={
                                    isReplanning ||
                                    progressBusySessionId !== null
                                  }
                                />
                              </label>
                              {(
                                [
                                  ['completed', 'Complete'],
                                  ['partially_completed', 'Partial'],
                                  ['missed', 'Missed'],
                                ] as const
                              ).map(([status, label]) => {
                                const rawMinutes =
                                  actualMinutesBySession[session.sessionId]
                                const actualMinutes =
                                  rawMinutes === undefined || rawMinutes === ''
                                    ? undefined
                                    : Number(rawMinutes)
                                return (
                                  <button
                                    className="progress-action"
                                    key={status}
                                    type="button"
                                    disabled={
                                      isReplanning ||
                                      progressBusySessionId !== null ||
                                      (status === 'partially_completed' &&
                                        actualMinutes !== undefined &&
                                        actualMinutes >= session.durationMinutes)
                                    }
                                    onClick={() =>
                                      onProgressUpdate(
                                        session.sessionId,
                                        status,
                                        status === 'missed'
                                          ? undefined
                                          : actualMinutes,
                                      )
                                    }
                                  >
                                    {progressBusySessionId === session.sessionId
                                      ? 'Saving…'
                                      : label}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        {session.actualMinutes !== null && (
                          <span className="session-actual-time">
                            {session.actualMinutes} min recorded
                          </span>
                        )}
                        {session.progressHistory.length > 0 && (
                          <span className="session-history-count">
                            {session.progressHistory.length} progress update
                            {session.progressHistory.length === 1 ? '' : 's'} recorded
                          </span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </ResultSection>

      <ResultSection title="Topic priorities" count={plan.topicPriorities.length}>
        {plan.topicPriorities.length === 0 ? (
          <p className="result-empty">No topic priorities were returned.</p>
        ) : (
          <div className="priority-list">
            {plan.topicPriorities.map((priority) => (
              <article className="priority-row" key={priority.topicId}>
                <span className="priority-rank">
                  {String(priority.rank).padStart(2, '0')}
                </span>
                <div className="priority-details">
                  <div className="priority-title-line">
                    <strong>{priority.topicName}</strong>
                    <span>{priority.subjectName}</span>
                  </div>
                  <p>{priority.explanation}</p>
                </div>
                <span className="priority-score">
                  {priority.priorityScore.toFixed(1)}
                </span>
              </article>
            ))}
          </div>
        )}
      </ResultSection>

      <ResultSection title="Feasibility & coverage">
        <div className="feasibility-summary">
          <span
            className={`feasibility-indicator ${
              plan.feasibility.passed ? 'is-passed' : 'is-failed'
            }`}
          >
            {plan.feasibility.passed ? 'Passed' : 'Not passed'}
          </span>
          <span>
            {plan.feasibility.coverage.filter(
              (topic) => topic.remainingMinutes > 0,
            ).length}{' '}
            topic(s) with remaining unscheduled time
          </span>
        </div>
        {plan.feasibility.coverage.length > 0 && (
          <div className="coverage-list">
            {plan.feasibility.coverage.map((topic) => (
              <div className="coverage-row" key={topic.topicId}>
                <div>
                  <strong>{topic.topic}</strong>
                  <span>{topic.subject}</span>
                </div>
                <span>
                  {minutesLabel(topic.completedMinutes + topic.scheduledMinutes)}
                  {' / '}
                  {minutesLabel(topic.estimatedMinutes)}
                  {topic.remainingMinutes > 0 && (
                    <em> · {minutesLabel(topic.remainingMinutes)} left</em>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        {plan.feasibility.findings.length > 0 ? (
          <ul className="finding-list">
            {plan.feasibility.findings.map((finding, index) => (
              <li className={`finding-item is-${finding.severity}`} key={`${finding.code}-${index}`}>
                <span>{finding.severity}</span>
                <p>
                  {finding.message}
                  {finding.date && (
                    <small> · {formatDate(finding.date, plan.timezone)}</small>
                  )}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="result-empty compact">
            No feasibility findings were reported.
          </p>
        )}
      </ResultSection>

      <ResultSection title="Reviewer feedback">
        <div className="reviewer-summary">
          <span
            className={`feasibility-indicator ${
              plan.reviewerFeedback.approved ? 'is-passed' : 'is-failed'
            }`}
          >
            {plan.reviewerFeedback.approved ? 'Approved' : 'Revision not approved'}
          </span>
          <p>{plan.reviewerFeedback.rationale}</p>
        </div>
        {plan.reviewerFeedback.feedback.length > 0 && (
          <ul className="message-list">
            {plan.reviewerFeedback.feedback.map((feedback, index) => (
              <li key={`${feedback}-${index}`}>{feedback}</li>
            ))}
          </ul>
        )}
        {plan.warnings.length > 0 && (
          <div className="warning-box">
            <strong>Plan warnings</strong>
            <ul className="message-list">
              {plan.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.reviewerFeedback.warnings.length > 0 && (
          <div className="warning-box">
            <strong>Reviewer notes</strong>
            <ul className="message-list">
              {plan.reviewerFeedback.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </ResultSection>

      <ResultSection title="Agent activity" count={plan.executionTrace.length}>
        <div className="trace-mode">
          Agent mode reported by backend:{' '}
          <strong>
            {plan.agentMode === 'groq'
              ? 'Groq / LLM-backed'
              : 'deterministic fallback'}
          </strong>
        </div>
        {plan.executionTrace.length === 0 ? (
          <p className="result-empty">The backend returned no execution trace.</p>
        ) : (
          <ol className="trace-list">
            {plan.executionTrace.map((entry, index) => (
              <li
                className="trace-entry"
                key={`${entry.node}-${entry.revision}-${index}`}
              >
                <span className="trace-step">{String(index + 1).padStart(2, '0')}</span>
                <div className="trace-entry-content">
                  <div className="trace-title-line">
                    <strong>{agentNames[entry.node] ?? entry.node}</strong>
                    {entry.provider && (
                      <span className="trace-provider">
                        {entry.provider === 'groq'
                          ? 'Groq'
                          : entry.provider === 'deterministic_fallback'
                            ? 'Fallback'
                            : entry.provider}
                      </span>
                    )}
                  </div>
                  <p>{entry.decision}</p>
                  <div className="trace-meta">
                    <span>Revision {entry.revision}</span>
                    {entry.routedTo && <span>Routed to {agentNames[entry.routedTo] ?? entry.routedTo}</span>}
                  </div>
                  {entry.feedback.length > 0 && (
                    <ul className="trace-feedback">
                      {entry.feedback.map((feedback, feedbackIndex) => (
                        <li key={`${feedback}-${feedbackIndex}`}>{feedback}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </ResultSection>

      <div className="results-footer-action">
        <button className="generate-button" type="button" onClick={onEdit}>
          Revise inputs and generate again
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  )
}
