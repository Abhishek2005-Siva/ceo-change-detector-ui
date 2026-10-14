"""Model service: given an SEC filing, find Item 5.02, run the 3-reader ensemble, return the extraction.

Runs as a Hugging Face Docker Space. Jobs are async (CPU inference takes a while), so the
front-end starts a job and polls it. Only one filing is processed at a time.
"""
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

import re

from .item502 import ITEM_HEADING_RE, find_item_502_section, split_sentences
from .sec_fetch import fetch_filing, filing_txt_url

API_KEY = os.getenv("API_KEY", "")


def _auth(authorization: str = Header(default="")) -> None:
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(401, "Unauthorized")


app = FastAPI(title="Leadership Change Detector model service", dependencies=[Depends(_auth)])
_pool = ThreadPoolExecutor(max_workers=1)
_jobs: Dict[str, dict] = {}
_cache: Dict[str, dict] = {}
_lock = threading.Lock()
_model = {"ensemble": None, "error": None, "loading": True}


def _load() -> None:
    try:
        from .ensemble import Ensemble

        _model["ensemble"] = Ensemble()
    except Exception as exc:  # surfaced via /health so the UI can explain it
        _model["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        _model["loading"] = False


threading.Thread(target=_load, daemon=True).start()


class JobRequest(BaseModel):
    cik: str = Field(pattern=r"^\d{1,10}$")
    accession: str = Field(pattern=r"^\d{10}-\d{2}-\d{6}$")


def _set(job: dict, **kw) -> None:
    with _lock:
        job.update(kw)


def _run(job: dict, cik: str, accession: str) -> None:
    t0 = time.time()
    try:
        _set(job, stage="fetching", progress=0.05)
        text, meta = fetch_filing(cik, accession)
        if text is None:
            _set(job, stage="error", error="The SEC did not return this filing (not found or temporarily unavailable).")
            return
        filing = {
            "cik": cik,
            "accession": accession,
            "company": meta.company,
            "form": meta.form,
            "filed": meta.filed,
            "items": sorted({m.group(1) for m in ITEM_HEADING_RE.finditer(text)}),
            "url": filing_txt_url(cik, accession),
            "characters": len(text),
        }
        _set(job, stage="locating", progress=0.2, filing=filing)
        section = find_item_502_section(text)
        if section is None:
            _set(job, stage="done", progress=1.0, result={
                "filing": filing, "item502Found": False, "section": "", "sentences": [],
                "appointed": {"found": False}, "resigned": {"found": False},
                "seconds": round(time.time() - t0, 1),
            })
            return
        _set(job, stage="splitting", progress=0.3)
        sentences = split_sentences(section)
        _set(job, stage="reading", progress=0.35, sentenceCount=len(sentences), readersDone=0)
        ens = _model["ensemble"]

        def on_done(done: int, total: int) -> None:
            _set(job, readersDone=done, progress=0.35 + 0.6 * done / total)

        out = ens.analyze(sentences, on_done)
        result = {
            "filing": filing,
            "item502Found": True,
            "section": section[:8000],
            "readers": ens.reader_names,
            "seconds": round(time.time() - t0, 1),
            **out,
        }
        _cache[f"{cik}/{accession}"] = result
        _set(job, stage="done", progress=1.0, result=result)
    except Exception as exc:
        _set(job, stage="error", error=f"{type(exc).__name__}: {exc}")


@app.get("/health")
def health() -> dict:
    return {
        "ok": _model["ensemble"] is not None,
        "loading": _model["loading"],
        "error": _model["error"],
        "readers": _model["ensemble"].reader_names if _model["ensemble"] else [],
    }


@app.post("/jobs")
def create_job(req: JobRequest) -> dict:
    if _model["ensemble"] is None:
        raise HTTPException(503, "The model is still loading" if _model["loading"] else f"Model failed to load: {_model['error']}")
    key = f"{req.cik}/{req.accession}"
    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "stage": "queued", "progress": 0.0}
    _jobs[job_id] = job
    if key in _cache:
        _set(job, stage="done", progress=1.0, result=_cache[key])
    else:
        _pool.submit(_run, job, req.cik, req.accession)
    if len(_jobs) > 200:
        for old in list(_jobs)[:100]:
            _jobs.pop(old, None)
    return {"id": job_id}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job: Optional[dict] = _jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job")
    with _lock:
        return dict(job)
