"""Download one SEC filing and return its primary 8-K document as plain text.

Adapted from the training project's sec_fetch.py: the .txt submission SEC serves is an
SGML wrapper holding every document in the filing, so we keep only the primary <DOCUMENT>
(the 8-K itself) and strip the HTML/inline-XBRL noise.
"""
import os
import re
import time
from dataclasses import dataclass, field
from typing import List, Optional

import requests
from bs4 import BeautifulSoup

SEC_USER_AGENT = os.getenv("SEC_USER_AGENT", "LeadershipChangeDetector contact@example.com")

_DOCUMENT_RE = re.compile(r"<DOCUMENT>(.*?)</DOCUMENT>", re.DOTALL | re.IGNORECASE)
_TYPE_RE = re.compile(r"<TYPE>([^\r\n<]+)", re.IGNORECASE)
_TEXT_RE = re.compile(r"<TEXT>(.*?)</TEXT>", re.DOTALL | re.IGNORECASE)
_DISPLAY_NONE_RE = re.compile(r"display\s*:\s*none", re.IGNORECASE)
_session = requests.Session()


@dataclass
class FilingMeta:
    company: str = ""
    form: str = ""
    filed: str = ""
    items: List[str] = field(default_factory=list)


def filing_txt_url(cik: str, accession: str) -> str:
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession}.txt"


def _fetch_raw(url: str) -> Optional[bytes]:
    for attempt in range(4):
        try:
            resp = _session.get(url, headers={"User-Agent": SEC_USER_AGENT}, timeout=60)
        except requests.RequestException:
            time.sleep(2**attempt)
            continue
        if resp.status_code == 200:
            return resp.content
        if resp.status_code == 404:
            return None
        if resp.status_code in (403, 429, 500, 502, 503, 504):
            time.sleep(2**attempt)
            continue
        resp.raise_for_status()
    return None


def _header_meta(raw: str) -> FilingMeta:
    head = raw[:6000]

    def grab(label: str) -> str:
        m = re.search(label + r":\s*(.+)", head)
        return m.group(1).strip() if m else ""

    filed = grab("FILED AS OF DATE")
    if len(filed) == 8:
        filed = f"{filed[:4]}-{filed[4:6]}-{filed[6:]}"
    items = [m.group(1).strip().split(":")[0] for m in re.finditer(r"ITEM INFORMATION:\s*(.+)", head)]
    return FilingMeta(
        company=grab("COMPANY CONFORMED NAME"),
        form=grab("CONFORMED SUBMISSION TYPE"),
        filed=filed,
        items=items,
    )


def _primary_document(raw_text: str) -> str:
    documents = _DOCUMENT_RE.findall(raw_text)
    if not documents:
        return raw_text
    chosen = None
    for doc in documents:
        t = _TYPE_RE.search(doc)
        if t and t.group(1).strip().upper().startswith("8-K"):
            chosen = doc
            break
    if chosen is None:
        chosen = documents[0]
    m = _TEXT_RE.search(chosen)
    return m.group(1) if m else chosen


def _html_to_text(html: str) -> str:
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    for tag in soup.find_all(["ix:header", "ix:hidden", "ix:references", "ix:resources"]):
        tag.decompose()
    for tag in soup.find_all(style=True):
        if _DISPLAY_NONE_RE.search((getattr(tag, "attrs", None) or {}).get("style", "")):
            tag.decompose()
    lines = [ln.strip() for ln in soup.get_text(separator="\n").splitlines()]
    return "\n".join(ln for ln in lines if ln)


def fetch_filing(cik: str, accession: str):
    """Returns (plain_text, meta) or (None, None) if the filing can't be downloaded."""
    raw = _fetch_raw(filing_txt_url(cik, accession))
    if raw is None:
        return None, None
    raw_text = raw.decode("utf-8", errors="replace")
    return _html_to_text(_primary_document(raw_text)), _header_meta(raw_text)
