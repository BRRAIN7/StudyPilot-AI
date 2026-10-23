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

The API allows the local Vite origins `http://localhost:5173` and
`http://127.0.0.1:5173` by default. To configure production or preview
frontends, set `STUDYPILOT_CORS_ORIGINS` to a comma-separated list of explicit
origins before starting Uvicorn. Wildcard origins are rejected. See
`backend/.env.example` for the variable format;
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

## Free deployment: Vercel, Render, and Supabase

Deploy the existing frontend and API separately. No deployment is performed by
this repository setup.

### 1. Supabase PostgreSQL

Create a Supabase project and copy its PostgreSQL connection URI from the
project's database connection settings. Use the URI form beginning with
`postgresql://`; URL-encode any special characters in the password. Require TLS
with `sslmode=require` when that option is not already present. Do not put the
connection URI in source control.

The backend reads this environment variable:

```text
STUDYPILOT_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require
```

The default remains local SQLite when this variable is unset. Database tables
are initialized at API startup. This uses SQLAlchemy `create_all` for fresh
deployments; it does not migrate an existing schema.

### 2. Render FastAPI backend

Create a Render **Web Service** for the repository:

- Root directory: `backend`
- Runtime: Python 3.12
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

Set these variables in the Render service settings (values below are
placeholders, not credentials):

```text
STUDYPILOT_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require
STUDYPILOT_CORS_ORIGINS=https://YOUR-VERCEL-DOMAIN.vercel.app
GROQ_API_KEY=YOUR_GROQ_API_KEY
GROQ_MODEL=YOUR_SUPPORTED_GROQ_MODEL
GROQ_TIMEOUT_SECONDS=20
```

Only set the Groq variables if you want optional Groq-backed agent reasoning.
The key stays in the backend's environment and must not be added to Vercel or
frontend variables. For Vercel preview deployments, add each required preview
origin explicitly to `STUDYPILOT_CORS_ORIGINS`, comma-separated. Do not use
`*`. Verify the deployed API with `/health` after deployment.

### 3. Vercel React frontend

Import the repository into Vercel and configure the project:

- Root directory: `frontend`
- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`

Set this Vercel environment variable to the public Render API base URL, with no
trailing slash:

```text
VITE_API_BASE_URL=https://YOUR-RENDER-SERVICE.onrender.com
```

Redeploy the frontend after changing its environment variables. The API URL is
public configuration; database and Groq credentials belong only in Render.

### Local development after deployment configuration

Keep `backend/.env` local and ignored by Git. For local SQLite and frontend
development, the defaults remain suitable. If you run the API manually with an
externally assigned port, bind to all interfaces and pass that port:

```text
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
