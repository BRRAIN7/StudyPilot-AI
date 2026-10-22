import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  fetchHealth,
  fetchSavedStudyPlan,
  generateStudyPlan,
  replanStudyPlan,
  updateSessionProgress,
  type ProgressStatus,
  type SavedStudyPlan,
} from './lib/api'
import { ProgressAnalyticsPage } from './ProgressAnalytics'
import { StudyPlanResults } from './StudyPlanResults'
import './App.css'

const pages = [
  'Dashboard',
  'Study Planner',
  'Subjects & Tasks',
  'Progress Analytics',
  'Agent Activity',
] as const

type Page = (typeof pages)[number]
type Priority = 'Low' | 'Medium' | 'High'
type Difficulty = 'Easy' | 'Medium' | 'Hard'
type PreparationLevel =
  | 'Not Started'
  | 'Beginner'
  | 'Intermediate'
  | 'Well Prepared'
type NumericValue = number | ''

type StudyTopic = {
  id: string
  name: string
  difficulty: Difficulty
  preparationLevel: PreparationLevel
  estimatedHours: NumericValue
}

type StudySubject = {
  id: string
  name: string
  examDate: string
  priority: Priority
  topics: StudyTopic[]
}

type StudyPlanForm = {
  subjects: StudySubject[]
  availableDays: string[]
  hoursPerDay: NumericValue
  preferredStartTime: string
  preferredEndTime: string
  sessionDurationMinutes: NumericValue
  breakDurationMinutes: NumericValue
}

type FormErrors = Record<string, string>

const weekDays = [
  { value: 'monday', label: 'Mon' },
  { value: 'tuesday', label: 'Tue' },
  { value: 'wednesday', label: 'Wed' },
  { value: 'thursday', label: 'Thu' },
  { value: 'friday', label: 'Fri' },
  { value: 'saturday', label: 'Sat' },
  { value: 'sunday', label: 'Sun' },
]

const newTopic = (): StudyTopic => ({
  id: crypto.randomUUID(),
  name: '',
  difficulty: 'Medium',
  preparationLevel: 'Not Started',
  estimatedHours: '',
})

const newSubject = (): StudySubject => ({
  id: crypto.randomUUID(),
  name: '',
  examDate: '',
  priority: 'Medium',
  topics: [newTopic()],
})

const initialForm = (): StudyPlanForm => ({
  subjects: [newSubject()],
  availableDays: [],
  hoursPerDay: '',
  preferredStartTime: '',
  preferredEndTime: '',
  sessionDurationMinutes: '',
  breakDurationMinutes: '',
})

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const earliestExamDate = localDateString(new Date())

function validateForm(form: StudyPlanForm): FormErrors {
  const errors: FormErrors = {}
  const today = localDateString(new Date())

  if (form.subjects.length === 0) {
    errors.subjects = 'Add at least one subject.'
  }

  form.subjects.forEach((subject) => {
    if (!subject.name.trim()) {
      errors[`subject.${subject.id}.name`] = 'Enter a subject name.'
    }
    if (!subject.examDate) {
      errors[`subject.${subject.id}.examDate`] = 'Choose an exam date.'
    } else if (subject.examDate < today) {
      errors[`subject.${subject.id}.examDate`] = 'Exam date cannot be in the past.'
    }
    if (subject.topics.length === 0) {
      errors[`subject.${subject.id}.topics`] = 'Add at least one topic.'
    }
    subject.topics.forEach((topic) => {
      if (!topic.name.trim()) {
        errors[`topic.${topic.id}.name`] = 'Enter a topic name.'
      }
      if (
        topic.estimatedHours === '' ||
        !Number.isFinite(topic.estimatedHours) ||
        topic.estimatedHours < 0.25 ||
        topic.estimatedHours > 100
      ) {
        errors[`topic.${topic.id}.estimatedHours`] =
          'Enter a duration from 0.25 to 100 hours.'
      }
    })
  })

  if (form.availableDays.length === 0) {
    errors.availableDays = 'Select at least one available day.'
  }
  if (
    form.hoursPerDay === '' ||
    !Number.isFinite(form.hoursPerDay) ||
    form.hoursPerDay < 1 ||
    form.hoursPerDay > 16
  ) {
    errors.hoursPerDay = 'Enter between 1 and 16 hours per day.'
  }
  if (!form.preferredStartTime) {
    errors.preferredStartTime = 'Choose a preferred start time.'
  }
  if (!form.preferredEndTime) {
    errors.preferredEndTime = 'Choose a preferred end time.'
  } else if (
    form.preferredStartTime &&
    form.preferredEndTime <= form.preferredStartTime
  ) {
    errors.preferredEndTime = 'End time must be later than start time.'
  }
  if (
    form.sessionDurationMinutes === '' ||
    !Number.isFinite(form.sessionDurationMinutes) ||
    form.sessionDurationMinutes < 15 ||
    form.sessionDurationMinutes > 240
  ) {
    errors.sessionDurationMinutes = 'Enter a session duration from 15 to 240 minutes.'
  } else if (
    form.hoursPerDay !== '' &&
    form.sessionDurationMinutes > form.hoursPerDay * 60
  ) {
    errors.sessionDurationMinutes =
      'A session cannot be longer than your available daily hours.'
  }
  if (
    form.breakDurationMinutes === '' ||
    !Number.isFinite(form.breakDurationMinutes) ||
    form.breakDurationMinutes < 0 ||
    form.breakDurationMinutes > 120
  ) {
    errors.breakDurationMinutes = 'Enter a break duration from 0 to 120 minutes.'
  }

  return errors
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  children: ReactNode
}) {
  const errorId = `${htmlFor}-error`

  return (
    <div className="planner-field">
      <label className="planner-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error && (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

function SectionHeading({
  number,
  title,
  description,
}: {
  number: string
  title: string
  description: string
}) {
  return (
    <div className="planner-section-heading">
      <span className="section-number" aria-hidden="true">{number}</span>
      <div>
        <h2 id={`planner-section-title-${number}`}>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  )
}

function StudyPlannerPage({
  planToLoadId,
  onPlanLoaded,
}: {
  planToLoadId: string | null
  onPlanLoaded: () => void
}) {
  const [form, setForm] = useState<StudyPlanForm>(() => initialForm())
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [planResult, setPlanResult] = useState<SavedStudyPlan | null>(null)
  const [showResults, setShowResults] = useState(false)
  const [progressBusySessionId, setProgressBusySessionId] = useState<string | null>(null)
  const [progressMessage, setProgressMessage] = useState('')
  const [progressError, setProgressError] = useState('')
  const [isReplanning, setIsReplanning] = useState(false)
  const requestInProgress = useRef(false)
  const errors = hasSubmitted ? validateForm(form) : {}
  const isLoadingSavedPlan = planToLoadId !== null

  useEffect(() => {
    if (!planToLoadId) return
    let cancelled = false
    fetchSavedStudyPlan(planToLoadId)
      .then((savedPlan) => {
        if (cancelled) return
        setRequestError('')
        setPlanResult(savedPlan)
        setShowResults(true)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setShowResults(false)
        setRequestError(
          error instanceof Error ? error.message : 'Unable to load this saved plan.',
        )
      })
      .finally(() => {
        if (cancelled) return
        onPlanLoaded()
      })
    return () => {
      cancelled = true
    }
  }, [planToLoadId, onPlanLoaded])

  function updateSubject(
    subjectId: string,
    update: (subject: StudySubject) => StudySubject,
  ) {
    setForm((current) => ({
      ...current,
      subjects: current.subjects.map((subject) =>
        subject.id === subjectId ? update(subject) : subject,
      ),
    }))
    setRequestError('')
  }

  function updateTopic(
    subjectId: string,
    topicId: string,
    update: (topic: StudyTopic) => StudyTopic,
  ) {
    updateSubject(subjectId, (subject) => ({
      ...subject,
      topics: subject.topics.map((topic) =>
        topic.id === topicId ? update(topic) : topic,
      ),
    }))
  }

  function updateAvailability<Key extends keyof Omit<StudyPlanForm, 'subjects'>>(
    key: Key,
    value: StudyPlanForm[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }))
    setRequestError('')
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (requestInProgress.current) return
    setHasSubmitted(true)
    setRequestError('')
    const validationErrors = validateForm(form)
    if (Object.keys(validationErrors).length > 0) return

    const payload = {
      subjects: form.subjects.map((subject) => ({
        id: subject.id,
        name: subject.name.trim(),
        examDate: subject.examDate,
        priority: subject.priority,
        topics: subject.topics.map((topic) => ({
          id: topic.id,
          name: topic.name.trim(),
          difficulty: topic.difficulty,
          preparationLevel: topic.preparationLevel,
          estimatedHours: Number(topic.estimatedHours),
        })),
      })),
      availableDays: form.availableDays,
      hoursPerDay: Number(form.hoursPerDay),
      preferredStartTime: form.preferredStartTime,
      preferredEndTime: form.preferredEndTime,
      sessionDurationMinutes: Number(form.sessionDurationMinutes),
      breakDurationMinutes: Number(form.breakDurationMinutes),
    }

    requestInProgress.current = true
    setIsSubmitting(true)
    void generateStudyPlan(payload)
      .then((result) => {
        setPlanResult(result)
        setShowResults(true)
      })
      .catch((error: unknown) => {
        setRequestError(
          error instanceof Error
            ? error.message
            : 'Unable to generate a study plan. Please try again.',
        )
      })
      .finally(() => {
        requestInProgress.current = false
        setIsSubmitting(false)
      })
  }

  async function handleProgressUpdate(
    sessionId: string,
    status: Exclude<ProgressStatus, 'scheduled'>,
    actualMinutes?: number,
  ) {
    if (!planResult || progressBusySessionId) return
    setProgressBusySessionId(sessionId)
    setProgressError('')
    setProgressMessage('')
    try {
      const updated = await updateSessionProgress(
        planResult.planId,
        sessionId,
        status,
        actualMinutes,
      )
      setPlanResult(updated)
      setProgressMessage('Session progress saved.')
    } catch (error: unknown) {
      setProgressError(
        error instanceof Error ? error.message : 'Unable to save session progress.',
      )
    } finally {
      setProgressBusySessionId(null)
    }
  }

  async function handleReplan() {
    if (!planResult || isReplanning) return
    setIsReplanning(true)
    setProgressError('')
    setProgressMessage('')
    try {
      setPlanResult(await replanStudyPlan(planResult.planId))
      setProgressMessage('The remaining schedule has been replanned.')
    } catch (error: unknown) {
      setProgressError(
        error instanceof Error ? error.message : 'Unable to replan this study plan.',
      )
    } finally {
      setIsReplanning(false)
    }
  }

  if (showResults && planResult && !isLoadingSavedPlan) {
    return (
      <>
        <div className="page-heading planner-page-heading">
          <p className="page-kicker">YOUR ADAPTIVE STUDY PLAN</p>
          <h1>Study Planner</h1>
          <p className="page-description">
            Review the schedule, feasibility results, and agent decisions below.
          </p>
        </div>
        <StudyPlanResults
          plan={planResult}
          onEdit={() => setShowResults(false)}
          onProgressUpdate={handleProgressUpdate}
          progressBusySessionId={progressBusySessionId}
          progressMessage={progressMessage}
          progressError={progressError}
          onReplan={handleReplan}
          isReplanning={isReplanning}
        />
      </>
    )
  }

  return (
    <>
      <div className="page-heading planner-page-heading">
        <p className="page-kicker">BUILD A PLAN THAT FITS YOUR LIFE</p>
        <h1>Study Planner</h1>
        <p className="page-description">
          Add your exams, syllabus, and available study time. You can adjust
          everything before creating a plan.
        </p>
      </div>

      <form
        className="planner-form"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={isSubmitting}
      >
        <fieldset className="planner-fields" disabled={isSubmitting}>
        <section className="planner-section" aria-labelledby="planner-section-title-01">
          <SectionHeading
            number="01"
            title="Exams & subjects"
            description="Start with the subjects you need to prepare for."
          />
          <div className="planner-section-content">
            {form.subjects.map((subject, subjectIndex) => (
              <article className="subject-card" key={subject.id}>
                <div className="subject-card-heading">
                  <div>
                    <span className="subject-card-label">SUBJECT {String(subjectIndex + 1).padStart(2, '0')}</span>
                    <h3>{subject.name.trim() || 'New subject'}</h3>
                  </div>
                  <button
                    className="text-button remove-button"
                    type="button"
                    onClick={() => {
                      setForm((current) => ({
                        ...current,
                        subjects: current.subjects.filter(
                          (item) => item.id !== subject.id,
                        ),
                      }))
                      setRequestError('')
                    }}
                    aria-label={`Remove subject ${subject.name || subjectIndex + 1}`}
                  >
                    Remove
                  </button>
                </div>

                <div className="planner-grid subject-fields">
                  <Field
                    label="Subject name"
                    htmlFor={`subject-name-${subject.id}`}
                    error={errors[`subject.${subject.id}.name`]}
                  >
                    <input
                      className="planner-input"
                      id={`subject-name-${subject.id}`}
                      value={subject.name}
                      onChange={(event) =>
                        updateSubject(subject.id, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="e.g. Data Structures"
                      autoComplete="off"
                      aria-invalid={Boolean(errors[`subject.${subject.id}.name`])}
                      aria-describedby={
                        errors[`subject.${subject.id}.name`]
                          ? `subject-name-${subject.id}-error`
                          : undefined
                      }
                    />
                  </Field>
                  <Field
                    label="Exam date"
                    htmlFor={`exam-date-${subject.id}`}
                    error={errors[`subject.${subject.id}.examDate`]}
                  >
                    <input
                      className="planner-input"
                      id={`exam-date-${subject.id}`}
                      type="date"
                      min={earliestExamDate}
                      value={subject.examDate}
                      onChange={(event) =>
                        updateSubject(subject.id, (current) => ({
                          ...current,
                          examDate: event.target.value,
                        }))
                      }
                      aria-invalid={Boolean(errors[`subject.${subject.id}.examDate`])}
                      aria-describedby={
                        errors[`subject.${subject.id}.examDate`]
                          ? `exam-date-${subject.id}-error`
                          : undefined
                      }
                    />
                  </Field>
                  <Field
                    label="Exam priority"
                    htmlFor={`priority-${subject.id}`}
                    error={errors[`subject.${subject.id}.priority`]}
                  >
                    <select
                      className="planner-input"
                      id={`priority-${subject.id}`}
                      value={subject.priority}
                      onChange={(event) =>
                        updateSubject(subject.id, (current) => ({
                          ...current,
                          priority: event.target.value as Priority,
                        }))
                      }
                    >
                      <option>Low</option>
                      <option>Medium</option>
                      <option>High</option>
                    </select>
                  </Field>
                </div>

                <div className="topic-list">
                  <div className="topic-list-heading">
                    <h4>Syllabus topics</h4>
                    <span>{subject.topics.length} {subject.topics.length === 1 ? 'topic' : 'topics'}</span>
                  </div>
                  {subject.topics.map((topic, topicIndex) => (
                    <div className="topic-card" key={topic.id}>
                      <div className="topic-card-heading">
                        <span>TOPIC {String(topicIndex + 1).padStart(2, '0')}</span>
                        <button
                          className="text-button remove-button"
                          type="button"
                          onClick={() =>
                            updateSubject(subject.id, (current) => ({
                              ...current,
                              topics: current.topics.filter(
                                (item) => item.id !== topic.id,
                              ),
                            }))
                          }
                          aria-label={`Remove topic ${topic.name || topicIndex + 1}`}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="planner-grid topic-fields">
                        <Field
                          label="Topic name"
                          htmlFor={`topic-name-${topic.id}`}
                          error={errors[`topic.${topic.id}.name`]}
                        >
                          <input
                            className="planner-input"
                            id={`topic-name-${topic.id}`}
                            value={topic.name}
                            onChange={(event) =>
                              updateTopic(subject.id, topic.id, (current) => ({
                                ...current,
                                name: event.target.value,
                              }))
                            }
                            placeholder="e.g. Trees & graphs"
                            autoComplete="off"
                            aria-invalid={Boolean(errors[`topic.${topic.id}.name`])}
                            aria-describedby={
                              errors[`topic.${topic.id}.name`]
                                ? `topic-name-${topic.id}-error`
                                : undefined
                            }
                          />
                        </Field>
                        <Field
                          label="Difficulty"
                          htmlFor={`difficulty-${topic.id}`}
                          error={errors[`topic.${topic.id}.difficulty`]}
                        >
                          <select
                            className="planner-input"
                            id={`difficulty-${topic.id}`}
                            value={topic.difficulty}
                            onChange={(event) =>
                              updateTopic(subject.id, topic.id, (current) => ({
                                ...current,
                                difficulty: event.target.value as Difficulty,
                              }))
                            }
                          >
                            <option>Easy</option>
                            <option>Medium</option>
                            <option>Hard</option>
                          </select>
                        </Field>
                        <Field
                          label="Preparation"
                          htmlFor={`preparation-${topic.id}`}
                          error={errors[`topic.${topic.id}.preparationLevel`]}
                        >
                          <select
                            className="planner-input"
                            id={`preparation-${topic.id}`}
                            value={topic.preparationLevel}
                            onChange={(event) =>
                              updateTopic(subject.id, topic.id, (current) => ({
                                ...current,
                                preparationLevel: event.target.value as PreparationLevel,
                              }))
                            }
                          >
                            <option>Not Started</option>
                            <option>Beginner</option>
                            <option>Intermediate</option>
                            <option>Well Prepared</option>
                          </select>
                        </Field>
                        <Field
                          label="Estimated study hours"
                          htmlFor={`topic-hours-${topic.id}`}
                          error={errors[`topic.${topic.id}.estimatedHours`]}
                        >
                          <input
                            className="planner-input"
                            id={`topic-hours-${topic.id}`}
                            type="number"
                            min="0.25"
                            max="100"
                            step="0.25"
                            value={topic.estimatedHours}
                            onChange={(event) =>
                              updateTopic(subject.id, topic.id, (current) => ({
                                ...current,
                                estimatedHours:
                                  event.target.value === ''
                                    ? ''
                                    : Number(event.target.value),
                              }))
                            }
                            placeholder="e.g. 2"
                            aria-invalid={Boolean(errors[`topic.${topic.id}.estimatedHours`])}
                            aria-describedby={
                              errors[`topic.${topic.id}.estimatedHours`]
                                ? `topic-hours-${topic.id}-error`
                                : undefined
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  ))}
                  {errors[`subject.${subject.id}.topics`] && (
                    <p className="field-error" role="alert">
                      {errors[`subject.${subject.id}.topics`]}
                    </p>
                  )}
                  <button
                    className="add-inline-button"
                    type="button"
                    onClick={() =>
                      updateSubject(subject.id, (current) => ({
                        ...current,
                        topics: [...current.topics, newTopic()],
                      }))
                    }
                  >
                    <span aria-hidden="true">+</span> Add topic
                  </button>
                </div>
              </article>
            ))}
            {errors.subjects && <p className="field-error" role="alert">{errors.subjects}</p>}
            <button
              className="add-subject-button"
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  subjects: [...current.subjects, newSubject()],
                }))
              }
            >
              <span className="add-subject-icon" aria-hidden="true">+</span>
              <span>
                <strong>Add another subject</strong>
                <small>Include another upcoming exam</small>
              </span>
            </button>
          </div>
        </section>

        <section className="planner-section" aria-labelledby="planner-section-title-02">
          <SectionHeading
            number="02"
            title="Study availability"
            description="Set a realistic routine around your week."
          />
          <div className="planner-section-content availability-content">
            <div className="planner-field">
              <span className="planner-label" id="available-days-label">Available days</span>
              <div
                className="day-picker"
                role="group"
                aria-labelledby="available-days-label"
                aria-describedby={errors.availableDays ? 'available-days-error' : undefined}
              >
                {weekDays.map((day) => {
                  const selected = form.availableDays.includes(day.value)
                  return (
                    <button
                      className={`day-option${selected ? ' is-selected' : ''}`}
                      key={day.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        updateAvailability(
                          'availableDays',
                          selected
                            ? form.availableDays.filter((value) => value !== day.value)
                            : [...form.availableDays, day.value],
                        )
                      }
                    >
                      {day.label}
                    </button>
                  )
                })}
              </div>
              {errors.availableDays && (
                <span className="field-error" id="available-days-error" role="alert">
                  {errors.availableDays}
                </span>
              )}
            </div>

            <div className="planner-grid availability-grid">
              <Field
                label="Maximum study hours per day"
                htmlFor="hours-per-day"
                error={errors.hoursPerDay}
              >
                <input
                  className="planner-input"
                  id="hours-per-day"
                  type="number"
                  min="1"
                  max="16"
                  step="0.5"
                  value={form.hoursPerDay}
                  onChange={(event) =>
                    updateAvailability(
                      'hoursPerDay',
                      event.target.value === '' ? '' : Number(event.target.value),
                    )
                  }
                  placeholder="e.g. 4"
                  aria-invalid={Boolean(errors.hoursPerDay)}
                  aria-describedby={errors.hoursPerDay ? 'hours-per-day-error' : undefined}
                />
              </Field>
              <Field
                label="Preferred session length (minutes)"
                htmlFor="session-duration"
                error={errors.sessionDurationMinutes}
              >
                <input
                  className="planner-input"
                  id="session-duration"
                  type="number"
                  min="15"
                  max="240"
                  step="5"
                  value={form.sessionDurationMinutes}
                  onChange={(event) =>
                    updateAvailability(
                      'sessionDurationMinutes',
                      event.target.value === '' ? '' : Number(event.target.value),
                    )
                  }
                  placeholder="e.g. 50"
                  aria-invalid={Boolean(errors.sessionDurationMinutes)}
                  aria-describedby={
                    errors.sessionDurationMinutes ? 'session-duration-error' : undefined
                  }
                />
              </Field>
              <Field
                label="Preferred start time"
                htmlFor="preferred-start"
                error={errors.preferredStartTime}
              >
                <input
                  className="planner-input"
                  id="preferred-start"
                  type="time"
                  value={form.preferredStartTime}
                  onChange={(event) =>
                    updateAvailability('preferredStartTime', event.target.value)
                  }
                  aria-invalid={Boolean(errors.preferredStartTime)}
                  aria-describedby={
                    errors.preferredStartTime ? 'preferred-start-error' : undefined
                  }
                />
              </Field>
              <Field
                label="Preferred end time"
                htmlFor="preferred-end"
                error={errors.preferredEndTime}
              >
                <input
                  className="planner-input"
                  id="preferred-end"
                  type="time"
                  value={form.preferredEndTime}
                  onChange={(event) =>
                    updateAvailability('preferredEndTime', event.target.value)
                  }
                  aria-invalid={Boolean(errors.preferredEndTime)}
                  aria-describedby={
                    errors.preferredEndTime ? 'preferred-end-error' : undefined
                  }
                />
              </Field>
              <Field
                label="Break between sessions (minutes)"
                htmlFor="break-duration"
                error={errors.breakDurationMinutes}
              >
                <input
                  className="planner-input"
                  id="break-duration"
                  type="number"
                  min="0"
                  max="120"
                  step="5"
                  value={form.breakDurationMinutes}
                  onChange={(event) =>
                    updateAvailability(
                      'breakDurationMinutes',
                      event.target.value === '' ? '' : Number(event.target.value),
                    )
                  }
                  placeholder="e.g. 10"
                  aria-invalid={Boolean(errors.breakDurationMinutes)}
                  aria-describedby={
                    errors.breakDurationMinutes ? 'break-duration-error' : undefined
                  }
                />
              </Field>
            </div>
          </div>
        </section>
        </fieldset>

        <div className="planner-actions">
          <p>
            {isSubmitting
              ? 'Your agents are preparing and reviewing the plan. This may take a moment.'
              : 'Your plan is generated from the details entered above.'}
          </p>
          <button className="generate-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Generating plan…' : 'Generate Study Plan'}
            {!isSubmitting && <span aria-hidden="true">→</span>}
          </button>
        </div>
        {isSubmitting && (
          <p className="request-loading" role="status">
            <span className="request-spinner" aria-hidden="true" />
            Contacting the planning agents…
          </p>
        )}
        {isLoadingSavedPlan && (
          <p className="request-loading" role="status">
            <span className="request-spinner" aria-hidden="true" />
            Loading saved study plan…
          </p>
        )}
        {requestError && !isLoadingSavedPlan && (
          <div className="request-error" role="alert">
            <strong>We couldn’t generate your plan.</strong>
            <p>{requestError}</p>
            <span>Check the backend connection and try again. Your inputs are still here.</span>
          </div>
        )}
      </form>
    </>
  )
}

function PlaceholderPage({
  page,
}: {
  page: Exclude<Page, 'Study Planner' | 'Progress Analytics'>
}) {
  return (
    <>
      <div className="page-heading">
        <p className="page-kicker">YOUR ACADEMIC WORKSPACE</p>
        <h1>{page}</h1>
        <p className="page-description">
          Your study space is ready. This page will take shape as we build
          StudyPilot AI, one step at a time.
        </p>
      </div>
      <section className="placeholder-card" aria-labelledby="placeholder-title">
        <div className="placeholder-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="placeholder-label">COMING INTO FOCUS</p>
        <h2 id="placeholder-title">{page} is on its way</h2>
        <p>
          The shared application shell is in place. Page tools and
          information will be added in the next development phases.
        </p>
        {page === 'Dashboard' && <BackendConnectionStatus />}
      </section>
    </>
  )
}

type ConnectionStatus =
  | { state: 'loading' }
  | { state: 'connected' }
  | { state: 'error'; message: string }

function BackendConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    fetchHealth(controller.signal)
      .then(() => setStatus({ state: 'connected' }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setStatus({
          state: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to connect to the backend.',
        })
      })

    return () => controller.abort()
  }, [])

  const label =
    status.state === 'loading'
      ? 'Checking backend connection…'
      : status.state === 'connected'
        ? 'Backend connected'
        : `Backend unavailable: ${status.message}`

  return (
    <div
      className={`backend-status is-${status.state}`}
      role={status.state === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className="backend-status-dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

function App() {
  const [activePage, setActivePage] = useState<Page>('Study Planner')
  const [planToLoadId, setPlanToLoadId] = useState<string | null>(null)
  const clearPlanToLoadId = useCallback(() => setPlanToLoadId(null), [])

  function openSavedPlan(planId: string) {
    setPlanToLoadId(planId)
    setActivePage('Study Planner')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="StudyPilot AI home">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span className="brand-name">StudyPilot<span>AI</span></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {pages.map((page, index) => (
            <button
              className={`nav-item${activePage === page ? ' is-active' : ''}`}
              key={page}
              type="button"
              aria-current={activePage === page ? 'page' : undefined}
              onClick={() => setActivePage(page)}
            >
              <span className="nav-index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              {page}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" aria-hidden="true" />
          Your study space
          <span className="sidebar-footer-caption">Personal workspace</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-context">
            <span className="topbar-eyebrow">StudyPilot AI</span>
            <span className="topbar-divider" aria-hidden="true">/</span>
            <span className="topbar-current">{activePage}</span>
          </div>
          <div className="profile-chip" aria-label="Student profile">
            <span className="profile-avatar" aria-hidden="true">S</span>
            <span className="profile-label">Student</span>
          </div>
        </header>

        <main className="page-content">
          <div hidden={activePage !== 'Study Planner'}>
            <StudyPlannerPage
              planToLoadId={planToLoadId}
              onPlanLoaded={clearPlanToLoadId}
            />
          </div>
          {activePage === 'Progress Analytics' && (
            <ProgressAnalyticsPage onOpenPlan={openSavedPlan} />
          )}
          {activePage !== 'Study Planner' &&
            activePage !== 'Progress Analytics' && (
              <PlaceholderPage page={activePage} />
            )}
        </main>
      </div>
    </div>
  )
}

export default App
