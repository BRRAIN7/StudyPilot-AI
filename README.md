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
the application reads environment variables directly and does not load `.env`
files.
