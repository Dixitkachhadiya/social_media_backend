"""
Local moderation inference service (FastAPI). Internal use only: bind to 127.0.0.1.

    cd Backend/ai-moderation
    .venv/Scripts/python -m uvicorn inference.service:app --host 127.0.0.1 --port 8001     (Windows)
    .venv/bin/python -m uvicorn inference.service:app --host 127.0.0.1 --port 8001         (macOS/Linux)
    # or from Backend/: npm run moderation

Endpoints
  GET  /health    -> {"status": "ok", "model": ..., "version": ...}  (503 while loading/failed)
  POST /moderate  {"text": "..."} -> moderation result (see inference/moderator.py)

If MODERATION_SERVICE_KEY is set, requests to /moderate must send the same value in X-Moderation-Key
(the Node backend does this automatically). Texts are never logged.
"""
from __future__ import annotations

import hmac
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from inference.moderator import Moderator

log = logging.getLogger("moderation")
MAX_CHARS = 10000
state: dict = {"moderator": None, "error": None}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        threads = int(os.environ.get("MODERATION_THREADS", "4"))
        try:
            import torch

            torch.set_num_threads(threads)
        except ImportError:
            pass
        state["moderator"] = Moderator(model_kind=os.environ.get("MODERATION_MODEL") or None)
        m = state["moderator"]
        m.moderate("warm up")  # first inference loads lazy kernels
        log.warning("Moderation model loaded: %s (%s), thresholds %s", m.name, m.version, m.thresholds)
    except Exception as error:  # the service stays up and reports unhealthy instead of crashing silently
        state["error"] = f"{type(error).__name__}: {error}"
        log.error("Could not load the moderation model: %s", state["error"])
    yield


app = FastAPI(title="Local moderation service", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


class ModerateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_CHARS)


@app.get("/health")
def health():
    m = state["moderator"]
    if not m:
        raise HTTPException(status_code=503, detail="model not loaded")
    return {"status": "ok", "model": m.name, "version": m.version}


@app.post("/moderate")
def moderate(body: ModerateRequest, x_moderation_key: str | None = Header(default=None)):
    expected = os.environ.get("MODERATION_SERVICE_KEY")
    if expected and not hmac.compare_digest(expected, x_moderation_key or ""):
        raise HTTPException(status_code=401, detail="invalid service key")
    m = state["moderator"]
    if not m:
        raise HTTPException(status_code=503, detail="model not loaded")
    return m.moderate(body.text)
