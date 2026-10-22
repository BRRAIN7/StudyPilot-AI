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
  executionTrace: {
    node: string
    decision: string
    revision: number
    feedback: string[]
    routedTo: string | null
    provider: string | null
  }[]
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
): Promise<StudyPlanResponse> {
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
  if (!isPlanResponse(data)) {
    throw new Error('The backend returned an unexpected study plan response.')
  }
  return data
}
