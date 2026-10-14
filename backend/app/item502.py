"""Regex-based isolation of the Item 5.02 section and cheap name extraction.

This is the first, free optimization layer: most 8-Ks don't contain Item 5.02
at all, so a plain substring/regex scan lets us mark "item 5.02 exists = No"
for the majority of filings without spending a single embedding or LLM call.
When it does exist, we isolate just that section (not the whole filing) so
every downstream step (embeddings, LLM fallback) only ever sees a small,
relevant slice of text.
"""
import re
from typing import List, Optional, Tuple

ITEM_HEADING_RE = re.compile(r"item\s+(\d{1,2}\.\d{2})\b", re.IGNORECASE)
SIGNATURE_RE = re.compile(r"\bSIGNATURES?\b", re.IGNORECASE)

# NOTE: none of these patterns are compiled with re.IGNORECASE. NAME_RE relies
# on `[A-Z]` to tell a real capitalized name apart from ordinary filler words
# ("of", "announced that", "Effective Date"); a blanket IGNORECASE flag would
# make `[A-Z]` match lowercase letters too and silently sweep filler words
# into the captured name (this was a real bug: "Appointment of Todd Hinders"
# was captured as the name "of Todd Hinders"). Case-insensitivity is instead
# scoped with inline (?i:...) groups around the keyword/title text only.
# Allows "the CEO", "its CEO", "the Company's CEO", "the Registrant's CEO",
# etc. right before the title — SEC filings very commonly possessive-wrap
# the title ("the Company's Chief Executive Officer") rather than using a
# bare article, and this used to be missed entirely.
_TITLE_PREFIX = r"(?:(?:the|its|his|her|their)\s+)?(?:[A-Za-z][a-zA-Z]*(?:'|’)s\s+)?"
CEO_TITLE_RE = rf"(?i:{_TITLE_PREFIX}(?:interim\s+)?(?:Chief Executive Officer|CEO|President and (?:Chief Executive Officer|CEO)))"
# A generational suffix ("Philip B. Daniele, III", "Segrave, Jr.") is joined
# to the name by a single comma with nothing after it — the *opposite* shape
# of the ", filler," aside used elsewhere in these patterns (which needs a
# closing comma). Without special-casing it, that lone comma broke the
# "optional aside" matching below and made the regex backtrack onto the
# suffix itself ("III") as if it were the whole name. Folding it into
# NAME_RE keeps suffix and name together as one captured unit instead.
_NAME_SUFFIX_RE = r"(?:,\s*(?:Jr\.?|Sr\.?|I{2,3}|IV|V))?"
NAME_RE = rf"([A-Z][a-zA-Z.'\-]+(?:\s+[A-Z][a-zA-Z.'\-]+){{0,3}}{_NAME_SUFFIX_RE})"
# "appointed X as CEO" is common, but so is "appointed X to serve as CEO" /
# "appointed X to act as CEO" / "appointed X to the position of CEO" — this
# used to only match the bare "as" form.
_AS_CONNECTOR = r"(?i:(?:to\s+serve\s+|to\s+act\s+)?as|to\s+the\s+positions?\s+of)"
# An adverb routinely sits between the name and the verb ("X also resigned",
# "X then stepped down") — this used to only match the verb immediately
# after the name.
_ADVERB_FILLER = r"(?:(?:also|then|subsequently|previously|recently)\s+)?"
# A real-name-analysis pass (comparing missed appointments against their
# actual confidence scores) found the aside between name and connector is
# often a full appositive bio ("currently Executive Vice President, Group
# President of Transportation and Logistics of the Company") that blows
# past a 60-char cap — widened to fit realistic bios without being
# unbounded (which would risk bridging across unrelated clauses).
_ASIDE = r"(?:,[^,]{0,150},)?"

APPOINT_PATTERNS = [
    re.compile(rf"(?i:appoint\w*)\s+(?:.{{0,40}}?\b)?{NAME_RE}\s*{_ASIDE}\s+{_AS_CONNECTOR}\s+{CEO_TITLE_RE}"),
    re.compile(rf"{NAME_RE}\s*{_ASIDE}\s+{_ADVERB_FILLER}(?i:will serve|shall serve|is to serve|has been appointed|shall be appointed|will be appointed|has been named|was appointed|was named|has been elected|was elected)\s+{_AS_CONNECTOR}\s+{CEO_TITLE_RE}"),
    re.compile(rf"(?i:nam\w*)\s+(?:.{{0,40}}?\b)?{NAME_RE}\s*{_ASIDE}\s+{_AS_CONNECTOR}\s+{CEO_TITLE_RE}"),
    re.compile(rf"(?i:elect\w*)\s+(?:.{{0,40}}?\b)?{NAME_RE}\s*{_ASIDE}\s+{_AS_CONNECTOR}\s+{CEO_TITLE_RE}"),
    # Title-first word order, e.g. "Chief Executive Officer John Smith was appointed..."
    re.compile(rf"{CEO_TITLE_RE}\s+{NAME_RE}\s+(?i:was|has been|will be)\s+(?i:appointed|named|elected)\b"),
    # Apposition with no connector word at all, e.g. "appointed Gregory S.
    # Foran, 64, Chief Executive Officer" or "appointed Jane Doe, President
    # and CEO". Found via direct analysis of real missed appointments — this
    # is a very common construction that "appointed X as Y" alone misses
    # entirely since there's no "as" or "to the position of" to anchor on.
    re.compile(rf"(?i:appoint\w*)\s+(?:.{{0,40}}?\b)?{NAME_RE}\s*,\s*(?:\d{{1,3}}\s*,\s*)?{CEO_TITLE_RE}"),
    # Possessive noun-phrase form, e.g. "Mr. McGibney's appointment as Chief
    # Executive Officer" / "Jane Doe's election as CEO" — describes the
    # appointment as a noun rather than "X was appointed", which the verb
    # patterns above can't match no matter the connector.
    re.compile(rf"{NAME_RE}(?:'s|’s)\s+(?i:appointment|election)\s+(?i:as)\s+{CEO_TITLE_RE}"),
]

RESIGN_PATTERNS = [
    re.compile(rf"{NAME_RE}\s*{_ASIDE}\s+{_ADVERB_FILLER}(?i:has\s+)?(?i:resigned|stepped down|will resign|shall resign|is resigning|will step down|shall step down|is stepping down|retired|will retire|shall retire)\s+(?i:as|from (?:the|his|her) position as)\s+{CEO_TITLE_RE}"),
    re.compile(rf"(?i:resignation\s+of)\s+{NAME_RE}\s*{_ASIDE}\s+(?i:as)\s+{CEO_TITLE_RE}"),
    re.compile(rf"(?i:departure\s+of)\s+{NAME_RE}\s*{_ASIDE}\s+(?i:as)\s+{CEO_TITLE_RE}"),
    re.compile(rf"{NAME_RE}\s*{_ASIDE}\s+(?i:will\s+no\s+longer\s+serve\s+as)\s+{CEO_TITLE_RE}"),
    re.compile(rf"{NAME_RE}\s*{_ASIDE}\s+(?i:ceased\s+to\s+serve\s+as)\s+{CEO_TITLE_RE}"),
    # Title-first word order, e.g. "Chief Executive Officer Anthony N. Leo retired."
    re.compile(rf"{CEO_TITLE_RE}\s+{NAME_RE}\s+(?i:has\s+)?(?i:retired|resigned|departed|stepped down)\b"),
    # Possessive noun-phrase form, mirroring the appointment-side fix above:
    # "Mr. Buch's retirement as a director and officer" / "Jane Doe's
    # resignation as CEO".
    re.compile(rf"{NAME_RE}(?:'s|’s)\s+(?i:resignation|retirement|departure)\s+(?i:as)\s+{CEO_TITLE_RE}"),
]

_HONORIFICS = re.compile(r"^(?i:Mr\.|Ms\.|Mrs\.|Dr\.)\s+")

# Capitalized filler words that can precede a real name within a pattern's
# non-greedy "skip a few words" gap (e.g. "Effective Date, John Smith...",
# "Also, on January 1, John Smith..."). If a captured "name" starts with one
# of these it's filler, not a person — reject it so the caller falls through
# to the semantic/LLM tiers instead of returning a wrong name.
_NON_NAME_LEAD_WORDS = {
    "also", "further", "furthermore", "effective", "prior", "pursuant",
    "additionally", "however", "company", "the", "board", "on", "in",
    "as", "date", "accordingly", "subsequently", "separately", "concurrently",
}

# Widening the aside gap (_ASIDE, above) to fit realistic appositive bios
# introduced a new failure mode: the regex can "jump over" the real name
# and land on a job-title phrase instead, since a title like "Executive
# Vice President" is just as capitalization-shaped as a real name. Found by
# testing against real missed cases (Schneider National: captured
# "Executive Vice President" instead of "James S. Filter"). Reject a
# candidate whose words are *entirely* drawn from common title vocabulary —
# a real name essentially never is.
_TITLE_VOCAB = {
    "vice", "president", "executive", "chief", "officer", "director",
    "chairman", "chairwoman", "chairperson", "senior", "group", "managing",
    "global", "regional", "deputy", "assistant", "acting", "interim",
    "principal", "general", "financial", "operating", "technology",
    "information", "legal", "accounting", "marketing", "commercial",
    "revenue", "human", "resources", "administrative", "corporate",
}


def _clean_name(raw: str) -> Optional[str]:
    name = raw.strip().rstrip(",")
    name = _HONORIFICS.sub("", name)
    words = name.split()
    if len(words) < 2:
        return None
    if words[0].lower() in _NON_NAME_LEAD_WORDS:
        return None
    if all(w.lower().rstrip(".,") in _TITLE_VOCAB for w in words):
        return None
    return name


def find_item_502_section(text: str) -> Optional[str]:
    matches = list(ITEM_HEADING_RE.finditer(text))
    start_match = None
    for m in matches:
        if m.group(1) == "5.02":
            start_match = m
            break
    if start_match is None:
        return None

    end_idx = len(text)
    for m in matches:
        if m.start() > start_match.end() and m.group(1) != "5.02":
            end_idx = m.start()
            break

    sig_match = SIGNATURE_RE.search(text, start_match.end())
    if sig_match and sig_match.start() < end_idx:
        end_idx = sig_match.start()

    section = text[start_match.start():end_idx].strip()
    return section or None


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")
# A fragment ending in " C." / " B." is almost always a middle initial
# ("William C.", "Philip B."), not a real sentence end — without this, the
# split above shatters "Philip B. Daniele" into "...Philip B." + "Daniele,
# III shall serve..." and no downstream regex can see the full name again.
# Same problem, different shape, for "Mr."/"Dr."/etc: SEC filings routinely
# write "...on December 29, 2023, Mr." | "Poneman tendered his resignation
# ..." across a naive sentence boundary — this shatters "Mr. Poneman" apart
# just as badly as a middle initial does.
_ABBREVIATION_RE = re.compile(r"(?:^|\s)(?:[A-Z]|Mr|Ms|Mrs|Dr|Jr|Sr|Messrs|Prof)\.$")
# "On August 6, 2026, UY Scuti Acquisition Corp." | "(the "Company") received
# a letter of resignation..." — the standard SEC boilerplate of restating a
# company's full legal name followed immediately by its short-name
# parenthetical splits the subject away from the rest of the sentence,
# because the sentence-split regex breaks on "<punctuation> (". Unlike
# Mr./Ms., a corporate suffix CAN legitimately end a real sentence, so this
# only merges when the next fragment starts with "(" (the short-name
# parenthetical), not on every "Corp."/"Inc." — merging unconditionally would
# wrongly join genuinely separate sentences that happen to start with a
# capital letter after a company name.
_ENTITY_SUFFIX_RE = re.compile(r"(?:^|\s)(?:Corp|Inc|Co|Ltd|LLC|L\.L\.C|LP|L\.P|PLC|N\.A|plc)\.$")
# The section's own boilerplate item-heading ("Item 5.02 Departure of
# Directors or Certain Officers; Election of Directors; Appointment of
# Certain Officers; Compensatory Arrangements of Certain Officers.") is
# near-identical text at the very start of virtually every filing that has
# this section — never itself an appointment/resignation statement. v11
# found the hard way that leaving it in caused a real regression once
# sentence-window context was added: because it's always sentence 0 and the
# real event announcement is very often sentence 1, this exact phrase ends
# up as "previous sentence" context in a hugely disproportionate share of
# genuine positive training windows, teaching the model a shortcut
# ("this phrase nearby -> probably positive") that fires backwards when the
# heading itself later becomes the *target* being classified. Dropping it
# from the sentence list entirely (so it can never be a window neighbor or
# a target) removes that spurious-correlation surface at the source.
#
# v13 postmortem: "^item\s*5\.02\b" alone wasn't enough. Real filing text is
# usually "Item 5.02. Departure of Directors..." — the period after "5.02"
# is itself a sentence boundary under _SENTENCE_SPLIT_RE (period + space +
# capital letter), so the splitter produces "Item 5.02." (10 chars, dropped
# by the length filter below anyway) and "Departure of Directors or Certain
# Officers; ..." as a SEPARATE sentence that no longer starts with "item
# 5.02" and sailed straight through the original regex. Re-discovered the
# exact same disproportionate-context mechanism this was meant to prevent:
# this standardized SEC caption (same wording in virtually every Item 5.02
# filing, since it's prescribed by Form 8-K's instructions, not drafted
# per-filer) showed up in 38% of RESIGNED and 22% of APPOINTED training
# windows vs. only 14% of NONE ones. Matching on the caption text itself
# (distinctive enough not to false-positive on real content) closes the gap
# regardless of how the sentence splitter handles the numbering prefix.
_ITEM_HEADING_RE = re.compile(
    r"^item\s*5\.02\b|^departure\s+of\s+directors\s+or\s+certain\s+officers\b",
    re.IGNORECASE,
)


def split_sentences(text: str) -> List[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []
    raw_parts = _SENTENCE_SPLIT_RE.split(normalized)
    merged: List[str] = []
    for part in raw_parts:
        if merged and _ABBREVIATION_RE.search(merged[-1]):
            merged[-1] = merged[-1] + " " + part
        elif merged and part.startswith("(") and _ENTITY_SUFFIX_RE.search(merged[-1]):
            merged[-1] = merged[-1] + " " + part
        else:
            merged.append(part)
    return [p.strip() for p in merged
            if len(p.strip()) > 15 and not _ITEM_HEADING_RE.match(p.strip())]


WINDOW_DELIM = " ||| "
# v11/v12 postmortem: plain WINDOW_DELIM-joined context gave the model zero
# signal about which of the 1-3 concatenated sentences was actually the one
# being labeled — "prev ||| target ||| next" looks structurally identical
# regardless of which position holds the event. That's the root cause of the
# context-bleed regression (a neighbor's CEO-relevant language could flip the
# label for a target sentence with nothing to do with CEOs, since the model
# was never told "the middle one is what matters"). These markers are plain
# words (not registered as tokenizer special tokens, so no vocab resize /
# embedding-retraining wiring needed) chosen to be vanishingly unlikely to
# appear in real SEC filing text, wrapped directly around the target
# sentence so the model can learn to weight it over the flanking context.
_TARGET_START = "CEOTARGETSTART"
_TARGET_END = "CEOTARGETEND"


def window_sentence(sentences: List[str], idx: int) -> str:
    """One sentence of context on each side of sentences[idx], with the
    target sentence itself wrapped in marker tokens.

    Several persistent classifier misses are structurally unsolvable from a
    single sentence alone: e.g. "Mr. Kanter's employment with the Company
    will terminate on August 11, 2026" never restates that Kanter is the
    CEO — that's established in a neighboring sentence. Used identically at
    training-data-build time (prepare_dataset.py, build_scan_dataset.py) and
    at inference time (run_on_date.py) so the model always sees the same
    shape of input.
    """
    parts = []
    if idx > 0:
        parts.append(sentences[idx - 1])
    parts.append(f"{_TARGET_START} {sentences[idx]} {_TARGET_END}")
    if idx < len(sentences) - 1:
        parts.append(sentences[idx + 1])
    return WINDOW_DELIM.join(parts)


def regex_extract_ceo_event(sentence: str) -> Optional[Tuple[str, str]]:
    """Try to match a sentence against known appointment/resignation phrasing.

    Returns (name, "appointed"|"resigned") or None. Appointment patterns are
    checked first since that's the primary question being asked.
    """
    for pattern in APPOINT_PATTERNS:
        # finditer, not search: a sentence like "Mr. Daniele will serve as
        # the Company's CEO" matches NAME_RE at "Mr. Daniele" first, which
        # _clean_name correctly rejects (it's just "Daniele" — one word —
        # once the honorific is stripped). search() would stop right there;
        # finditer() lets us keep looking for a later, fuller match in the
        # same sentence instead of giving up on the whole pattern.
        for m in pattern.finditer(sentence):
            name = _clean_name(m.group(1))
            if name:
                return name, "appointed"
    for pattern in RESIGN_PATTERNS:
        for m in pattern.finditer(sentence):
            name = _clean_name(m.group(1))
            if name:
                return name, "resigned"
    return None
