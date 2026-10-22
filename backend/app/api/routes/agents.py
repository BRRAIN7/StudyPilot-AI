from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.plan import AgentActivityResponse
from app.services.persistence import get_agent_activity

router = APIRouter(prefix="/api/agents", tags=["agent activity"])


@router.get("/activity", response_model=AgentActivityResponse)
def read_agent_activity(
    database: Session = Depends(get_db),
) -> AgentActivityResponse:
    return get_agent_activity(database)
