"""Section text -> sentences for Items 2.01 / 1.01 / 1.02 (owner: training-sec-f5).

Thin wrapper over src.items.split_item_sentences that first strips the item's
own caption. The shared splitter drops any "sentence" that *starts with* the
caption, which is fine when the caption ends in a period but swallows the whole
first paragraph when the heading has no terminal punctuation (seen on iRhythm's
Item 1.02: "Item 1.02 Termination of a Material Definitive Agreement\nTermination
of SVB Loan ... was terminated ..." came back as zero sentences).
"""
import re
from typing import List

CAPTIONS = {
    "1.01": r"Entry\s+into\s+a\s+Material\s+Definitive\s+Agreement",
    "1.02": r"Termination\s+of\s+a\s+Material\s+Definitive\s+Agreement",
    "3.02": r"Unregistered\s+Sales\s+of\s+Equity\s+Securities",
    "2.01": r"Completion\s+of\s+Acquisition\s+or\s+Disposition\s+of\s+Assets",
}
_HEAD_PREFIX = r"^\s*item[\s|]*\d{1,2}\.\d{2}[\s.:|\-–—]*"


def strip_caption(section: str, item: str) -> str:
    cap = CAPTIONS[item]
    out = re.sub(_HEAD_PREFIX + r"(?:" + cap + r")?[\s.:|\-–—]*", "", section, count=1, flags=re.IGNORECASE)
    return out.strip()


def deal_sentences(section: str, item: str) -> List[str]:
    from .items import split_item_sentences
    return split_item_sentences(strip_caption(section, item), None)


_AMOUNT_RE = re.compile(r"(?:US\s?)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|[MBK]\b)?", re.IGNORECASE)
_MULT = {"billion": 1e9, "b": 1e9, "million": 1e6, "m": 1e6, "thousand": 1e3, "k": 1e3}


def extract_amounts(text: str) -> List[float]:
    """Dollar amounts in `text`, in dollars (regex only; not model-derived)."""
    out = []
    for m in _AMOUNT_RE.finditer(text):
        try:
            v = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        out.append(v * _MULT.get((m.group(2) or "").lower(), 1.0))
    return out
