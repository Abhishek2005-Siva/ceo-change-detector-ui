"""Finds the person named in an appointment / departure sentence.

The existing pattern matcher (item502.regex_extract_ceo_event) only fires on a few fixed phrasings, so many real
events came back without a name. This module is the fallback: find capitalised name-like phrases, drop anything that
looks like a title, company or date, then pick the one tied to the right verb (appointed vs left). If a sentence only
gives a surname ("Mr. Janik"), the full name is looked up elsewhere in the filing.
"""
import re
from typing import List, Optional, Sequence, Tuple

_WORD = r"[A-Z][A-Za-z'’\-]+"
_INITIAL = r"[A-Z](?:\.|\b)"
_PERSON = re.compile(
    rf"(?P<hon>(?:Mr|Ms|Mrs|Miss|Dr)\.\s+)?(?P<name>(?:{_WORD}|[A-Z]\.)(?:\s+(?:{_INITIAL}|{_WORD})){{0,3}})(?P<suffix>,?\s+(?:Jr|Sr|II|III|IV)\.?)?"
)

_STOP = {w.lower() for w in """
the a an and or of to for on in at by as with from this that these those his her their its our
company board directors director committee chief executive financial operating accounting technology information legal
officer officers president vice senior executive interim acting principal general chairman chairwoman chair lead independent
treasurer secretary controller counsel partner managing head global regional deputy assistant
inc incorporated corp corporation co llc llp lp ltd limited plc holdings group trust bank bancorp partners therapeutics pharmaceuticals
january february march april may june july august september october november december
monday tuesday wednesday thursday friday saturday sunday
item form exhibit agreement section article plan stock award employment letter transition separation consulting
securities exchange commission nasdaq nyse sec effective immediately previously reported pursuant following
mr ms mrs miss dr he she they it we also further additionally however accordingly
cfo ceo coo cto cio cao pfo pao
united states america american new york
authority agency federal energy mac valley resources biopharma housing finance conservator services systems industries international technologies
pharma bio sciences capital lp associates enterprises ventures realty properties communications networks
companies brands stores markets insurance airlines restaurants entertainment media foods labs laboratories health medical software semiconductor logistics solutions
""".split()}

_APPOINT = re.compile(r"(?i)\b(?:appoint\w*|nam(?:e|ed|es|ing)|elect\w*|promot\w*|hir\w*|select\w*|designat\w*|engag\w*|retain\w*|succe\w+|join\w*|become|becomes|will\s+serve|to\s+serve|as\s+the\s+(?:company.s\s+)?(?:new|next)?)")
_LEAVE = re.compile(r"(?i)\b(?:resign\w*|retire\w*|step(?:s|ped|ping)?\s+down|depart\w*|terminat\w*|no\s+longer\s+serve|cease\w*|leav\w*|stepp?ing\s+down|separat\w*|replac\w*|succeed(?:ed|s|ing)?|dismiss\w*|remov\w*)")
_OUTGOING_AFTER = re.compile(r"(?i)(?:succeed(?:s|ed|ing)?|replac(?:e|es|ed|ing)|take\s+over\s+from|in\s+place\s+of|following\s+the\s+(?:resignation|departure|retirement)\s+of|resignation\s+of|departure\s+of|retirement\s+of)\s*$")


def _candidates(sentence: str) -> List[Tuple[int, int, str, str]]:
    """[(start, end, display name, surname-only-honorific or '')] for plausible person names."""
    out = []
    for m in _PERSON.finditer(sentence):
        name = m.group("name").strip()
        hon = (m.group("hon") or "").strip()
        words = name.split()
        low = [w.lower().strip(".,") for w in words]
        # trim leading/trailing stop words ("Company's" -> handled by apostrophe in word)
        while words and low[0] in _STOP:
            words, low = words[1:], low[1:]
        while words and low[-1] in _STOP:
            words, low = words[:-1], low[:-1]
        if not words:
            continue
        # possessive words are not part of a name ("Company's")
        words = [w[:-2] if w.endswith(("'s", "’s")) else w for w in words]
        if any(w.lower().strip(".,") in _STOP for w in words):
            continue
        real = [w for w in words if not re.fullmatch(r"[A-Z]\.?", w)]
        if re.match(r"\s*,?\s*(?:Inc|Corp|Corporation|LLC|Ltd|L\.P|LP|Co|PLC|N\.A)\b", sentence[m.end():m.end() + 14]):
            continue  # "Albertsons Companies, Inc." is a company, not a person
        if len(words) >= 2 and len(real) >= 2:
            suffix = (m.group("suffix") or "").strip(" ,")
            display = " ".join(words) + (f", {suffix}" if suffix else "")
            out.append((m.start(), m.end(), display, ""))
        elif hon and len(real) == 1:
            out.append((m.start(), m.end(), f"{hon} {words[0]}", words[0]))  # surname only, e.g. "Mr. Janik"
    return out


def resolve_surname(surname: str, text: str) -> Optional[str]:
    """Looks through `text` for a fuller version of a surname ('Janik' -> 'James L. Janik')."""
    best = None
    for m in re.finditer(rf"((?:{_WORD}\s+)(?:{_INITIAL}\s+)?(?:{_WORD}\s+)?){re.escape(surname)}\b", text):
        cand = (m.group(1) + surname).strip()
        words = cand.split()
        if any(w.lower().strip(".,") in _STOP for w in words[:-1]):
            continue
        if best is None or len(cand) > len(best):
            best = cand
    return best


def pick_name(sentence: str, kind: str, context: str = "") -> Optional[str]:
    """kind is 'appointed' or 'resigned'. Returns the person the sentence is about, or None."""
    cands = _candidates(sentence)
    if not cands:
        return None

    def score(c: Tuple[int, int, str, str]) -> int:
        start, end, _, _ = c
        before = sentence[max(0, start - 70):start]
        after = sentence[end:end + 90]
        outgoing = bool(_OUTGOING_AFTER.search(before)) or bool(re.search(r"(?i)\b(?:succeed|replace)\w*\s+(?:\w+\s+){0,2}$", before))
        s = 0
        if kind == "appointed":
            if outgoing:
                return -5
            if _APPOINT.search(before[-45:]):
                s += 3
            if re.match(r"(?i)\s*(?:,[^,]{0,120},)?\s*(?:has\s+been|was|will\s+be|is\s+to\s+be|will\s+serve|shall\s+serve|will\s+become|has\s+agreed|succeed(?:ed|s)|has\s+succeeded|joined|joins|assumed|assumes)", after):
                s += 3
            if re.match(r"(?i)\s*(?:,[^,]{0,120},)?\s*(?:as|to\s+(?:serve|the\s+position))\b", after):
                s += 2
            if _LEAVE.search(after[:60]) and not _APPOINT.search(after[:60]):
                s -= 3
        else:
            if outgoing:
                s += 3
            if re.match(r"(?i)\s*(?:,[^,]{0,140},)?\s*(?:has\s+|have\s+|will\s+|shall\s+|also\s+|then\s+|had\s+|is\s+|are\s+)?(?:resign\w*|retir\w*|step\w*\s+down|depart\w*|terminat\w*|no\s+longer|ceas\w*|announced\s+(?:his|her|their)\s+(?:decision|intention)|notif\w+|inform\w+|advis\w+|tendered|submitted|delivered|(?:provided|gave)\s+(?:\w+\s+){0,3}(?:letter|notice)|was\s+terminated|leaving|will\s+leave|mutually\s+agreed|agreed\s+(?:that|to))", after):
                s += 4
            if re.search(r"(?i)(?:resignation|departure|retirement|termination)\s+of\s*$", before):
                s += 3
            if re.search(r"(?i)(?:notified|informed|advised)\s+(?:by|that)\s*$", before):
                s += 3
            # "the executive transition of Tony Zook, the current CEO, to the role of Executive Chairman": the person moving out of the job
            if re.search(r"(?i)(?:transition|move|change)\s+of\s*$", before):
                s += 3
            if re.match(r"(?i)\s*(?:,[^,]{0,160},)?\s*(?:will\s+|is\s+to\s+|shall\s+)?(?:to\s+(?:the\s+)?(?:role|position)\s+of\s+(?:executive\s+|non-executive\s+)?(?:chair|vice)|to\s+(?:executive\s+|non-executive\s+)?(?:chair|vice)|transition\w*\s+(?:from|to)|mov\w+\s+(?:from|to|into))", after):
                s += 4
            if _APPOINT.search(before[-45:]) and not outgoing:
                s -= 2
        return s

    ranked = sorted(cands, key=lambda c: (-score(c), c[0]))
    top = ranked[0]
    if kind != "appointed" and score(top) < 0:
        # the wording points the other way: the person being appointed is not the one leaving
        return None
    if score(top) <= 0 and len(cands) > 1:
        # nothing clearly tied to the verb: only trust it if there is a single plausible person
        return None
    name = top[2]
    if top[3]:  # surname only: try to find the full name elsewhere in the filing
        full = resolve_surname(top[3], context or "")
        if full:
            return full
    return name


def pick_name_from_sentences(sentences: Sequence[str], kind: str, context: str = "") -> Optional[str]:
    for s in sentences:
        n = pick_name(s, kind, context)
        if n and not n.lower().startswith(("mr.", "ms.", "mrs.", "dr.", "miss ")):
            return n
    for s in sentences:
        n = pick_name(s, kind, context)
        if n:
            return n
    return None
