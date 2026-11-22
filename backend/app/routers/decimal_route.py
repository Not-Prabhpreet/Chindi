"""Serialize Decimal projections as JSON strings before FastAPI can coerce to float."""

import inspect
from decimal import Decimal
from functools import wraps

from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool


def wire(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: wire(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [wire(item) for item in value]
    return value


class DecimalRoute(APIRoute):
    def __init__(self, path, endpoint, **kwargs):
        @wraps(endpoint)
        async def encoded(*args, **kw):
            if inspect.iscoroutinefunction(endpoint):
                result = await endpoint(*args, **kw)
            else:
                result = await run_in_threadpool(endpoint, *args, **kw)
            return wire(result)

        super().__init__(path, encoded, **kwargs)
