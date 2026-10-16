"""One download of a filing, parsed two ways: plain text (CEO / bankruptcy / delisting models were
trained on this) and table-preserving text (auditor and shareholder-vote parsers need row structure)."""
from typing import Optional, Tuple

from ..sec_fetch import FilingMeta, _fetch_raw, _header_meta, _html_to_text, _primary_document, filing_txt_url
from .items import html_to_text_with_tables, normalize_filing_text


def fetch_all(cik: str, accession: str) -> Tuple[Optional[str], Optional[str], Optional[FilingMeta]]:
    raw = _fetch_raw(filing_txt_url(cik, accession))
    if raw is None:
        return None, None, None
    raw_text = raw.decode("utf-8", errors="replace")
    primary = _primary_document(raw_text)
    return _html_to_text(primary), normalize_filing_text(html_to_text_with_tables(primary)), _header_meta(raw_text)
