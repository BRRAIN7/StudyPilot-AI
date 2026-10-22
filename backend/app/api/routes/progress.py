from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.plan import ProgressAnalyticsResponse
from app.services.persistence import get_progress_analytics

router = APIRouter(prefix="/api/progress", tags=["progress"])


@router.get("/analytics", response_model=ProgressAnalyticsResponse)
def read_progress_analytics(
    database: Session = Depends(get_db),
) -> ProgressAnalyticsResponse:
    return get_progress_analytics(database)
