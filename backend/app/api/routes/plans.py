from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.agents.graph import GroqAgentError, generate_plan
from app.core.database import get_db
from app.schemas.plan import (
    ProgressUpdateRequest,
    SavedPlanResponse,
    StudyPlanRequest,
)
from app.services.persistence import (
    PlanNotFoundError,
    ProgressConflictError,
    SessionNotFoundError,
    replan_saved_plan,
    retrieve_plan,
    save_plan,
    update_session_progress,
)

router = APIRouter(prefix="/api/plan", tags=["study plans"])


@router.post("/generate", response_model=SavedPlanResponse)
def generate_study_plan(
    request: StudyPlanRequest, database: Session = Depends(get_db)
) -> SavedPlanResponse:
    try:
        result = generate_plan(request)
        return save_plan(database, request, result)
    except GroqAgentError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/{plan_id}", response_model=SavedPlanResponse)
def get_study_plan(
    plan_id: str, database: Session = Depends(get_db)
) -> SavedPlanResponse:
    try:
        return retrieve_plan(database, plan_id)
    except PlanNotFoundError as error:
        raise HTTPException(status_code=404, detail="Study plan not found.") from error


@router.patch(
    "/{plan_id}/sessions/{session_id}/progress",
    response_model=SavedPlanResponse,
)
def record_session_progress(
    plan_id: str,
    session_id: str,
    update: ProgressUpdateRequest,
    database: Session = Depends(get_db),
) -> SavedPlanResponse:
    try:
        return update_session_progress(database, plan_id, session_id, update)
    except PlanNotFoundError as error:
        raise HTTPException(status_code=404, detail="Study plan not found.") from error
    except SessionNotFoundError as error:
        raise HTTPException(status_code=404, detail="Study session not found.") from error
    except ProgressConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{plan_id}/replan", response_model=SavedPlanResponse)
def replan_study_plan(
    plan_id: str, database: Session = Depends(get_db)
) -> SavedPlanResponse:
    try:
        return replan_saved_plan(database, plan_id)
    except PlanNotFoundError as error:
        raise HTTPException(status_code=404, detail="Study plan not found.") from error
    except GroqAgentError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
