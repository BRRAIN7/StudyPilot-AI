import { useEffect, useMemo, useState } from 'react'
import {
  fetchAcademicOverview,
  type AcademicOverview,
  type OverviewSubject,
  type OverviewTopic,
  type ProgressStatus,
} from './lib/api'

type StatusFilter = 'all' | ProgressStatus

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`))
}

function progressFor(topic: OverviewTopic): number | null {
  if (topic.estimatedHours === null || topic.estimatedHours <= 0) return null
  const sessionsById = new Map(
    topic.sessions.map((session) => [session.sessionId, session]),
  )
  const creditedMinutes = [...sessionsById.values()].reduce((total, session) => {
    if (session.progressStatus === 'completed') {
      return total + (session.actualMinutes ?? session.durationMinutes)
    }
    if (session.progressStatus === 'partially_completed') {
      return total + (session.actualMinutes ?? 0)
    }
    return total
  }, 0)
  return Math.min(
    100,
    Math.round((creditedMinutes / (topic.estimatedHours * 60)) * 100),
  )
}

function statusLabel(status: ProgressStatus): string {
  return status.replaceAll('_', ' ')
}

function matchesStatus(
  session: OverviewTopic['sessions'][number],
  status: StatusFilter,
): boolean {
  if (status === 'all') return true
  if (status === 'scheduled') {
    return session.isCurrent && session.progressStatus === 'scheduled'
  }
  return session.progressStatus === status
}

function countsFor(topic: OverviewTopic) {
  const sessions = [...new Map(
    topic.sessions.map((session) => [session.sessionId, session]),
  ).values()]
  return {
    scheduled: sessions.filter(
      (session) => session.isCurrent && session.progressStatus === 'scheduled',
    ).length,
    completed: sessions.filter((session) => session.progressStatus === 'completed').length,
    partiallyCompleted: sessions.filter(
      (session) => session.progressStatus === 'partially_completed',
    ).length,
    missed: sessions.filter((session) => session.progressStatus === 'missed').length,
    sessions,
  }
}

function TopicCard({
  subject,
  topic,
  statusFilter,
  onOpenPlan,
}: {
  subject: OverviewSubject
  topic: OverviewTopic
  statusFilter: StatusFilter
  onOpenPlan: (planId: string) => void
}) {
  const counts = countsFor(topic)
  const matchingSessions =
    statusFilter === 'all'
      ? counts.sessions
      : counts.sessions.filter((session) =>
          matchesStatus(session, statusFilter),
        )
  const progress = progressFor(topic)

  return (
    <article className="topic-work-card">
      <div className="topic-work-heading">
        <div>
          <p className="page-kicker">{subject.subjectName}</p>
          <h3>{topic.topicName}</h3>
        </div>
        <button
          className="text-action"
          type="button"
          onClick={() => onOpenPlan(topic.sourcePlanId)}
        >
          Open saved plan
        </button>
      </div>
      <div className="topic-work-meta">
        {subject.examDate && <span>Exam {formatDate(subject.examDate)}</span>}
        {subject.priority && <span>{subject.priority} priority</span>}
        {topic.difficulty && <span>{topic.difficulty}</span>}
        {topic.preparationLevel && <span>{topic.preparationLevel}</span>}
        {topic.estimatedHours !== null && (
          <span>{topic.estimatedHours}h estimated</span>
        )}
      </div>

      <div className="topic-progress">
        <div className="topic-progress-heading">
          <strong>Topic progress</strong>
          <span>{progress === null ? 'Estimate unavailable' : `${progress}%`}</span>
        </div>
        {progress !== null && (
          <div
            className="topic-progress-track"
            role="progressbar"
            aria-label={`${topic.topicName} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
        <small>
          Completed sessions count actual minutes when provided, otherwise scheduled duration;
          partial sessions count only explicitly entered minutes. Missed and scheduled sessions
          count as zero. The total is capped at the latest saved topic estimate.
        </small>
      </div>

      <div className="topic-session-counts" aria-label="Topic session counts">
        <span>Scheduled <strong>{counts.scheduled}</strong></span>
        <span>Completed <strong>{counts.completed}</strong></span>
        <span>Partial <strong>{counts.partiallyCompleted}</strong></span>
        <span>Missed <strong>{counts.missed}</strong></span>
      </div>

      <details className="topic-session-details">
        <summary>
          Inspect sessions ({matchingSessions.length}
          {statusFilter === 'all' ? '' : ` matching ${statusLabel(statusFilter)}`})
        </summary>
        {matchingSessions.length === 0 ? (
          <p className="result-empty">No sessions match this progress filter.</p>
        ) : (
          <ul className="topic-session-list">
            {matchingSessions.map((session) => (
              <li key={session.sessionId}>
                <div>
                  <strong>{formatDate(session.date)} · {session.startTime.slice(0, 5)}–{session.endTime.slice(0, 5)}</strong>
                  <span>
                    {session.durationMinutes} scheduled minutes
                    {session.actualMinutes !== null
                      ? ` · ${session.actualMinutes} recorded minutes`
                      : ''}
                    {!session.isCurrent ? ' · Archived schedule' : ''}
                  </span>
                </div>
                <span className={`session-status is-${session.progressStatus}`}>
                  {statusLabel(session.progressStatus)}
                </span>
                <button
                  className="text-action"
                  type="button"
                  onClick={() => onOpenPlan(session.planId)}
                >
                  Open plan
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </article>
  )
}

export function SubjectsTasksPage({
  onCreatePlan,
  onOpenPlan,
}: {
  onCreatePlan: () => void
  onOpenPlan: (planId: string) => void
}) {
  const [overview, setOverview] = useState<AcademicOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadCount, setReloadCount] = useState(0)
  const [selectedSubject, setSelectedSubject] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    const controller = new AbortController()
    fetchAcademicOverview(controller.signal)
      .then(setOverview)
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load saved subjects and tasks.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [reloadCount])

  const subjectNames = useMemo(
    () => overview?.subjects.map((subject) => subject.subjectName) ?? [],
    [overview],
  )
  const visibleSubjects = useMemo(
    () =>
      (overview?.subjects ?? [])
        .filter(
          (subject) =>
            selectedSubject === 'all' ||
            subject.subjectName === selectedSubject,
        )
        .map((subject) => ({
          ...subject,
          topics: subject.topics.filter(
            (topic) =>
              statusFilter === 'all' ||
              topic.sessions.some((session) =>
                matchesStatus(session, statusFilter),
              ),
          ),
        })),
    [overview, selectedSubject, statusFilter],
  )
  const visibleTopicCount = visibleSubjects.reduce(
    (total, subject) => total + subject.topics.length,
    0,
  )

  return (
    <>
      <div className="page-heading">
        <p className="page-kicker">YOUR SAVED SYLLABUS WORKSPACE</p>
        <h1>Subjects &amp; Tasks</h1>
        <p className="page-description">
          Subjects and topics are derived from saved study-plan inputs. Session counts include
          saved schedule records; only active scheduled sessions count as scheduled.
        </p>
      </div>

      <div className="dashboard-actions">
        <button className="generate-button" type="button" onClick={onCreatePlan}>
          Generate a study plan <span aria-hidden="true">→</span>
        </button>
        {overview?.recentPlans[0] && (
          <button
            className="secondary-action"
            type="button"
            onClick={() => onOpenPlan(overview.recentPlans[0].planId)}
          >
            Open most recent plan
          </button>
        )}
      </div>

      {isLoading && (
        <p className="request-loading" role="status">
          <span className="request-spinner" aria-hidden="true" />
          Loading saved subjects and tasks…
        </p>
      )}
      {error && (
        <div className="request-error" role="alert">
          <strong>Subjects and tasks could not be loaded.</strong>
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
          <section className="workspace-filters" aria-label="Filter saved topics">
            <label>
              Subject
              <select
                className="planner-input"
                value={selectedSubject}
                onChange={(event) => setSelectedSubject(event.target.value)}
              >
                <option value="all">All subjects</option>
                {subjectNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Session progress
              <select
                className="planner-input"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="all">All progress</option>
                <option value="scheduled">Scheduled</option>
                <option value="completed">Completed</option>
                <option value="partially_completed">Partially completed</option>
                <option value="missed">Missed</option>
              </select>
            </label>
            <span>{visibleTopicCount} topics</span>
          </section>

          {overview.subjects.length === 0 ? (
            <section className="placeholder-card">
              <p className="placeholder-label">NO SAVED SUBJECTS</p>
              <h2>Your subjects will appear here</h2>
              <p>Generate a study plan to add your exam subjects and syllabus topics.</p>
              <button className="generate-button" type="button" onClick={onCreatePlan}>
                Create your first plan <span aria-hidden="true">→</span>
              </button>
            </section>
          ) : visibleTopicCount === 0 ? (
            <p className="result-empty">
              No saved topics match these filters. Try another subject or progress status.
            </p>
          ) : (
            <div className="workspace-subject-list">
              {visibleSubjects
                .filter((subject) => subject.topics.length > 0)
                .map((subject) => (
                  <section className="workspace-subject" key={subject.subjectName}>
                    <div className="workspace-subject-heading">
                      <div>
                        <h2>{subject.subjectName}</h2>
                        <span>
                          {subject.examDate ? `Exam ${formatDate(subject.examDate)}` : 'Exam date unavailable'}
                          {subject.priority ? ` · ${subject.priority} priority` : ''}
                        </span>
                      </div>
                      <button
                        className="text-action"
                        type="button"
                        onClick={() => onOpenPlan(subject.sourcePlanId)}
                      >
                        Open source plan
                      </button>
                    </div>
                    <div className="workspace-topic-list">
                      {subject.topics.map((topic) => (
                        <TopicCard
                          key={`${subject.subjectName}-${topic.topicName}`}
                          subject={subject}
                          topic={topic}
                          statusFilter={statusFilter}
                          onOpenPlan={onOpenPlan}
                        />
                      ))}
                    </div>
                  </section>
                ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
