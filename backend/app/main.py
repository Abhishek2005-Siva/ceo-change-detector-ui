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
# A filing whose Item 5.02 text never mentions a CEO-type title cannot contain a CEO appointment or resignation.
CEO_HINT = re.compile(r"chief\s+executive|\bCEO\b|principal\s+executive|president", re.IGNORECASE)


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


# Normally load in the background at startup. The Modal memory-snapshot path loads synchronously instead (MODEL_AUTOLOAD=0).
if os.getenv("MODEL_AUTOLOAD", "1") == "1":
    threading.Thread(target=_load, daemon=True).start()


class JobRequest(BaseModel):
    cik: str = Field(pattern=r"^\d{1,10}$")
    accession: str = Field(pattern=r"^\d{10}-\d{2}-\d{6}$")


EST_PER_UNIT = 0.06  # seconds per (sentence x reader) on the 8-core container; refined live from real timings


def _view(job: dict) -> dict:
    """Job state for the browser, with live elapsed time and a remaining-time estimate."""
    with _lock:
        d = dict(job)
    now = time.time()
    end = d.get("t_end")
    d["elapsed"] = round((end or now) - d["t0"], 1)
    stage = d["stage"]
    if stage in ("done", "error"):
        eta = 0.0
    elif stage == "reading" and d.get("unitsTotal"):
        done, total = d.get("unitsDone", 0), d["unitsTotal"]
        spent = now - d["readStart"]
        rate = spent / done if done > 0 and spent > 1.5 else EST_PER_UNIT
        eta = max(0.0, (total - done) * rate)
    elif stage == "splitting" and d.get("unitsTotal"):
        eta = d["unitsTotal"] * EST_PER_UNIT
    elif stage == "locating":
        eta = 4.0
    else:
        eta = 6.0
    d["etaSeconds"] = round(eta, 1)
    for k in ("t0", "t_end", "readStart"):
        d.pop(k, None)
    return d


def _set(job: dict, **kw) -> None:
    with _lock:
        job.update(kw)


def _run(job: dict, cik: str, accession: str) -> None:
    t0 = time.time()
    try:
        _set(job, stage="fetching", progress=0.05)
        text, meta = fetch_filing(cik, accession)
        if text is None:
            _set(job, stage="error", t_end=time.time(), error="The SEC did not return this filing (not found or temporarily unavailable).")
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
            _set(job, stage="done", progress=1.0, t_end=time.time(), result={
                "filing": filing, "item502Found": False, "section": "", "sentences": [],
                "appointed": {"found": False}, "resigned": {"found": False},
                "seconds": round(time.time() - t0, 1),
            })
            return
        _set(job, stage="splitting", progress=0.3)
        sentences = split_sentences(section)
        total_units = max(1, len(sentences) * 3)
        _set(job, stage="splitting", progress=0.3, sentenceCount=len(sentences), unitsTotal=total_units, unitsDone=0)
        _set(job, stage="reading", progress=0.35, readStart=time.time(), readersDone=0)
        ens = _model["ensemble"]

        def on_progress(done: int, total: int, reader_idx: int) -> None:
            _set(job, unitsDone=done, readersDone=reader_idx, progress=0.35 + 0.6 * done / total)

        gate_skips = CEO_HINT.search(section) is None
        if gate_skips and os.getenv("CEO_GATE", "1") == "1":
            out = {
                "sentences": [],
                "appointed": {"found": False},
                "resigned": {"found": False},
                "skippedModel": "This leadership section never mentions a CEO or president, so no CEO change is possible.",
            }
        else:
            out = ens.analyze(sentences, on_progress)
        result = {
            "filing": filing,
            "item502Found": True,
            "section": section[:8000],
            "readers": ens.reader_names,
            "seconds": round(time.time() - t0, 1),
            **out,
        }
        _cache[f"{cik}/{accession}"] = result
        _set(job, stage="done", progress=1.0, result=result, t_end=time.time())
    except Exception as exc:
        _set(job, stage="error", t_end=time.time(), error=f"{type(exc).__name__}: {exc}")


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
    job = {"id": job_id, "stage": "queued", "progress": 0.0, "t0": time.time()}
    _jobs[job_id] = job
    if key in _cache:
        _set(job, stage="done", progress=1.0, result=_cache[key], t_end=time.time())
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
    return _view(job)
