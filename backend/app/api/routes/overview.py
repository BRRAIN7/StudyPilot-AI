from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.overview import AcademicOverviewResponse
from app.services.overview import get_academic_overview

router = APIRouter(prefix="/api", tags=["academic overview"])


@router.get("/overview", response_model=AcademicOverviewResponse)
def read_academic_overview(
    database: Session = Depends(get_db),
) -> AcademicOverviewResponse:
    return get_academic_overview(database)
