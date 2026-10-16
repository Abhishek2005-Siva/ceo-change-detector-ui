"""Weak-supervision labelers + regex extractors for Item 3.02 (Unregistered Sales of Equity Securities).
Owner: training-sec-f5.

Two sentence-level tasks (same shape as 1.01/1.02):
  EVENT  NONE / SALE        does this sentence announce securities being issued / sold / agreed to be sold?
  TYPE   COMMON / PREFERRED / CONVERTIBLE_DEBT / WARRANT / UNITS / EQUITY_AWARD
                            trained on SALE sentences whose keywords place the instrument
Regex extractors (best-effort, NOT model output; scored against the judge's answers): gross proceeds, price per share,
share count, exemption (Section 4(a)(2), Reg D, Reg S, 3(a)(9), 3(a)(10)).

Hard negatives: legends / exemption boilerplate / conversion-and-exercise terms / future-conditional wording that mention
shares and "issued" without announcing an issuance. Event-like sentences no rule places go to SKIP (label None).
"""
import re
from typing import Dict, List, Optional, Tuple

EVENT_LABELS = ["NONE", "SALE"]
TYPE_LABELS = ["COMMON", "PREFERRED", "CONVERTIBLE_DEBT", "WARRANT", "UNITS", "EQUITY_AWARD"]

_SECURITY = re.compile(
    r"\b(?:shares?|common\s+stock|stock|warrants?|notes?|debentures?|units?|options?|restricted\s+stock|RSUs?|"
    r"preferred|convertible|securities|interests?|membership\s+units|ordinary\s+shares|ADSs?)\b", re.IGNORECASE)
_SALE_VERB = re.compile(
    r"\b(?:issued|sold|granted|(?:to\s+)?issue\s+and\s+sell|agreed\s+to\s+(?:issue|sell)|(?:to\s+)?(?:issue|sell)|"
    r"entered\s+into\s+(?:an?\s+|the\s+)?(?:\w+\s+){0,3}(?:securities\s+purchase|subscription|purchase|exchange|equity)\s+agreement|"
    r"completed\s+(?:a|an|the)\s+(?:private\s+placement|offering|financing)|closed\s+(?:a|an|the)\s+(?:private\s+placement|offering|financing))\b",
    re.IGNORECASE)
# wording that turns an issuance verb into a term / condition / possibility, not an event
_FUTURE_BEFORE = re.compile(
    r"\b(?:may|might|will|would|could|can|upon|if|unless|until|in\s+the\s+event|right\s+to|option\s+to|obligat\w+\s+to|"
    r"required\s+to|permitted\s+to|entitled\s+to|subject\s+to)\b[^.]{0,40}$", re.IGNORECASE)
_BOILERPLATE = re.compile(
    r"\b(?:not\s+been\s+registered|have\s+not\s+been\s+registered|legend|restricted\s+securities|exempt(?:ion)?\s+from\s+registration|"
    r"in\s+reliance\s+(?:up)?on|pursuant\s+to\s+(?:an\s+)?exemption|no\s+general\s+solicitation|accredited\s+investors?\s+(?:as\s+defined|within)|"
    r"offer\s+and\s+sale\s+of|qualified\s+in\s+its\s+entirety|incorporated\s+(?:herein\s+)?by\s+reference|forward-looking)\b", re.IGNORECASE)
_TERMS = re.compile(
    r"\b(?:conversion\s+price|exercise\s+price|convertible\s+into|exercisable\s+(?:for|into)|anti-dilution|beneficial\s+ownership\s+limitation|"
    r"4\.99%|9\.99%|interest\s+rate|matur\w+|vest(?:s|ed|ing)?)\b", re.IGNORECASE)
_EVENTLIKE = re.compile(r"\b(?:issued|sold|granted|issue|sell|purchase[sd]?|subscri\w+|placement)\b", re.IGNORECASE)


def classify_event(sentence: str) -> Tuple[Optional[str], str]:
    """-> (label, bucket); label None = SKIP."""
    if _SECURITY.search(sentence):
        for m in _SALE_VERB.finditer(sentence):
            if _FUTURE_BEFORE.search(sentence[max(0, m.start() - 60):m.start()]) and "agreed" not in m.group(0).lower():
                return "NONE", "hard_negative"
            has_numbers = bool(re.search(r"\d", sentence))
            if _BOILERPLATE.search(sentence) and not has_numbers:
                return "NONE", "hard_negative"
            if _TERMS.search(sentence) and not re.search(r"\b(?:issued|sold|granted)\b", sentence, re.IGNORECASE):
                return "NONE", "hard_negative"
            return "SALE", "positive"
    if _BOILERPLATE.search(sentence) or _TERMS.search(sentence):
        return "NONE", "hard_negative"
    if _EVENTLIKE.search(sentence):
        return None, "skip"
    return "NONE", "generic_negative"


_TYPE_PATTERNS = [
    ("EQUITY_AWARD", r"restricted\s+stock\s+units?|RSUs?\b|stock\s+options?|options?\s+to\s+purchase|restricted\s+(?:stock|shares)\s+award|performance\s+(?:shares|units)|equity\s+incentive|stock\s+award"),
    ("CONVERTIBLE_DEBT", r"convertible\s+(?:promissory\s+)?(?:note|debenture)s?|promissory\s+notes?|senior\s+(?:secured\s+)?notes?|debentures?|notes\s+due|\bnotes?\b"),
    ("UNITS", r"\bunits?\b(?!\s+(?:of\s+LLC|membership))|units\s+consisting|each\s+unit"),
    ("WARRANT", r"warrants?|pre-?funded"),
    ("PREFERRED", r"preferred\s+(?:stock|shares)|series\s+[A-Z0-9-]+\s+(?:convertible\s+)?preferred"),
    ("COMMON", r"common\s+(?:stock|shares)|ordinary\s+shares|shares\s+of\s+(?:the\s+)?(?:Company['’]s\s+)?common|ADSs?\b"),
]
_GENERIC_SHARES = re.compile(r"\bshares\b", re.IGNORECASE)   # only a fallback: "10,000 shares of Series A Preferred" must not read as COMMON
_TYPE_RX = [(n, re.compile(r"\b(?:" + p + r")", re.IGNORECASE)) for n, p in _TYPE_PATTERNS]   # leading \b: "RSUs?" must not match inside "Pursuant"


def security_type(sentence: str) -> Optional[str]:
    """Instrument named first in the sentence (earliest keyword wins; list order breaks ties)."""
    best = None
    for rank, (name, rx) in enumerate(_TYPE_RX):
        m = rx.search(sentence)
        if m and (best is None or (m.start(), rank) < (best[1], best[2])):
            best = (name, m.start(), rank)
    if best:
        return best[0]
    return "COMMON" if _GENERIC_SHARES.search(sentence) else None


# ---- numeric / exemption extractors (regex, best effort) ----------------------------------------
_MULT = {"billion": 1e9, "b": 1e9, "million": 1e6, "m": 1e6, "thousand": 1e3, "k": 1e3}
_MONEY = r"(?:US\s?)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|[MBK]\b)?"
_PROCEEDS = re.compile(
    r"(?:gross|aggregate|total|net)\s+(?:cash\s+)?(?:proceeds|purchase\s+price|consideration|offering\s+price)[^$]{0,60}?" + _MONEY
    + r"|(?:for|raising|raised)\s+(?:an\s+)?(?:aggregate\s+)?(?:of\s+)?(?:approximately\s+)?" + _MONEY, re.IGNORECASE)
_PRICE = re.compile(r"(?:at|price\s+of|for)\s+(?:a\s+(?:purchase\s+)?price\s+of\s+)?(?:approximately\s+)?\$\s?(\d*\.?\d+)\s+per\s+(?:share|unit|ADS|warrant)", re.IGNORECASE)
_SHARES = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s+(?:shares|units|warrants|ADSs)", re.IGNORECASE)
_EXEMPTIONS = [
    ("4(a)(2)", re.compile(r"4\(a\)\(2\)|Section\s+4\(2\)", re.IGNORECASE)),
    ("REG_D", re.compile(r"Regulation\s+D\b|Rule\s+50[6-9]|Rule\s+50[46]", re.IGNORECASE)),
    ("REG_S", re.compile(r"Regulation\s+S\b|Rule\s+90[1-5]", re.IGNORECASE)),
    ("3(a)(9)", re.compile(r"3\(a\)\(9\)", re.IGNORECASE)),
    ("3(a)(10)", re.compile(r"3\(a\)\(10\)", re.IGNORECASE)),
]


def _money(m) -> float:
    groups = [g for g in m.groups() if g is not None]
    val = float(groups[0].replace(",", ""))
    return val * _MULT.get((groups[1] if len(groups) > 1 else "").lower(), 1.0)


def extract_numbers(text: str) -> Dict[str, Optional[float]]:
    """Best-effort deal numbers from a sentence or section: the largest 'gross proceeds / aggregate ...' amount, a per-share
    price, and the largest share count."""
    proceeds = [ _money(m) for m in _PROCEEDS.finditer(text)]
    price = [float(m.group(1)) for m in _PRICE.finditer(text)]
    shares = [float(m.group(1).replace(",", "")) for m in _SHARES.finditer(text)]
    return {"gross_proceeds_usd": max(proceeds) if proceeds else None,
            "price_per_share_usd": price[0] if price else None,
            "shares": max(shares) if shares else None}


def extract_exemptions(text: str) -> List[str]:
    return [name for name, rx in _EXEMPTIONS if rx.search(text)]
