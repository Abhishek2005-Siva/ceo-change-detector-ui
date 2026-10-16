"""Deterministic (regex) labels, evidence sentences and field extraction for
Item 1.03 (bankruptcy) and Item 3.01 (listing notice / delisting).

Three jobs, all independent of any ML model:
  1. An independent cross-check on the NVIDIA LLM labels (disagreements get
     adjudicated by hand before anything is trusted as ground truth).
  2. Evidence-sentence selection for the final output: the model decides *which*
     event types a filing reports, the rules pick the sentence that states each.
  3. Informational field extraction (chapter, court, case no., exchange, rule,
     deficiency category, cure deadline) -- the analysis columns of the combined
     8-K table.

"Newness": an Item 1.03/3.01 section often recaps older events ("As previously
reported, on September 11, 2024 the Debtors filed...") before reporting the new
one. A sentence counts as new when it carries a date within a few days of the
filing date, or has no date and no 'previously reported' phrasing.
"""
import re
from datetime import date, datetime
from typing import Dict, List, Optional, Set

from .context import CEO_TITLE_PATTERN, CFO_TITLE_PATTERN, ITEM_CFG, _BOILERPLATE_RE, _sentences

_MONTHS = ("January|February|March|April|May|June|July|August|September|October|November|December")
DATE_RE = re.compile(rf"({_MONTHS})\s+(\d{{1,2}}),?\s+(\d{{4}})")
BACKGROUND_RE = re.compile(
    r"(?i)as\s+(?:previously\s+)?(?:reported|disclosed|announced|described)|"
    r"previously\s+(?:reported|disclosed|announced)|as\s+reported\s+in")


def _parse_dates(sentence: str) -> List[date]:
    out = []
    for m in DATE_RE.finditer(sentence):
        try:
            out.append(datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%B %d %Y").date())
        except ValueError:
            pass
    return out


def is_new(sentence: str, filing_date: str) -> bool:
    """True if the sentence reports something that happened close to the filing date."""
    try:
        fd = datetime.strptime(filing_date, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return not BACKGROUND_RE.search(sentence)
    ds = _parse_dates(sentence)
    if not ds:
        return not BACKGROUND_RE.search(sentence)
    deltas = [(fd - d).days for d in ds]            # days between the event date and the filing
    if any(-3 <= x <= 14 for x in deltas):
        return True
    if all(x > 14 for x in deltas):
        return False                                 # only old dates: a recap
    return not BACKGROUND_RE.search(sentence)        # future-dated (deadlines/effective dates) or mixed


# ----------------------------------------------------------------------------- 1.03
_PETITION = re.compile(
    r"(?i)(?:\b(?:filed|commenced|initiated)\b(?!\s+against)[^.]{0,200}?"
    r"(?:voluntary\s+petitions?|petitions?\s+(?:for|seeking|under|with)|chapter\s+(?:7|9|11|12|15)\b|"
    r"bankruptcy\s+(?:petition|case|protection))|involuntary\s+(?:bankruptcy\s+)?petition|"
    r"petition\s+(?:for\s+relief\s+)?was\s+filed\s+against)")
_MOTION = re.compile(r"(?i)\bmotions?\b")
# Restructuring-support-agreement milestones and other forward-looking wording ("no later than ... commence the
# Chapter 11 Cases", "the Plan will become effective") describe steps still to come, not events this filing reports.
_FUTURE_103 = re.compile(
    r"(?i)milestone|no\s+later\s+than|\bshall\b|\bmust\b|(?:is|are)\s+expected|expected\s+to|\bexpects?\b|"
    r"will\s+(?:be|serve|seek|file|commence|continue|become|take)|intends?\s+to|plans?\s+to|agreed\s+to|"
    r"subject\s+to|required\s+to|\bif\s+the\b|conditions?\s+to")
_RECEIVER = re.compile(r"(?i)\breceiver(?:ship)?\b|assignment\s+for\s+the\s+benefit\s+of\s+(?:its\s+)?creditors")
_PLAN = re.compile(
    r"(?i)(?:order\s+confirming|confirmation\s+order|confirmed\s+(?:the|its|their)\b|\bplan\b[^.]{0,80}"
    r"(?:was|has\s+been|were)\s+confirmed|\bplan\b[^.]{0,120}(?:became|declared|went)\s+effective|"
    r"emerge[ds]?\s+from\s+(?:chapter|bankruptcy)|effective\s+date\s+of\s+the\s+plan|"
    r"effective\s+date[^.]{0,40}(?:occurred|has\s+occurred)|consummat\w+\s+(?:of\s+)?the\s+plan)")
_CONV = re.compile(
    r"(?i)conver(?:t|sion)\w*[^.]{0,100}chapter\s*(?:7|11)|\bcases?\b[^.]{0,80}\b(?:dismissed|closed)\b|"
    r"(?:order|motion)[^.]{0,60}dismiss\w+[^.]{0,60}(?:case|chapter)|dismissal\s+of[^.]{0,60}(?:case|chapter)")

_CHAPTER = re.compile(r"(?i)chapter\s+(7|9|11|12|13|15)\b")
_COURT = re.compile(
    r"(?i)bankruptcy\s+court\s+for\s+the\s+((?:Northern|Southern|Eastern|Western|Central|Middle)?\s*District\s+of\s+"
    r"[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)")
_CASE_NO = re.compile(r"(?i)case\s+no\.?\s*([0-9]{1,2}-[0-9]{3,6}[^\s,.);]*)")


def rules_103(sentences: List[str], filing_date: str) -> Dict[str, Optional[str]]:
    """label -> first matching NEW sentence (None if the label does not fire)."""
    ev: Dict[str, Optional[str]] = {l: None for l in ITEM_CFG["1.03"]["labels"]}
    for s in sentences:
        if _BOILERPLATE_RE.search(s) or not is_new(s, filing_date):
            continue
        fut = bool(_FUTURE_103.search(s))
        if ev["PETITION_FILED"] is None and not fut and _PETITION.search(s) and (not _MOTION.search(s) or re.search(r"(?i)petition", s)):
            ev["PETITION_FILED"] = s
        if ev["RECEIVERSHIP"] is None and _RECEIVER.search(s):
            ev["RECEIVERSHIP"] = s
        if ev["PLAN_CONFIRMED"] is None and not fut and _PLAN.search(s):
            ev["PLAN_CONFIRMED"] = s
        if ev["CONVERTED_DISMISSED"] is None and not fut and _CONV.search(s):
            ev["CONVERTED_DISMISSED"] = s
    return ev


def fields_103(sentences: List[str], evidence: Dict[str, Optional[str]]) -> Dict[str, Optional[str]]:
    text = " ".join(sentences)
    chap = _CHAPTER.search(evidence.get("PETITION_FILED") or "") or _CHAPTER.search(text)
    court = _COURT.search(text)
    case = _CASE_NO.search(text)
    pet = evidence.get("PETITION_FILED")
    pdate = _parse_dates(pet)[0].isoformat() if pet and _parse_dates(pet) else None
    return {"chapter": chap.group(1) if chap else None, "court": court.group(1).strip() if court else None,
            "case_number": case.group(1) if case else None, "petition_date": pdate}


# ----------------------------------------------------------------------------- 3.01
_NONCOMPLIANCE = re.compile(
    r"(?i)not\s+in\s+compliance|non-?compliance|no\s+longer\s+in\s+compliance|fail(?:ed|s|ure)?\s+to\s+(?:meet|comply|satisfy|maintain|"
    r"timely\s+file)|(?:fallen|fell|closed|traded)\s+below|deficien|does\s+not\s+(?:currently\s+)?(?:meet|satisfy|comply)|"
    r"did\s+not\s+(?:meet|satisfy|comply)|below\s+the\s+minimum|has\s+not\s+(?:regained|maintained|met)|delinquent|violat")
_NOTICE = re.compile(r"(?i)\b(?:notice|letter|notification|notified|informed|advised)\b")
_DELIST_EX = re.compile(
    r"(?i)determin\w+\s+to\s+delist|decision\s+to\s+delist|(?:will|would|is|are)\s+(?:be\s+)?(?:subject\s+to\s+)?delist\w*|"
    r"subject\s+to\s+delisting|suspend\w*\s+(?:the\s+)?trading|delisting\s+determination|form\s+25-?nse|"
    r"trading\s+(?:will\s+be|was|has\s+been)\s+suspended|panel[^.]{0,80}delist|delist\w*\s+(?:the|its)\s+(?:common|securities|shares|stock)")
_DELIST_VOL = re.compile(
    r"(?i)(?:notified|requested|informed|asked)\s+(?:that\s+)?(?:the\s+)?(?:nasdaq|nyse|new\s+york|exchange|"
    r"[A-Z][\w.]*\s+stock)[^.]{0,200}(?:suspend|withdraw|delist|form\s+25|halt)|"
    r"requested\s+that\s+(?:the\s+)?(?:nasdaq|nyse|new\s+york|exchange|[^.]{0,40}market)[^.]{0,200}(?:suspend|withdraw|delist|"
    r"halt|remove)|voluntar\w+\s+(?:delist|withdraw)|(?:intends?|plans?|expects?|determined|decided)\s+to\s+(?:voluntarily\s+)?delist|"
    r"voluntary\s+delisting|(?:company|we|it)\s+(?:intends?|plans?|expects?)\s+to\s+(?:file|submit)[^.]{0,60}form\s+(?:25|15)")
_TRANSFER = re.compile(
    r"(?i)transfer\w*[^.]{0,80}(?:listing|listed|nasdaq|nyse|market|tier|exchange)|"
    r"(?:move|moving|moved)\s+(?:its\s+)?(?:listing|common\s+stock|securities)[^.]{0,60}(?:to|from)|"
    r"(?:approved|approval)[^.]{0,60}transfer|listing\s+(?:will\s+)?transfer")
_REGAINED = re.compile(
    r"(?i)(?:\bhas|\bhad|\bhave)\s+(?:now\s+|since\s+|fully\s+)?regained|(?:notif\w+|informed|advised|determined)[^.]{0,80}"
    r"regained\s+compliance|returned\s+to\s+compliance|evidenced\s+compliance|(?:is|was)\s+(?:now\s+|again\s+)?(?:back\s+)?in\s+"
    r"compliance|matter\s+(?:is|was)\s+(?:now\s+)?closed|cured\s+the\s+deficiency|deficienc\w+\s+(?:has|have)\s+been\s+cured|"
    r"is\s+(?:now\s+)?compliant")

_EXCHANGE = re.compile(
    r"(?i)(nasdaq\s+(?:global\s+select|global|capital)\s+market|nasdaq\s+stock\s+market|nasdaq|nyse\s+american|nyse\s+arca|"
    r"nyse\s+chicago|new\s+york\s+stock\s+exchange|nyse|cboe|otc\s+markets|otcqb|otcqx)")
_RULE = re.compile(
    r"(?i)(?:listing\s+)?(?:rule|rules|section|sections)\s+(\d{3,4}(?:\.\d{2}[A-Z]?)?(?:\([a-z0-9]+\))*|IM-\d{4}-\d)")
_CURE_DATE = re.compile(
    rf"(?i)(?:until|by|through|on\s+or\s+before|prior\s+to)\s+({_MONTHS}\s+\d{{1,2}},?\s+\d{{4}})")
_GRACE = re.compile(r"(?i)(\d{2,3})\s+(?:calendar\s+|business\s+)?days")

DEFICIENCY_CATEGORIES = [
    ("BID_PRICE", re.compile(r"(?i)bid\s+price|5550\(a\)\(2\)|5450\(a\)\(1\)|5810\(c\)\(3\)\(A\)\(iii\)|802\.01C|\$1\.00")),
    ("MARKET_VALUE", re.compile(r"(?i)market\s+value|market\s+capitaliz|5550\(b\)\(2\)|5450\(b\)\(2\)|802\.01B")),
    ("EQUITY", re.compile(r"(?i)stockholders.{0,3}\s+equity|shareholders.{0,3}\s+equity|5550\(b\)\(1\)|5810\(c\)\(3\)\(B\)")),
    ("LATE_FILING", re.compile(r"(?i)form\s+10-?[kq]|periodic\s+report|5250\(c\)\(1\)|802\.01E|timely\s+fil|delinquen|annual\s+report")),
    ("BOARD_INDEPENDENCE", re.compile(r"(?i)audit\s+committee|independent\s+director|board\s+of\s+directors[^.]{0,40}independen|5605|5640|303A")),
    ("ANNUAL_MEETING", re.compile(r"(?i)annual\s+meeting|5620\(a\)|annual\s+shareholder")),
    ("PUBLIC_FLOAT", re.compile(r"(?i)publicly\s+held\s+shares|public\s+float|round\s+lot|5550\(a\)\(3\)|5550\(a\)\(4\)|holders")),
]


# Conditional / forward-looking wording ("if the Company does not regain compliance ... Nasdaq will provide
# notice that its securities are subject to delisting", "may be eligible to transfer") describes a possible
# future step, not an event this filing reports.
_HYPO = re.compile(
    r"(?i)\bif\b|in\s+the\s+event|unless|may\s+be\s+eligible|\bmay\b|\bwould\b|\bcould\b|\bshould\b|"
    r"will\s+(?:then\s+)?(?:provide|receive|notify|be\s+(?:notified|required))|expects?\s+(?:that\s+)?(?:nasdaq|nyse)|"
    r"eligible\s+(?:to|for)|can\s+regain|is\s+required\s+to|must\b")


def _sentence_new(s: str, fd: str) -> bool:
    return not _BOILERPLATE_RE.search(s) and is_new(s, fd)


def rules_301(sentences: List[str], filing_date: str) -> Dict[str, Optional[str]]:
    ev: Dict[str, Optional[str]] = {l: None for l in ITEM_CFG["3.01"]["labels"]}
    for s in sentences:
        if not _sentence_new(s, filing_date):
            continue
        if ev["COMPLIANCE_REGAINED"] is None and _REGAINED.search(s):
            ev["COMPLIANCE_REGAINED"] = s
            continue  # a 'regained compliance' sentence is not also a deficiency notice
        hypo = bool(_HYPO.search(s))
        hypo_def = ev["DEFICIENCY_NOTICE"] is not None and bool(_HYPO.search(ev["DEFICIENCY_NOTICE"]))
        if (ev["DEFICIENCY_NOTICE"] is None or (hypo_def and not hypo)) and _NONCOMPLIANCE.search(s) and (
                _NOTICE.search(s) or _EXCHANGE.search(s) or re.search(r"(?i)listing", s)):
            ev["DEFICIENCY_NOTICE"] = s
        # a staff delisting-determination letter is both a deficiency notice and a delisting determination
        if ev["DELISTING_EXCHANGE"] is None and not hypo and _DELIST_EX.search(s) and not _DELIST_VOL.search(s):
            ev["DELISTING_EXCHANGE"] = s
        if ev["DELISTING_VOLUNTARY"] is None and _DELIST_VOL.search(s):
            ev["DELISTING_VOLUNTARY"] = s
            if ev["DELISTING_EXCHANGE"] == s:
                ev["DELISTING_EXCHANGE"] = None
        if ev["TRANSFER"] is None and not hypo and _TRANSFER.search(s) and _EXCHANGE.search(s):
            ev["TRANSFER"] = s
    if ev["DELISTING_EXCHANGE"] and ev["DEFICIENCY_NOTICE"] is None and _NOTICE.search(ev["DELISTING_EXCHANGE"]):
        ev["DEFICIENCY_NOTICE"] = ev["DELISTING_EXCHANGE"]  # staff delisting-determination letter
    return ev


def fields_301(sentences: List[str], evidence: Dict[str, Optional[str]]) -> Dict[str, object]:
    text = " ".join(sentences)
    key = evidence.get("DEFICIENCY_NOTICE") or evidence.get("DELISTING_EXCHANGE") or text
    ex = _EXCHANGE.search(key) or _EXCHANGE.search(text)
    rules = []
    for m in _RULE.finditer(text):
        r = m.group(1)
        if r not in rules:
            rules.append(r)
    cats = [name for name, rx in DEFICIENCY_CATEGORIES if rx.search(key)] if evidence.get("DEFICIENCY_NOTICE") else []
    cure = None
    for s in sentences:
        if re.search(r"(?i)regain|cure|compliance\s+plan|grace|extension", s):
            m = _CURE_DATE.search(s)
            if m:
                cure = m.group(1)
                break
    g = _GRACE.search(key)
    return {"exchange": ex.group(1) if ex else None, "rules_cited": rules[:4], "deficiency_categories": cats,
            "cure_deadline": cure, "grace_days": int(g.group(1)) if g else None}


# ----------------------------------------------------------------------------- 5.02 (CFO / interim CFO)
_CFO_T = r"(?i:(?:interim\s+|acting\s+)?(?:the\s+)?(?:(?:[A-Za-z][a-zA-Z]*(?:'|\u2019)s|our)\s+)?(?:Chief\s+Financial\s+Officer|CFO|Principal\s+Financial\s+Officer|Chief\s+Financial\s+and\s+\w+(?:\s+\w+)?\s+Officer))"
_CFO_RE = re.compile(CFO_TITLE_PATTERN, re.I)
_APPOINT_VERB = (r"(?:appoint\w*|nam(?:e|ed|es|ing)\s+(?!executive\b|officer|named)|elect(?:ed|s|ing)?\b|promot\w*|designat\w*|hire[ds]?\b|hiring|select\w*|"
                 r"will\s+(?:serve|join|become)|to\s+serve\s+as|has\s+joined|joins\s+(?:the|as)|assum\w+\s+the\s+(?:role|position|title|duties)\s+of|succe(?:ed|eds|eding)\b|replac\w+)")
# verb BEFORE the title: 'appointed X as Chief Financial Officer'. A title that merely follows a name in a list, or a
# CFO who 'will assume the responsibilities of principal accounting officer', is not an appointment as CFO.
_STRONG_APPOINT = re.compile(rf"(?i){_APPOINT_VERB}[^;]{{0,140}}?{CFO_TITLE_PATTERN}")
_COMP_CONTEXT = re.compile(
    r"(?i)named\s+executive\s+officers?|target\s+award|base\s+salary|annualized|stock\s+options?|restricted\s+stock|"
    r"performance\s+(?:share|unit|award)|incentive\s+(?:plan|award|bonus)|retention\s+award|equity\s+award|grant(?:ed)?\s+date|"
    r"vesting|bonus\s+(?:plan|opportunity)|compensation\s+committee\s+(?:approved|granted|established)|\$\s?\d[\d,]{3,}")
_RESIGN_V = re.compile(
    r"(?i)\b(?:resign\w*|retire\w*|step(?:s|ped|ping)?\s+down|depart\w*|terminat\w*|leav(?:e|es|ing)\b|"
    r"no\s+longer\s+(?:serve|be|hold)|ceas\w+\s+to\s+(?:serve|be|act)|separat\w*|transition\w*\s+(?:out|away|from)|"
    r"remov\w+|relieved|will\s+not\s+(?:stand|continue|seek)|cease\w*\s+(?:serving|to\s+be))")
_CFO_BIO = re.compile(
    r"(?i)(?:\b(?:has|had|have)\s+served|\bserved\s+as|\bserving\s+as|\bpreviously\b|\bformerly\b|\bprior\s+to\b|"
    r"\bfrom\s+(?:[A-Z][a-z]+\s+)?\d{4}\s+(?:to|until|through)|\bsince\s+(?:[A-Z][a-z]+\s+)?\d{4}|"
    r"\bworked\s+(?:at|for|as)|\bholds?\s+(?:a|the)\s+degree|\bearlier\s+in\s+(?:his|her)\s+career)")
_CFO_OTHER_CO = re.compile(r"(?i)(?:chief\s+financial\s+officer|cfo)\s+(?:of|at|for)\s+(?!the\s+company\b|the\s+corporation\b|the\s+registrant\b|the\s+bank\b)[A-Z]")
_CFO_CONTINUE = re.compile(r"(?i)will\s+continue\s+(?:to\s+)?serv|continues?\s+to\s+serve|will\s+remain|remains?\b|retain\w*|stay(?:s|ing)?\s+on")
_CFO_SEARCH = re.compile(r"(?i)search\s+(?:for|firm)|seeking\s+a|identify\s+a\s+(?:new|successor|permanent)|conduct\w*\s+a\s+search|will\s+commence\s+a\s+search")


def _cfo_sentence_kind(s: str):
    """(appointed?, resigned?) for one CFO-mentioning sentence."""
    if not _CFO_RE.search(s):
        return False, False
    appoint = bool(_STRONG_APPOINT.search(s))
    resign = bool(_RESIGN_V.search(s)) and bool(re.search(rf"(?i)(?:{CFO_TITLE_PATTERN}[^;]{{0,160}}?{_RESIGN_V.pattern[4:]}|{_RESIGN_V.pattern[4:]}[^;]{{0,160}}?{CFO_TITLE_PATTERN})", s))
    if _COMP_CONTEXT.search(s):
        appoint = appoint and bool(re.search(r"(?i)\b(?:appoint\w*|promot\w*|designat\w*|elected|hired|will\s+(?:serve|join))\b[^;]{0,100}?" + CFO_TITLE_PATTERN, s))
        resign = False
    if _CFO_OTHER_CO.search(s) and not re.search(r"(?i)chief\s+financial\s+officer\s+of\s+the\s+company|\bour\s+(?:chief\s+financial|cfo)", s):
        # 'CFO of Acme Corp' is a biography detail unless the sentence also names this company's own CFO role
        appoint = appoint and bool(re.search(_CFO_T + r"\s*(?:,|\.|of\s+the\s+company|effective|beginning|starting|on\s+)", s))
    if _CFO_BIO.search(s):
        # a bio sentence reads 'served as CFO of X since 2019'; only a strong verb keeps it an event
        appoint = appoint and bool(re.search(r"(?i)\b(?:appoint\w*|nam(?:e|ed)\b|elect\w*|promot\w*|designat\w*|will\s+(?:serve|join))", s))
        resign = resign and bool(re.search(r"(?i)\b(?:resign\w*|step(?:s|ped)?\s+down|retire\w*|terminat\w*|will\s+(?:leave|depart)|notified)", s))
    if _CFO_CONTINUE.search(s):
        resign = False
    if _CFO_SEARCH.search(s) and not re.search(r"(?i)appoint\w*\s+[A-Z][a-z]+\s+[A-Z]", s):
        appoint = False
    return appoint, resign


def rules_502(sentences: List[str], filing_date: str) -> Dict[str, Optional[str]]:
    ev: Dict[str, Optional[str]] = {"CFO_APPOINTED": None, "CFO_RESIGNED": None}
    for s in sentences:
        if _BOILERPLATE_RE.search(s) or not is_new(s, filing_date):
            continue
        a, r = _cfo_sentence_kind(s)
        if a and ev["CFO_APPOINTED"] is None:
            ev["CFO_APPOINTED"] = s
        if r and ev["CFO_RESIGNED"] is None:
            ev["CFO_RESIGNED"] = s
    return ev


def _cfo_names(sentence: Optional[str], kind: str, T: Optional[str] = None) -> Optional[str]:
    if not sentence:
        return None
    from ..item502 import NAME_RE, _ASIDE, _clean_name
    _CFO_T_ = T or _CFO_T
    if kind == "appointed":
        pats = [
            rf"(?i:appoint\w*|nam(?:e|ed|es)|elect\w*|promot\w*|designat\w*|hire[ds]?|select\w*)\s+(?:.{{0,40}}?\b)?{NAME_RE}\s*{_ASIDE}\s+(?i:(?:to\s+serve\s+|to\s+act\s+)?as|to\s+the\s+positions?\s+of|,)\s*{_CFO_T_}",
            rf"{NAME_RE}\s*{_ASIDE}\s+(?i:will\s+serve|shall\s+serve|has\s+been\s+appointed|was\s+appointed|has\s+been\s+named|was\s+named|will\s+join|joins)\s+(?i:as)?\s*(?:the\s+)?{_CFO_T_}",
            rf"{_CFO_T_}\s+{NAME_RE}\s+(?i:was|has\s+been|will\s+be)\s+(?i:appointed|named)",
            rf"(?i:appoint\w*|nam(?:e|ed))\s+(?:.{{0,40}}?\b)?{NAME_RE}\s*,\s*(?:\d{{1,3}}\s*,\s*)?{_CFO_T_}",
        ]
    else:
        pats = [
            rf"{NAME_RE}\s*{_ASIDE}\s+(?:(?:also|then|has)\s+)?(?i:resigned|stepped\s+down|will\s+resign|will\s+step\s+down|retired|will\s+retire|notified[^.]{{0,60}}resign\w*|is\s+leaving|will\s+leave|departed|was\s+terminated)\s+(?i:as|from)",
            rf"(?i:resignation|retirement|departure)\s+of\s+{NAME_RE}\s*{_ASIDE}\s+(?i:as)\s+{_CFO_T_}",
            rf"{NAME_RE}(?:'s|\u2019s)\s+(?i:resignation|retirement|departure)\s+(?i:as)\s+{_CFO_T_}",
            rf"{_CFO_T_}\s+{NAME_RE}\s+(?i:has\s+)?(?i:resigned|retired|departed|stepped\s+down)",
        ]
    for pat in pats:
        for m in re.finditer(pat, sentence):
            name = _clean_name(m.group(1))
            if name:
                return name
    return None


def fields_502(sentences: List[str], evidence: Dict[str, Optional[str]]) -> Dict[str, object]:
    out: Dict[str, object] = {}
    for lab, kind, key in (("CFO_APPOINTED", "appointed", "appointed"), ("CFO_RESIGNED", "resigned", "resigned")):
        ev = evidence.get(lab)
        out[f"{key}_name"] = _cfo_names(ev, kind)
        out[f"{key}_interim"] = bool(ev and re.search(r"(?i)\b(?:interim|acting)\b", ev))
        m = re.search(rf"(?i)effective[^.]{{0,40}}?({_MONTHS}\s+\d{{1,2}},?\s+\d{{4}})", ev or "")
        out[f"{key}_effective"] = m.group(1) if m else None
    return out


# ----------------------------------------------------------------------------- 5.02ceo (CEO / interim CEO)
_REPORT_TO = re.compile(r"(?i)\b(?:report\w*|reports)\s+(?:directly\s+)?to\s+(?:the\s+)?(?:company.{0,3}s\s+)?(?:\w+\s+){0,3}?(?:chief\s+executive\s+officer|ceo)")


class _Role:
    """Sentence-level appointed/resigned detector for one executive role (same logic as the CFO block above)."""

    def __init__(self, title_pat, full, abbr, t_name_re, labels):
        self.re = re.compile(title_pat, re.I)
        self.title_pat = title_pat
        self.labels = labels
        self.T = t_name_re
        self.strong = re.compile(rf"(?i){_APPOINT_VERB}[^;]{{0,140}}?{title_pat}")
        rv = _RESIGN_V.pattern[4:]
        self.resign_prox = re.compile(rf"(?i)(?:{title_pat}[^;]{{0,160}}?{rv}|{rv}[^;]{{0,160}}?{title_pat})")
        self.other_co = re.compile(rf"(?i)(?:{full}|{abbr})\s+(?:of|at|for)\s+(?!the\s+company\b|the\s+corporation\b|the\s+registrant\b|the\s+bank\b)[A-Z]")
        self.own = re.compile(rf"(?i){full}\s+of\s+the\s+company|\bour\s+(?:{full}|{abbr})")
        self.search = re.compile(rf"(?i)search\s+(?:for|firm)|seeking\s+a|identify\s+a\s+(?:new|successor|permanent)|conduct\w*\s+a\s+search|will\s+commence\s+a\s+search")

    def kind(self, s):
        s = _REPORT_TO.sub("", s)                      # "... reporting to the CEO" mentions the CEO without appointing one
        if not self.re.search(s):
            return False, False
        appoint = bool(self.strong.search(s))
        resign = bool(_RESIGN_V.search(s)) and bool(self.resign_prox.search(s))
        if _COMP_CONTEXT.search(s):
            appoint = appoint and bool(re.search(r"(?i)\b(?:appoint\w*|promot\w*|designat\w*|elected|hired|will\s+(?:serve|join))\b[^;]{0,100}?" + self.title_pat, s))
            resign = False
        if self.other_co.search(s) and not self.own.search(s):
            appoint = appoint and bool(re.search(self.T + r"\s*(?:,|\.|of\s+the\s+company|effective|beginning|starting|on\s+)", s))
        if _CFO_BIO.search(s):
            appoint = appoint and bool(re.search(r"(?i)\b(?:appoint\w*|nam(?:e|ed)\b|elect\w*|promot\w*|designat\w*|will\s+(?:serve|join))", s))
            resign = resign and bool(re.search(r"(?i)\b(?:resign\w*|step(?:s|ped)?\s+down|retire\w*|terminat\w*|will\s+(?:leave|depart)|notified)", s))
        if _CFO_CONTINUE.search(s):
            resign = False
        if self.search.search(s) and not re.search(r"(?i)appoint\w*\s+[A-Z][a-z]+\s+[A-Z]", s):
            appoint = False
        return appoint, resign

    def evidence(self, sentences, filing_date):
        ev = {self.labels[0]: None, self.labels[1]: None}
        for s in sentences:
            if _BOILERPLATE_RE.search(s) or not is_new(s, filing_date):
                continue
            a, r = self.kind(s)
            if a and ev[self.labels[0]] is None:
                ev[self.labels[0]] = s
            if r and ev[self.labels[1]] is None:
                ev[self.labels[1]] = s
        return ev

    def fields(self, evidence):
        out = {}
        for lab, kind in ((self.labels[0], "appointed"), (self.labels[1], "resigned")):
            sent = evidence.get(lab)
            out[f"{kind}_name"] = _cfo_names(sent, kind, self.T)
            out[f"{kind}_interim"] = bool(sent and re.search(r"(?i)\b(?:interim|acting)\b", sent))
            m = re.search(rf"(?i)effective[^.]{{0,40}}?({_MONTHS}\s+\d{{1,2}},?\s+\d{{4}})", sent or "")
            out[f"{kind}_effective"] = m.group(1) if m else None
        return out


_CEO_T = r"(?i:(?:interim\s+|acting\s+)?(?:the\s+)?(?:(?:[A-Za-z][a-zA-Z]*(?:'|\u2019)s|our)\s+)?(?:(?:President\s+and\s+)?Chief\s+Executive\s+Officer|CEO|Principal\s+Executive\s+Officer))"
ROLES = {"5.02ceo": _Role(CEO_TITLE_PATTERN, r"chief\s+executive\s+officer", r"ceo", _CEO_T, ["CEO_APPOINTED", "CEO_RESIGNED"])}


# ----------------------------------------------------------------------------- entry point
def analyze(item: str, section: Optional[str], body_kw: str, filing_date: str) -> dict:
    """Rule labels + evidence + fields for one harvested row."""
    sents = [s for s in _sentences(section or "", item)]
    if not any(ITEM_CFG[item]["kw"].search(s) for s in sents):  # stub section: fall back to the filing's keyword sentences
        sents += _sentences(body_kw or "", item)
    if item == "1.03":
        ev = rules_103(sents, filing_date)
        flds = fields_103(sents, ev)
    elif item == "5.02":
        sents = [x for x in sents if _CFO_RE.search(x)]   # CFO task: only CFO-title sentences matter
        ev = rules_502(sents, filing_date)
        flds = fields_502(sents, ev)
    elif item in ROLES:
        role = ROLES[item]
        sents = [x for x in sents if role.re.search(x)]
        ev = role.evidence(sents, filing_date)
        flds = role.fields(ev)
    else:
        ev = rules_301(sents, filing_date)
        flds = fields_301(sents, ev)
    return {"labels": [l for l in ITEM_CFG[item]["labels"] if ev[l]], "evidence": {l: s for l, s in ev.items() if s},
            "fields": flds}
