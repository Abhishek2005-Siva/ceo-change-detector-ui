"""One download of a filing, parsed two ways: plain text (CEO / bankruptcy / delisting models were
trained on this) and table-preserving text (auditor and shareholder-vote parsers need row structure)."""
from typing import Optional, Tuple

import re

from ..sec_fetch import _DOCUMENT_RE, _TEXT_RE, _TYPE_RE, FilingMeta, _fetch_raw, _header_meta, _html_to_text, _primary_document, filing_txt_url
from .items import html_to_text_with_tables, normalize_filing_text


_EX99_RE = re.compile(r"^EX-?99(\.\d+)?$", re.IGNORECASE)


def _press_release(raw_text: str) -> Optional[str]:
    """Text of the first EX-99* exhibit (the earnings press release), table-preserving, or None."""
    for doc in _DOCUMENT_RE.findall(raw_text):
        t = _TYPE_RE.search(doc)
        if t and _EX99_RE.match(t.group(1).strip().upper()):
            m = _TEXT_RE.search(doc)
            return html_to_text_with_tables(m.group(1) if m else doc)
    return None


def fetch_all(cik: str, accession: str) -> Tuple[Optional[str], Optional[str], Optional[FilingMeta], Optional[str]]:
    raw = _fetch_raw(filing_txt_url(cik, accession))
    if raw is None:
        return None, None, None, None
    raw_text = raw.decode("utf-8", errors="replace")
    primary = _primary_document(raw_text)
    return _html_to_text(primary), normalize_filing_text(html_to_text_with_tables(primary)), _header_meta(raw_text), _press_release(raw_text)
