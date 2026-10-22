export type HealthResponse = {
  status: 'healthy'
}

export type GenerateStudyPlanPayload = {
  subjects: {
    id: string
    name: string
    examDate: string
    priority: 'Low' | 'Medium' | 'High'
    topics: {
      id: string
      name: string
      difficulty: 'Easy' | 'Medium' | 'Hard'
      preparationLevel:
        | 'Not Started'
        | 'Beginner'
        | 'Intermediate'
        | 'Well Prepared'
      estimatedHours: number
    }[]
  }[]
  availableDays: string[]
  hoursPerDay: number
  preferredStartTime: string
  preferredEndTime: string
  sessionDurationMinutes: number
  breakDurationMinutes: number
}

export type PlanSession = {
  date: string
  startTime: string
  endTime: string
  subjectId: string
  subject: string
  topicId: string
  topic: string
  durationMinutes: number
}

export type TopicPriority = {
  topicId: string
  subjectId: string
  topicName: string
  subjectName: string
  examDate: string
  priorityScore: number
  rank: number
  explanation: string
}

export type FeasibilityFinding = {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  topicId: string | null
  date: string | null
}

export type TopicCoverage = {
  subjectId: string
  subject: string
  topicId: string
  topic: string
  estimatedMinutes: number
  completedMinutes: number
  scheduledMinutes: number
  remainingMinutes: number
}

export type AgentTraceEntry = {
  node: string
  decision: string
  revision: number
  feedback: string[]
  routedTo: string | null
  provider: string | null
}

export type StudyPlanResponse = {
  timezone: string
  schedule: PlanSession[]
  topicPriorities: TopicPriority[]
  feasibility: {
    passed: boolean
    findings: FeasibilityFinding[]
    coverage: TopicCoverage[]
  }
  reviewerFeedback: {
    approved: boolean
    rationale: string
    feedback: string[]
    warnings: string[]
  }
  revisionCount: number
  passedFeasibility: boolean
  warnings: string[]
  agentMode: 'groq' | 'deterministic_fallback'
  executionTrace: AgentTraceEntry[]
}

export type AgentActivityPlan = {
  planId: string
  createdAt: string
  updatedAt: string
  agentMode: 'groq' | 'deterministic_fallback'
  executionTrace: AgentTraceEntry[]
}

export type AgentActivityResponse = {
  plans: AgentActivityPlan[]
}

export type ProgressStatus =
  | 'scheduled'
  | 'completed'
  | 'partially_completed'
  | 'missed'

export type PersistedPlanSession = PlanSession & {
  sessionId: string
  progressStatus: ProgressStatus
  actualMinutes: number | null
  isCurrent: boolean
  progressHistory: {
    status: ProgressStatus
    actualMinutes: number | null
    recordedAt: string
  }[]
}

export type SavedStudyPlan = Omit<StudyPlanResponse, 'schedule'> & {
  planId: string
  createdAt: string
  updatedAt: string
  replanCount: number
  schedule: PersistedPlanSession[]
}

export type ProgressAnalytics = {
  totalPlans: number
  totalSessions: number
  trackedSessions: number
  completedSessions: number
  partiallyCompletedSessions: number
  missedSessions: number
  recordedStudyMinutes: number
  completionRatePercent: number
  recentPlans: {
    planId: string
    createdAt: string
    updatedAt: string
    sessionCount: number
    passedFeasibility: boolean
  }[]
}

export type OverviewSession = {
  planId: string
  sessionId: string
  date: string
  startTime: string
  endTime: string
  subject: string
  topic: string
  topicId: string
  durationMinutes: number
  progressStatus: ProgressStatus
  actualMinutes: number | null
  isCurrent: boolean
}

export type OverviewTopic = {
  topicId: string
  topicName: string
  difficulty: 'Easy' | 'Medium' | 'Hard' | null
  preparationLevel:
    | 'Not Started'
    | 'Beginner'
    | 'Intermediate'
    | 'Well Prepared'
    | null
  estimatedHours: number | null
  sourcePlanId: string
  sessions: OverviewSession[]
}

export type OverviewSubject = {
  subjectName: string
  examDate: string | null
  priority: 'Low' | 'Medium' | 'High' | null
  sourcePlanId: string
  topics: OverviewTopic[]
}

export type AcademicOverview = {
  totalPlans: number
  totalScheduledSessions: number
  completedSessions: number
  partiallyCompletedSessions: number
  missedSessions: number
  trackedSessions: number
  completionRatePercent: number
  recordedStudyMinutes: number
  recentPlans: {
    planId: string
    createdAt: string
    updatedAt: string
    sessionCount: number
    passedFeasibility: boolean
  }[]
  upcomingSessions: OverviewSession[]
  recentAgentActivity: (AgentTraceEntry & { planId: string })[]
  subjects: OverviewSubject[]
}

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isPlanResponse(value: unknown): value is StudyPlanResponse {
  if (!isRecord(value)) return false
  if (
    !isString(value.timezone) ||
    !Array.isArray(value.schedule) ||
    !Array.isArray(value.topicPriorities) ||
    !isRecord(value.feasibility) ||
    !isRecord(value.reviewerFeedback) ||
    !isNumber(value.revisionCount) ||
    typeof value.passedFeasibility !== 'boolean' ||
    !isStringArray(value.warnings) ||
    (value.agentMode !== 'groq' &&
      value.agentMode !== 'deterministic_fallback') ||
    !Array.isArray(value.executionTrace)
  ) {
    return false
  }

  const validSchedule = value.schedule.every(
    (item) =>
      isRecord(item) &&
      isString(item.date) &&
      isString(item.startTime) &&
      isString(item.endTime) &&
      isString(item.subjectId) &&
      isString(item.subject) &&
      isString(item.topicId) &&
      isString(item.topic) &&
      isNumber(item.durationMinutes),
  )
  const validPriorities = value.topicPriorities.every(
    (item) =>
      isRecord(item) &&
      isString(item.topicId) &&
      isString(item.subjectId) &&
      isString(item.topicName) &&
      isString(item.subjectName) &&
      isString(item.examDate) &&
      isNumber(item.priorityScore) &&
      isNumber(item.rank) &&
      isString(item.explanation),
  )
  const validFeasibility =
    typeof value.feasibility.passed === 'boolean' &&
    Array.isArray(value.feasibility.findings) &&
    value.feasibility.findings.every(
      (item) =>
        isRecord(item) &&
        isString(item.code) &&
        (item.severity === 'error' ||
          item.severity === 'warning' ||
          item.severity === 'info') &&
        isString(item.message) &&
        (item.topicId === null || isString(item.topicId)) &&
        (item.date === null || isString(item.date)),
    ) &&
    Array.isArray(value.feasibility.coverage) &&
    value.feasibility.coverage.every(
      (item) =>
        isRecord(item) &&
        isString(item.subjectId) &&
        isString(item.subject) &&
        isString(item.topicId) &&
        isString(item.topic) &&
        isNumber(item.estimatedMinutes) &&
        isNumber(item.completedMinutes) &&
        isNumber(item.scheduledMinutes) &&
        isNumber(item.remainingMinutes),
    )
  const validReview =
    typeof value.reviewerFeedback.approved === 'boolean' &&
    isString(value.reviewerFeedback.rationale) &&
    isStringArray(value.reviewerFeedback.feedback) &&
    isStringArray(value.reviewerFeedback.warnings)
  const validTrace = value.executionTrace.every(
    (item) =>
      isRecord(item) &&
      isString(item.node) &&
      isString(item.decision) &&
      isNumber(item.revision) &&
      isStringArray(item.feedback) &&
      (item.routedTo === null || isString(item.routedTo)) &&
      (item.provider === null || isString(item.provider)),
  )

  return (
    validSchedule &&
    validPriorities &&
    validFeasibility &&
    validReview &&
    validTrace
  )
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value)
}

function isPersistedPlan(value: unknown): value is SavedStudyPlan {
  if (!isRecord(value)) return false
  const planRecord: Record<string, unknown> = value
  if (!isPlanResponse(value)) return false
  if (
    !isString(planRecord.planId) ||
    !isString(planRecord.createdAt) ||
    !isString(planRecord.updatedAt) ||
    !isNumber(planRecord.replanCount)
  ) {
    return false
  }
  const sessions = planRecord.schedule
  if (!Array.isArray(sessions)) return false
  return sessions.every((session: unknown) => {
    if (
      !isRecord(session) ||
      !isString(session.sessionId) ||
      (session.progressStatus !== 'scheduled' &&
        session.progressStatus !== 'completed' &&
        session.progressStatus !== 'partially_completed' &&
        session.progressStatus !== 'missed') ||
      !isNullableNumber(session.actualMinutes) ||
      typeof session.isCurrent !== 'boolean' ||
      !Array.isArray(session.progressHistory)
    ) {
      return false
    }
    return session.progressHistory.every((entry: unknown) =>
      isRecord(entry) &&
      (entry.status === 'scheduled' ||
        entry.status === 'completed' ||
        entry.status === 'partially_completed' ||
        entry.status === 'missed') &&
      isNullableNumber(entry.actualMinutes) &&
      isString(entry.recordedAt),
    )
  })
}

function isProgressAnalytics(value: unknown): value is ProgressAnalytics {
  return (
    isRecord(value) &&
    isNumber(value.totalPlans) &&
    isNumber(value.totalSessions) &&
    isNumber(value.trackedSessions) &&
    isNumber(value.completedSessions) &&
    isNumber(value.partiallyCompletedSessions) &&
    isNumber(value.missedSessions) &&
    isNumber(value.recordedStudyMinutes) &&
    isNumber(value.completionRatePercent) &&
    Array.isArray(value.recentPlans) &&
    value.recentPlans.every(
      (plan) =>
        isRecord(plan) &&
        isString(plan.planId) &&
        isString(plan.createdAt) &&
        isString(plan.updatedAt) &&
        isNumber(plan.sessionCount) &&
        typeof plan.passedFeasibility === 'boolean',
    )
  )
}

function isAgentActivity(value: unknown): value is AgentActivityResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.plans) &&
    value.plans.every(
      (plan) =>
        isRecord(plan) &&
        isString(plan.planId) &&
        isString(plan.createdAt) &&
        isString(plan.updatedAt) &&
        (plan.agentMode === 'groq' ||
          plan.agentMode === 'deterministic_fallback') &&
        Array.isArray(plan.executionTrace) &&
        plan.executionTrace.every(
          (entry) =>
            isRecord(entry) &&
            isString(entry.node) &&
            isString(entry.decision) &&
            isNumber(entry.revision) &&
            isStringArray(entry.feedback) &&
            (entry.routedTo === null || isString(entry.routedTo)) &&
            (entry.provider === null || isString(entry.provider)),
        ),
    )
  )
}

function isOverviewSession(value: unknown): value is OverviewSession {
  return (
    isRecord(value) &&
    isString(value.planId) &&
    isString(value.sessionId) &&
    isString(value.date) &&
    isString(value.startTime) &&
    isString(value.endTime) &&
    isString(value.subject) &&
    isString(value.topic) &&
    isString(value.topicId) &&
    isNumber(value.durationMinutes) &&
    (value.progressStatus === 'scheduled' ||
      value.progressStatus === 'completed' ||
      value.progressStatus === 'partially_completed' ||
      value.progressStatus === 'missed') &&
    isNullableNumber(value.actualMinutes) &&
    typeof value.isCurrent === 'boolean'
  )
}

function isAcademicOverview(value: unknown): value is AcademicOverview {
  return (
    isRecord(value) &&
    isNumber(value.totalPlans) &&
    isNumber(value.totalScheduledSessions) &&
    isNumber(value.completedSessions) &&
    isNumber(value.partiallyCompletedSessions) &&
    isNumber(value.missedSessions) &&
    isNumber(value.trackedSessions) &&
    isNumber(value.completionRatePercent) &&
    isNumber(value.recordedStudyMinutes) &&
    Array.isArray(value.recentPlans) &&
    value.recentPlans.every(
      (plan) =>
        isRecord(plan) &&
        isString(plan.planId) &&
        isString(plan.createdAt) &&
        isString(plan.updatedAt) &&
        isNumber(plan.sessionCount) &&
        typeof plan.passedFeasibility === 'boolean',
    ) &&
    Array.isArray(value.upcomingSessions) &&
    value.upcomingSessions.every(isOverviewSession) &&
    Array.isArray(value.subjects) &&
    value.subjects.every(
      (subject) =>
        isRecord(subject) &&
        isString(subject.subjectName) &&
        (subject.examDate === null || isString(subject.examDate)) &&
        (subject.priority === null ||
          subject.priority === 'Low' ||
          subject.priority === 'Medium' ||
          subject.priority === 'High') &&
        isString(subject.sourcePlanId) &&
        Array.isArray(subject.topics) &&
        subject.topics.every(
          (topic) =>
            isRecord(topic) &&
            isString(topic.topicId) &&
            isString(topic.topicName) &&
            (topic.difficulty === null ||
              topic.difficulty === 'Easy' ||
              topic.difficulty === 'Medium' ||
              topic.difficulty === 'Hard') &&
            (topic.preparationLevel === null ||
              topic.preparationLevel === 'Not Started' ||
              topic.preparationLevel === 'Beginner' ||
              topic.preparationLevel === 'Intermediate' ||
              topic.preparationLevel === 'Well Prepared') &&
            (topic.estimatedHours === null ||
              isNumber(topic.estimatedHours)) &&
            isString(topic.sourcePlanId) &&
            Array.isArray(topic.sessions) &&
            topic.sessions.every(isOverviewSession),
        ),
    ) &&
    Array.isArray(value.recentAgentActivity) &&
    value.recentAgentActivity.every(
      (entry) =>
        isRecord(entry) &&
        isString(entry.planId) &&
        isString(entry.node) &&
        isString(entry.decision) &&
        isNumber(entry.revision) &&
        isStringArray(entry.feedback) &&
        (entry.routedTo === null || isString(entry.routedTo)) &&
        (entry.provider === null || isString(entry.provider)),
    )
  )
}

async function readErrorMessage(response: Response): Promise<string> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return `Request failed with status ${response.status}.`
  }

  if (!isRecord(body)) {
    return `Request failed with status ${response.status}.`
  }
  if (isString(body.detail)) return body.detail
  if (Array.isArray(body.detail)) {
    const messages = body.detail
      .filter(isRecord)
      .map((item) => item.msg)
      .filter(isString)
    if (messages.length > 0) return messages.join(' ')
  }
  return `Request failed with status ${response.status}.`
}

export async function fetchHealth(
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`, {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}.`)
  }

  const data: unknown = await response.json()
  if (
    !isRecord(data) ||
    !('status' in data) ||
    data.status !== 'healthy'
  ) {
    throw new Error('The backend returned an unexpected health response.')
  }

  return { status: data.status }
}

export async function generateStudyPlan(
  payload: GenerateStudyPlanPayload,
): Promise<SavedStudyPlan> {
  const response = await fetch(`${API_BASE_URL}/api/plan/generate`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const data: unknown = await response.json()
  if (!isPersistedPlan(data)) {
    throw new Error('The backend returned an unexpected saved study plan response.')
  }
  return data
}

async function readResponse<T>(
  response: Response,
  validate: (value: unknown) => value is T,
  resource: string,
): Promise<T> {
  if (!response.ok) throw new Error(await readErrorMessage(response))
  const data: unknown = await response.json()
  if (!validate(data)) {
    throw new Error(`The backend returned an unexpected ${resource} response.`)
  }
  return data
}

export async function updateSessionProgress(
  planId: string,
  sessionId: string,
  status: Exclude<ProgressStatus, 'scheduled'>,
  actualMinutes?: number,
): Promise<SavedStudyPlan> {
  const response = await fetch(
    `${API_BASE_URL}/api/plan/${encodeURIComponent(planId)}/sessions/${encodeURIComponent(sessionId)}/progress`,
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status,
        ...(actualMinutes === undefined ? {} : { actualMinutes }),
      }),
    },
  )
  return readResponse(response, isPersistedPlan, 'saved study plan')
}

export async function fetchSavedStudyPlan(
  planId: string,
): Promise<SavedStudyPlan> {
  const response = await fetch(
    `${API_BASE_URL}/api/plan/${encodeURIComponent(planId)}`,
    { headers: { Accept: 'application/json' } },
  )
  return readResponse(response, isPersistedPlan, 'saved study plan')
}

export async function replanStudyPlan(planId: string): Promise<SavedStudyPlan> {
  const response = await fetch(
    `${API_BASE_URL}/api/plan/${encodeURIComponent(planId)}/replan`,
    {
      method: 'POST',
      headers: { Accept: 'application/json' },
    },
  )
  return readResponse(response, isPersistedPlan, 'replanned study plan')
}

export async function fetchProgressAnalytics(
  signal?: AbortSignal,
): Promise<ProgressAnalytics> {
  const response = await fetch(`${API_BASE_URL}/api/progress/analytics`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  return readResponse(response, isProgressAnalytics, 'progress analytics')
}

export async function fetchAgentActivity(
  signal?: AbortSignal,
): Promise<AgentActivityResponse> {
  const response = await fetch(`${API_BASE_URL}/api/agents/activity`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  return readResponse(response, isAgentActivity, 'agent activity')
}

export async function fetchAcademicOverview(
  signal?: AbortSignal,
): Promise<AcademicOverview> {
  const response = await fetch(`${API_BASE_URL}/api/overview`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  return readResponse(response, isAcademicOverview, 'academic overview')
}
