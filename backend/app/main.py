"""App factory: settings, CORS, error format and routers under /api/v1."""

from collections import OrderedDict, deque
from contextlib import asynccontextmanager
from time import monotonic

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import error_response, register_error_handlers
from app.routers import auth, budget, extras, health, security

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(app):
    from app.jobs.scheduler import tick

    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(tick, "interval", minutes=1, max_instances=1, coalesce=True)
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        lifespan=lifespan,
        title="Chindi API",
        version="0.1.0",
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    attempts: OrderedDict[str, deque[float]] = OrderedDict()

    @app.middleware("http")
    async def private_responses(request, call_next):
        if (
            request.method == "POST"
            and request.url.path.startswith(f"{API_PREFIX}/auth/")
            and request.url.path not in (f"{API_PREFIX}/auth/refresh", f"{API_PREFIX}/auth/logout")
        ):
            key = (request.client.host if request.client else "unknown") + ":" + request.url.path
            recent = attempts.setdefault(key, deque())
            attempts.move_to_end(key)
            instant = monotonic()
            while recent and recent[0] <= instant - 60:
                recent.popleft()
            if len(recent) >= settings.auth_rate_limit:
                response = error_response(
                    429, "rate_limited", "Too many attempts. Try again in a minute."
                )
                response.headers["Retry-After"] = "60"
                return response
            recent.append(instant)
            if len(attempts) > 4096:
                attempts.popitem(last=False)
        response = await call_next(request)
        if request.url.path.startswith(API_PREFIX):
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    register_error_handlers(app)
    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(auth.router, prefix=API_PREFIX)
    app.include_router(security.router, prefix=API_PREFIX)
    app.include_router(budget.router, prefix=API_PREFIX)
    app.include_router(extras.router, prefix=API_PREFIX)
    return app


app = create_app()
