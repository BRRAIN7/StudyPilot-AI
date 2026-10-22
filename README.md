# StudyPilot AI

An adaptive academic planning system for students.

## Backend setup

The FastAPI backend requires Python 3.12. From the repository root, create and
activate a virtual environment, then install the pinned dependencies:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Start the development API:

```powershell
python -m uvicorn app.main:app --reload
```

The API is available at `http://127.0.0.1:8000`; interactive API documentation
is at `http://127.0.0.1:8000/docs`. The health endpoint is
`http://127.0.0.1:8000/health`.

Run the backend tests from the `backend` directory:

```powershell
python -m pytest
```

The API allows the local Vite origin `http://localhost:5173` by default. To
override it, set `STUDYPILOT_CORS_ORIGINS` to a comma-separated list of origins
before starting Uvicorn. See `backend/.env.example` for the variable format;
the backend loads `backend/.env` when present without overriding process
environment variables. SQLite persistence defaults to `sqlite:///./studypilot.db` relative to
the backend working directory; set `STUDYPILOT_DATABASE_URL` to use another
SQLAlchemy-supported database URL. Tables are initialized automatically when
the API starts.

## Study plan generation

`POST /api/plan/generate` accepts the Study Planner form data and returns a
deterministically scheduled plan, feasibility results, reviewer feedback, and
the LangGraph execution trace. Scheduling and validation never rely on the
language model. Without `GROQ_API_KEY`, or when a Groq request fails, the
affected node uses deterministic fallback and reports that provider in its
execution trace. To enable Groq-based prioritization explanations, planner
advice, and review, set `GROQ_API_KEY`, and optionally `GROQ_MODEL` and
`GROQ_TIMEOUT_SECONDS`, in `backend/.env` or the process environment before
starting the API. Scheduling and feasibility remain deterministic.

Generated plans are saved and can be retrieved with `GET /api/plan/{plan_id}`.
Record a session outcome with `PATCH /api/plan/{plan_id}/sessions/{session_id}/progress`,
then request an adaptive update with `POST /api/plan/{plan_id}/replan`.
Progress analytics are available from `GET /api/progress/analytics`.
Saved plan traces are available from `GET /api/agents/activity`.
