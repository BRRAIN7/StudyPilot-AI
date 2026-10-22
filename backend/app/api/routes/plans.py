from fastapi import APIRouter, HTTPException

from app.agents.graph import GroqAgentError, generate_plan
from app.schemas.plan import PlanResponse, StudyPlanRequest

router = APIRouter(prefix="/api/plan", tags=["study plans"])


@router.post("/generate", response_model=PlanResponse)
def generate_study_plan(request: StudyPlanRequest) -> PlanResponse:
    try:
        return generate_plan(request)
    except GroqAgentError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
