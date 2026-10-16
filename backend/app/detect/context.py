"""Shared model-input builder for the Item 1.03 (bankruptcy) and Item 3.01
(listing notice / delisting) detectors.

Why a section-level input and not single sentences like the 5.02 CEO model:
these Item sections are short and formulaic, the *event* is usually spread over
two or three adjacent sentences ("received a letter ... notifying the Company
that ... bid price ... below $1.00"), and per-sentence LLM labels turned out to
be unstable on the elaboration sentences ("a Chapter 7 trustee will be
appointed" -> receivership?). The same builder is used for labeling, training
and Kaggle inference so the model always sees one input shape.

Pure stdlib + src.items.split_item_sentences (imported lazily so this module
can be imported by Kaggle scripts that bundle src/).
"""
import re
from typing import Dict, List

CFO_TITLE_PATTERN = r"(?:chief\s+financial\s+officer|\bcfo\b|principal\s+financial\s+officer|chief\s+financial\s+and\s+\w+(?:\s+\w+)?\s+officer)"

CEO_TITLE_PATTERN = r"(?:chief\s+executive\s+officer|\bceo\b|principal\s+executive\s+officer)"

ITEM_CFG: Dict[str, dict] = {
    # CEO / interim CEO appointed or resigned (same Item 5.02 population as the CFO task, CEO-mentioning sentences only)
    "5.02ceo": {
        "caption_re": r"departure\s+of\s+directors",
        "labels": ["CEO_APPOINTED", "CEO_RESIGNED"],
        "kw": re.compile(CEO_TITLE_PATTERN, re.I),
    },
    # CFO / interim CFO appointed or resigned. Declared Item 5.02 filings, but only the sentences that mention a
    # CFO title are shown to the model (5.02 sections also carry directors, comp plans, other officers).
    "5.02": {
        "caption_re": r"departure\s+of\s+directors",
        "labels": ["CFO_APPOINTED", "CFO_RESIGNED"],
        "kw": re.compile(CFO_TITLE_PATTERN, re.I),
    },
    "1.03": {
        "caption_re": r"bankruptcy\s+or\s+receivership",
        "labels": ["PETITION_FILED", "RECEIVERSHIP", "PLAN_CONFIRMED", "CONVERTED_DISMISSED"],
        "kw": re.compile(
            r"bankrupt|chapter\s+(?:7|9|11|12|13|15)\b|petition|receiver|assignment\s+for\s+the\s+benefit|"
            r"insolven|liquidat|debtor|reorganiz|plan\s+of|confirm|emerg|dismiss|conver|"
            r"effective\s+date|trustee|creditor", re.I),
    },
    "3.01": {
        "caption_re": r"notice\s+of\s+delisting",
        "labels": ["DEFICIENCY_NOTICE", "DELISTING_EXCHANGE", "DELISTING_VOLUNTARY", "TRANSFER",
                   "COMPLIANCE_REGAINED"],
        "kw": re.compile(
            r"nasdaq|nyse|new\s+york\s+stock\s+exchange|stock\s+exchange|listing|listed|delist|bid\s+price|"
            r"complian|deficien|form\s+25|suspend|transfer|otc\b|market\s+value|stockholders.{0,3}\s+equity|"
            r"minimum|cure|panel|hearing", re.I),
    },
}

# Sentences that carry no event information and only burn the token budget.
_BOILERPLATE_RE = re.compile(
    r"forward[\s-]looking|safe\s+harbor|cautionary\s+statement|risks\s+and\s+uncertainties|"
    r"based\s+on\s+management.{0,3}s\s+current\s+expectations|highly\s+speculative|private\s+securities\s+litigation|qualified\s+in\s+its\s+entirety|"
    r"does\s+not\s+purport\s+to\s+be\s+complete|is\s+attached\s+(?:hereto\s+)?as\s+exhibit|"
    r"incorporated\s+(?:herein\s+)?by\s+reference|copy\s+of\s+the\s+press\s+release|"
    r"financial\s+statements\s+and\s+exhibits|pursuant\s+to\s+the\s+requirements\s+of\s+the\s+securities",
    re.I)

MAX_CHARS = 1900         # ~450 RoBERTa tokens on SEC legal prose
STUB_CHARS = 350         # a section shorter than this is almost always a cross-reference stub
SENT_CAP = 600           # a single runaway "sentence" (table blob etc.) must not eat the budget


# The prescribed Form 8-K caption is identical in (nearly) every filing that declares the Item, so
# leaving any of it in the model input gives a trivial "caption present => positive" shortcut (the
# same trap documented for 5.02 in src/item502.py). Strip the whole caption before sentence-splitting
# -- split_item_sentences() alone only drops the first fragment of it.
_CAPTION_FULL = {
    "5.02ceo": None,  # filled below (same caption as 5.02)
    "5.02": re.compile(
        r"(?i)\bitem\s*5\.02[\s.:\-\u2013\u2014]*departure\s+of\s+directors\s+or\s+(?:certain\s+)?(?:principal\s+)?officers"
        r"[;,]?\s*election\s+of\s+directors[;,]?\s*appointment\s+of\s+(?:certain\s+)?(?:principal\s+)?officers"
        r"[;,]?\s*compensatory\s+arrangements\s+of\s+certain\s+officers\.?"),
    "1.03": re.compile(r"(?i)\bitem\s*1\.03[\s.:\-\u2013\u2014]*bankruptcy\s+or\s+receivership\.?"),
    "3.01": re.compile(
        r"(?i)\bitem\s*3\.01[\s.:\-\u2013\u2014]*notice\s+of\s+delisting\s+or\s+failure\s+to\s+satisfy\s+a\s+continued\s+"
        r"listing\s+rule\s+or\s+standard;?\s*transfer\s+of\s+listing\.?"),
}


_CAPTION_FULL["5.02ceo"] = _CAPTION_FULL["5.02"]


def _sentences(text: str, item: str) -> List[str]:
    from .items import split_item_sentences
    text = _CAPTION_FULL[item].sub(" ", re.sub(r"\s+", " ", text or ""))
    return split_item_sentences(text, ITEM_CFG[item]["caption_re"])


_DATE_RE = re.compile(
    r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})")


def annotate_dates(text: str, filing_date: str) -> str:
    """Append the day offset from the filing date after every full date: 'April 5, 2024 [D-54]' means the
    date is 54 days BEFORE the filing ('[D+3]' = 3 days after). Whether an event is *new* in a filing is
    mostly a date-gap judgement (a petition 5 days ago vs. 54 days ago), and a text encoder cannot do date
    arithmetic on its own -- so the arithmetic is done here, deterministically, at build time."""
    from datetime import datetime
    try:
        fd = datetime.strptime(filing_date, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return text

    def sub(m):
        try:
            d = datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%B %d %Y").date()
        except ValueError:
            return m.group(0)
        delta = (fd - d).days
        return f"{m.group(0)} [D{'-' if delta >= 0 else '+'}{abs(delta)}]"
    return _DATE_RE.sub(sub, text)


def build_context(item: str, section: str, body_kw: str = "", max_chars: int = MAX_CHARS,
                  filing_date: str = None) -> str:
    """Model input for one filing. `section` is the sliced Item section (may be
    empty/None for filings that never declared the Item); `body_kw` is the
    keyword-bearing sentences from the rest of the filing (harvest.py)."""
    kw = ITEM_CFG[item]["kw"]
    sents = _sentences(section or "", item)
    keep = [s for s in sents if not _BOILERPLATE_RE.search(s)]
    hits = [s for s in keep if kw.search(s)]
    chosen = hits if hits else keep
    stub = len(" ".join(sents)) < STUB_CHARS or not hits
    if stub and body_kw:
        seen = set(chosen)
        chosen = chosen + [s for s in _sentences(body_kw, item) if s not in seen and not _BOILERPLATE_RE.search(s)]
    out, size = [], 0
    for s in chosen:
        s = s[:SENT_CAP]
        if size + len(s) > max_chars and out:
            break
        out.append(s)
        size += len(s) + 1
    text = " ".join(out)
    return annotate_dates(text, filing_date) if filing_date else text
