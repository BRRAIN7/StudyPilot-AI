from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.agents import router as agents_router
from app.api.routes.overview import router as overview_router
from app.api.routes.plans import router as plans_router
from app.api.routes.progress import router as progress_router
from app.core.config import settings
from app.core.database import init_database


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_database()
    yield

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=settings.app_description,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(plans_router)
app.include_router(progress_router)
app.include_router(agents_router)
app.include_router(overview_router)


@app.get("/")
def read_root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "description": settings.app_description,
    }
