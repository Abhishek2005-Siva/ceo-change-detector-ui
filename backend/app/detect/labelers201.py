"""Weak-supervision sentence labelers for Item 2.01 (Completion of Acquisition or
Disposition of Assets).  Owner: training-sec-f5.

Label set (sentence level, one label per sentence):
  ACQUISITION  filer is the acquirer and the deal has closed   ("the Company completed its acquisition of X")
  DISPOSITION  filer is the seller and the sale has closed      ("the Company sold / completed the sale of X")
  ACQUIRED     filer is the target                              ("Merger Sub merged with and into the Company ...",
                                                                  "the Company became a wholly owned subsidiary of P")
  COMPLETED    a closing statement whose direction the sentence alone can't give
                                                                ("On the Closing Date, the Acquisition was consummated.")
  NONE         everything else (deal terms, background, financing, boilerplate, future/conditional language)

Same recipe as the 5.02 detector: confident regex positives, deliberately mined
hard negatives (future / conditional / "agreed to" language that reads like a
closing but isn't), and a SKIP bucket (returned label None) for sentences that
look event-like but that no rule can place -- those are left out of training
rather than mislabeled NONE, which is what poisoned a few 5.02 versions.

The filer is recognised by generic self-references (the Company, we, ...) plus
aliases derived from the filing's own company name via self_aliases().
"""
import re
from typing import Iterable, List, Optional, Tuple

LABELS = ["NONE", "ACQUISITION", "DISPOSITION", "ACQUIRED", "COMPLETED"]

_GENERIC_SELF = r"(?:FILER|the\s+[“\"‘']?(?:Company|Registrant|Partnership|Corporation|Trust|Bank|Issuer|Fund)[”\"’']?|we|our|us)"
_COMPLETE = r"(?:completed|consummated|closed|finalized|effected)"
_ACQ_NOUN = r"(?:acquisition|purchase|merger|business\s+combination)"
_SALE_NOUN = r"(?:sale|divestiture|disposition|divestment|transfer|spin-?off|carve-?out|disposal)"
_DEAL_NOUN = (r"(?:Merger|Acquisition|Transactions?|Closing|Sale|Divestiture|Business\s+Combination|Offer|"
              r"Exchange|Reorganization|Disposition|Purchase|Asset\s+Sale|Spin-?Off|Separation|Distribution)")
_POSS = r"(?:its|the|their|our)?"

# Forward-looking / conditional wording: a sentence matching this is never a
# closing statement, but with a deal noun it makes an excellent hard negative.
FUTURE_RE = re.compile(
    r"\b(?:will|shall|would|may|might|expects?|expected\s+to|anticipat\w+|intend\w*|plans?\s+to|"
    r"agreed\s+to|agrees?\s+to|to\s+be\s+(?:completed|consummated|closed)|has\s+not|have\s+not|"
    r"not\s+yet|still\s+pending|(?:is|are|remains?)\s+pending|subject\s+to\s+(?:the\s+)?(?:satisfaction|completion|approval)|if\b|unless\b|"
    r"in\s+the\s+event|conditions?\s+to|(?:is|are)\s+(?:required|obligated)\s+to)\b",
    re.IGNORECASE,
)
# Deal-mechanics wording (describes what the agreement says, not that it closed).
TERMS_RE = re.compile(
    r"\b(?:pursuant\s+to|provides?\s+(?:that|for)|terms?\s+of|entitled\s+to|representations?|warrant(?:y|ies)|"
    r"covenants?|indemnif\w+|qualified\s+in\s+its\s+entirety|incorporated\s+(?:herein\s+)?by\s+reference|"
    r"filed\s+as\s+Exhibit|attached\s+as\s+Exhibit)\b",
    re.IGNORECASE,
)
_DEAL_NOUN_RE = re.compile(rf"\b{_DEAL_NOUN}\b")
# Event-like past-tense verbs: if one is present and no rule fired and no
# future wording explains it away, the sentence is uncertain -> skip.
_EVENTLIKE_RE = re.compile(
    r"\b(?:acquired|sold|divested|disposed|merged|purchased|consummated|completed|closed|became|surviv\w+)\b",
    re.IGNORECASE,
)
_EFFECTIVE_TIME_RE = re.compile(r"\bEffective\s+Time\b")

_SUFFIX_RE = re.compile(
    r"[,\s]+(?:inc|incorporated|corp|corporation|co|company|ltd|limited|llc|l\.l\.c|lp|l\.p|plc|n\.a|holdings?)\.?$",
    re.IGNORECASE,
)


_GENERIC_TAIL = {"global", "group", "holdings", "holding", "international", "technologies", "technology", "payments", "therapeutics",
                 "pharmaceuticals", "pharma", "bancorp", "bancshares", "financial", "energy", "systems", "resources", "partners", "trust",
                 "capital", "industries", "networks", "sciences", "biosciences", "bio", "corporation", "company", "services", "solutions"}
_COMMON_FIRST = {"first", "american", "united", "national", "general", "new", "north", "south", "east", "west", "great", "pacific",
                 "atlantic", "global", "international", "the", "bank", "capital", "digital", "blue", "green", "royal", "premier", "central"}


def self_aliases(company_name: str, section_text: str = "") -> List[str]:
    """Names the filer calls itself. EDGAR company names are messy ('WATERS CORP /DE/', 'Bunge Global SA'), the text says 'Waters' /
    'Bunge' / 'Shift4' -- so besides the cleaned legal name this returns: the quoted short name defined right after the full name
    (looked for within 80 chars, e.g. 'Shift4 Payments, Inc., a Delaware corporation (“Shift4”)'), the name with generic trailing
    words dropped ('Bunge Global' -> 'Bunge'), and a distinctive first word."""
    name = re.sub(r"/[A-Za-z]{2,3}/?", " ", company_name or "")
    name = re.sub(r"\([^)]*\)", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    prev = None
    while prev != name:                      # strip 'Inc', 'Corp', 'S.A.', ... repeatedly
        prev = name
        name = _SUFFIX_RE.sub("", name).strip(" ,")
        name = re.sub(r"[,\s]+(?:s\.?a\.?|n\.?v\.?|ag|se|plc|sa)$", "", name, flags=re.IGNORECASE).strip(" ,")
    out: List[str] = []
    if len(name) >= 3:
        out.append(name)
        m = re.search(re.escape(name) + r".{0,80}?\(\s*(?:together\s+with[^)]{0,80}?,\s*)?(?:the\s+)?[“\"]([^”\"]{2,30})[”\"]",
                      section_text or "", re.IGNORECASE)
        if m and m.group(1).strip().lower() not in {"company", "registrant", "partnership", "corporation"}:
            out.append(m.group(1).strip())
        words = name.split()
        while len(words) > 1 and words[-1].lower() in _GENERIC_TAIL:
            words = words[:-1]
            out.append(" ".join(words))
        if len(words) >= 1 and len(words[0]) >= 4 and words[0].lower() not in _COMMON_FIRST:
            out.append(words[0])
    seen, uniq = set(), []
    for a in out:
        if a.lower() not in seen:
            seen.add(a.lower())
            uniq.append(a)
    return uniq


_SELF_MARK_BASE = r"the\s+[“\"‘']?(?:Company|Registrant|Partnership|Corporation|Trust|Bank|Issuer|Fund)[”\"’']?"


def mark_self(sentence: str, aliases: Iterable[str] = ()) -> str:
    """Replace the filer's own references (the Company, the Registrant, its name / defined short name) with the
    token FILER. A single sentence like "Juniper became a wholly owned subsidiary of HPE" is ambiguous unless the
    model knows which party IS the filer; with the marking it reads "... subsidiary of FILER" (filer = acquirer).
    Applied identically at training-data build time and at inference time."""
    alts = [r"\b" + re.escape(a) + r"\b" for a in sorted(set(aliases), key=len, reverse=True) if a]
    pat = "|".join([_SELF_MARK_BASE] + alts)
    return re.sub(pat, "FILER", sentence, flags=re.IGNORECASE)


def build_rules(aliases: Iterable[str] = ()) -> dict:
    alias_alt = "|".join(re.escape(a) for a in sorted(set(aliases), key=len, reverse=True) if a)
    self_re = _GENERIC_SELF if not alias_alt else rf"(?:{_GENERIC_SELF}|{alias_alt})"
    f = re.IGNORECASE
    return {
        "ACQUIRED": [
            re.compile(rf"\b{self_re}\b.{{0,80}}?\b(?:survived|surviving|became|become|becomes|is\s+now|are\s+now|continued\s+as|continuing\s+as)\b"
                       rf".{{0,100}}?\bwholly[\s-]owned\s+subsidiary\s+of\b", f),
            # Only a merger SUBSIDIARY merging into the filer makes the filer the target (reverse triangular merger).
            # "<target> merged with and into <filer>" makes the filer the acquirer -- see ACQUISITION below.
            re.compile(rf"\b(?:Merger\s+Sub\w*|Acquisition\s+Sub\w*|Merger\s+Subsidiary|Purchaser|Buyer\s+Sub\w*|Sub)\b.{{0,60}}?\bmerged\s+(?:with\s+and\s+)?into\s+{self_re}\b", f),
            re.compile(rf"\b{_COMPLETE}\s+{_POSS}\s*(?:previously\s+announced\s+)?{_ACQ_NOUN}\s+of\s+(?:all\s+of\s+)?{self_re}\b", f),
            re.compile(rf"\b{self_re}\b\s+(?:was|were|has\s+been)\s+acquired\s+by\b", f),
            re.compile(rf"\bacquired\s+(?:all|substantially\s+all|100%|the\s+entire).{{0,60}}?\b(?:shares|stock|equity|interests?|units)\b.{{0,40}}?\bof\s+{self_re}\b", f),
        ],
        "DISPOSITION": [
            re.compile(rf"\b{self_re}\b.{{0,60}}?\b{_COMPLETE}\s+{_POSS}\s*(?:previously\s+announced\s+)?{_SALE_NOUN}\s+of\b", f),
            re.compile(rf"\b{self_re}\b.{{0,100}}?\b(?:sold|divested|disposed\s+of)\b", f),
            re.compile(rf"\b{self_re}['’]s\s+{_SALE_NOUN}\s+of\b.{{0,200}}?\b(?:was|were)\s+{_COMPLETE}\b", f),
            re.compile(rf"\b{self_re}\s+received\b.{{0,100}}?\b(?:consideration|proceeds|purchase\s+price)", f),
        ],
        "ACQUISITION": [
            re.compile(rf"\b{self_re}\b.{{0,60}}?\b{_COMPLETE}\s+{_POSS}\s*(?:previously\s+announced\s+)?{_ACQ_NOUN}\s+of\b", f),
            re.compile(rf"\b{self_re}\b.{{0,80}}?\b(?:acquired|purchased)\b(?!\s+by\b)", f),
            # the other side became the filer's subsidiary / merged INTO the filer / the filer paid -> filer is the acquirer
            re.compile(rf"\bbecame\s+(?:a\s+|an\s+)?(?:(?:direct|indirect)(?:\s+or\s+indirect)?,?\s+)?wholly[\s-]owned\s+subsidiar(?:y|ies)\s+of\s+{self_re}\b", f),
            re.compile(rf"\bmerged\s+(?:with\s+and\s+)?into\s+{self_re}\b", f),
            re.compile(rf"\b{self_re}\s+(?:paid|funded)\b.{{0,100}}?\b(?:consideration|purchase\s+price|cash)", f),
        ],
        "COMPLETED": [
            re.compile(rf"\b{_DEAL_NOUN}\b.{{0,80}}?\b(?:was|were|has\s+been|have\s+been)\s+{_COMPLETE}\b"),
            re.compile(rf"\b{_COMPLETE}\s+(?:the\s+|its\s+|their\s+)?(?:previously\s+announced\s+)?{_DEAL_NOUN}\b"),
            re.compile(rf"\b{_DEAL_NOUN}\s+(?:closed|was\s+consummated|became\s+effective)\b"),
            # lowercase generic nouns: "The sale of the lots closed on ...", "the sale of the Arizona Assets was consummated"
            re.compile(rf"\b(?:the|this)\s+(?:sale|acquisition|merger|purchase|transaction|closing|disposition)\b.{{0,100}}?"
                       rf"\b(?:closed|was\s+(?:consummated|completed|closed)|were\s+(?:consummated|completed|closed)|became\s+effective)\b", re.IGNORECASE),
        ],
    }


# Checked in this order: target before acquirer so "X completed its acquisition
# of the Company" is ACQUIRED, not ACQUISITION; COMPLETED is the direction-less fallback.
_ORDER = ["ACQUIRED", "DISPOSITION", "ACQUISITION", "COMPLETED"]


def _is_future(sentence: str, match: "re.Match") -> bool:
    """Forward-looking wording between the sentence start and the end of the match."""
    return bool(FUTURE_RE.search(sentence[: match.end()]))


def classify(sentence: str, rules: dict) -> Tuple[Optional[str], str]:
    """-> (label, bucket).  label None means SKIP (leave out of training).
    bucket: 'positive' | 'hard_negative' | 'generic_negative' | 'skip'."""
    for label in _ORDER:
        for rx in rules[label]:
            m = rx.search(sentence)
            if not m:
                continue
            if _is_future(sentence, m):
                return "NONE", "hard_negative"
            return label, "positive"
    if _DEAL_NOUN_RE.search(sentence) and (FUTURE_RE.search(sentence) or TERMS_RE.search(sentence)):
        return "NONE", "hard_negative"
    if _EFFECTIVE_TIME_RE.search(sentence) or _EVENTLIKE_RE.search(sentence):
        return None, "skip"
    return "NONE", "generic_negative"


from .deal_text import extract_amounts  # noqa: E402,F401
