#!/usr/bin/env python3
"""Parse scraped CUHK program study schemes into flat, bucketed course data.

Input : data/raw/programs/<year>/<Faculty>/<slug>.json  (the `study_scheme` text field)
Output: data/programs/<year>/<Faculty>/<slug>.json   (one per program; the sole
        tracked source — scripts/build_bundles.mts reads these files directly to
        build data/programs/programs.json, so there is no merged-array copy to
        drift out of sync)

Scope (agreed): Major Programme Requirement only (not the Recommended Course Pattern /
senior-year-entry variant yet). Flat buckets, not a full tree.

Because the source is Word-exported HTML flattened to text, parsing is pattern-based and
tolerant. Two layers:
  Layer 0  all_course_codes  -- every course reference, shorthand-expanded (reliable).
  Layer 1  buckets           -- required / elective / stream_elective, best-effort.
parse_status flags how far parsing got so consumers can trust or skip.
"""
from __future__ import annotations

import glob
import json
import os
import re

IN_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw", "programs")
OUT_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "programs")

CODE_RE = re.compile(r"\b[A-Z]{4}\d{4}\b")
SUBJ_NUM_RE = re.compile(r"\b([A-Z]{4})(\d{4})\b")
# Cross-listed course carried under two subject codes, e.g. "DOTE[DSME]2021" means
# the same course is DOTE2021 (primary) or DSME2021 (alternate). A naked "DOTE[DSME]"
# with no number is a bare subject-pair reference and is ignored.
BRACKET_CODE_RE = re.compile(r"([A-Z]{4})\[([A-Z]{4})\](\d{4})")
# A bare 4-digit continuation number is really a "…-level" descriptor, not a course
# number, when it is immediately followed by "level" / "above" / "or above" /
# "and above" (any whitespace/newline in between). Keeps "at 3000 and 4000 level"
# and "at 2000 or above level" from minting phantom course codes.
LEVEL_DESCRIPTOR_RE = re.compile(r"\s*(?:(?:or|and)\s+above|above|level)\b", re.I)
# A continuation gap that still binds a bare number to the running subject: any mix
# of spaces/commas, optionally with a single "and" (so "ENGG3802 and 3803" expands
# to ENGG3803). "or" is deliberately NOT allowed — it marks an alternative, not a
# co-requisite pair, so the two sides stay distinct references.
CONT_GAP_RE = re.compile(r"[\s,]*(?:and[\s,]+)?")
# A footnote/annotation marker the calendar attaches to a code or a shorthand list,
# e.g. "ECON1101[a], 1111" or "Elective Courses[b][c]:". Left in place it sits in the
# continuation gap and severs every following bare number from its subject (the
# calendar-wide "lost course" bug). Stripped before tokenizing so the gap collapses to
# plain "…, …". Lowercase-only so cross-listed brackets "DOTE[DSME]2021" (uppercase) and
# the numeric part of any code are untouched. Mirrors the audit reference extractor.
FOOTNOTE_RE = re.compile(r"\[[a-z]+\]")
# A parenthetical insertion the calendar drops between a code and the next shorthand
# number, e.g. "SOWK4030 (capstone course), 4510" or "…4903 (capstone course)". It too
# lands in the continuation gap; we erase whole parentheticals from the *gap only* (not
# the text) before the binding test, so the trailing numbers still re-attach. A course
# code living inside the parenthetical is emitted independently by the tokenizer, so
# this never drops one.
PARENS_RE = re.compile(r"\([^)]*\)")


def _gap_binds(gap: str) -> bool:
    """Does this inter-token gap still bind a bare number to the running subject?
    Whole parenthetical insertions are erased first (they are prose asides, not list
    separators), then the residue must be pure spaces/commas + at most one "and"."""
    return bool(CONT_GAP_RE.fullmatch(PARENS_RE.sub(" ", gap)))


def norm(t: str) -> str:
    return re.sub(r"\s+", " ", t).strip()


# --------------------------------------------------------------------------- courses
def extract_courses(text: str) -> list[dict]:
    """Extract course references from a chunk of requirement text.

    Handles:
      * canonical codes            CENG2010
      * '/ESTR' alternatives       CSCI2100/ESTR2102  -> one entry, alt=True
      * cross-listed brackets      DOTE[DSME]2021     -> DOTE2021 / DSME2021, alt=True
      * shorthand continuation     'CENG2010, 2030'   -> CENG2010, CENG2030
      * 'and' continuation pairs   'ENGG3802 and 3803' -> ENGG3802, ENGG3803
    Returns a de-duplicated list of {raw, codes, alt} in first-seen order.
    Note refs like '[b]' and prose ('Chemistry Courses:') are ignored.
    """
    # Strip footnote markers ([a], [bc], …) up front: left in place they wedge into the
    # continuation gap ("ECON1101[a], 1111") and orphan every following shorthand number.
    # Offsets below are all relative to this cleaned text, so gap computation stays exact.
    text = FOOTNOTE_RE.sub("", text)
    out: list[dict] = []
    seen: set[str] = set()
    current_subj: str | None = None
    last_end: int | None = None
    last_was_course = False
    # token = a bracket cross-listing, OR a code (with optional /alts), OR a bare
    # 4-digit continuation number. The bracket form is listed first so it wins over
    # the bare-number branch (which would otherwise grab the trailing digits alone).
    token_re = re.compile(
        r"[A-Z]{4}\[[A-Z]{4}\]\d{4}"
        r"|[A-Z]{4}\d{4}(?:/[A-Z]{4}\d{4})*"
        r"|(?<![A-Za-z0-9])\d{4}(?![0-9])"
    )
    for tok in token_re.finditer(text):
        s = tok.group(0)
        bm = BRACKET_CODE_RE.fullmatch(s)
        if bm:
            # Cross-listed pair: primary code drives the running subject so a
            # following bare number ("DOTE[DSME]1030, 1040") re-attaches to DOTE.
            primary, alt_subj, num = bm.group(1), bm.group(2), bm.group(3)
            current_subj = primary
            codes = [primary + num, alt_subj + num]
            if s not in seen:
                seen.add(s)
                out.append({"raw": s, "codes": codes, "alt": True})
            last_end = tok.end()
            last_was_course = True
            continue
        if s[0].isalpha():
            current_subj = s[:4]
            raw = s
        else:
            # bare number: expand ONLY if it directly continues a course list, i.e.
            # the gap since the last accepted course is spaces/commas plus at most
            # one "and". Kills false positives like "at 1000 or 2000 level", "6 units".
            gap = text[last_end:tok.start()] if last_end is not None else "x"
            if current_subj and last_was_course and _gap_binds(gap):
                # …but a bare number trailing straight into "level"/"above" is a
                # course-level descriptor ("3000 and 4000 level"), not a course.
                if LEVEL_DESCRIPTOR_RE.match(text[tok.end():]):
                    last_was_course = False
                    last_end = tok.end()
                    continue
                raw = current_subj + s
            else:
                last_was_course = False
                last_end = tok.end()
                continue
        codes = CODE_RE.findall(raw)
        if codes and raw not in seen:
            seen.add(raw)
            out.append({"raw": raw, "codes": codes, "alt": "/" in raw})
        last_end = tok.end()
        last_was_course = True
    return out


# --------------------------------------------------------------------------- sections
SECTION_ANCHORS = [
    ("major_requirement", re.compile(r"Major\s+Programme\s+Requirement(?!\s*\(\s*for)", re.I)),
    ("senior_year", re.compile(r"Major\s+Programme\s+Requirement\s*\(\s*for", re.I)),
    ("recommended_pattern", re.compile(r"Recommended\s+Course\s+Pattern(?!\s*\(\s*for)", re.I)),
    ("elite", re.compile(r"\(\s*ELITE\s*\)\s*Stream", re.I)),
    # A named, optional "Concentration Area:" segment the calendar prints *after* the
    # Major-block grand total. Case-sensitive + trailing colon so the incidental prose
    # phrase "...under respective concentration area as follows:" (lowercase, no colon
    # right after "area") can never mis-anchor. Only 4 programmes carry it as a heading
    # (Economics, Psychology, Sociology, Law); parse_program further guards that it sits
    # after a Total line before treating it as a section boundary.
    ("concentration", re.compile(r"Concentration\s+Area\s*:")),
    # A named, optional "Streams:" segment the calendar prints *after* the Major-block
    # grand total (e.g. Physics). Same shape as Concentration Area — a specific header,
    # prose direction names, and (a)/(b) sub-items — but its directions are optional
    # declarable *streams*, tagged kind='stream'. Case-sensitive + trailing colon so
    # incidental prose ("...streams offered by other programmes") never mis-anchors,
    # and "Stream 1:" style inline labels (which carry a number before the colon) are
    # not matched. parse_program guards it the same way as concentration: it must sit
    # after a Total line, inside the Major-block region, and parse into real directions.
    ("streams", re.compile(r"Streams?\s*:")),
    ("notes", re.compile(r"Explanatory\s+Notes", re.I)),
]


def find_sections(text: str) -> list[tuple[int, str]]:
    """Locate section anchors by position, matching against a whitespace-normalized
    view but mapping back to original offsets."""
    hits = []
    # Build a normalized string with an index map back to the original.
    idx_map = []
    buf = []
    prev_space = False
    for i, ch in enumerate(text):
        if ch.isspace():
            if not prev_space:
                buf.append(" ")
                idx_map.append(i)
            prev_space = True
        else:
            buf.append(ch)
            idx_map.append(i)
            prev_space = False
    ntext = "".join(buf)
    for key, pat in SECTION_ANCHORS:
        m = pat.search(ntext)
        if m:
            hits.append((idx_map[m.start()], key))
    hits.sort()
    return hits


# --------------------------------------------------------------------------- items
ITEM_RE = re.compile(r"^\s*(\d+\.|\([a-z]\)|\([ivx]+\)|[ivx]+\))\s*\|?\s*(.*)$")


def marker_level(marker: str) -> int:
    if re.match(r"\d+\.", marker):
        return 1
    if re.match(r"\([a-z]\)", marker):
        return 2
    return 3  # roman sub-items


# "(i)", "(v)", "(x)" are ambiguous: each is BOTH a single-letter alpha marker
# (level 2) and a roman numeral opening a sub-list (level 3). An alpha list only
# reaches them by continuing from its predecessor letter — (h)->(i), (u)->(v),
# (w)->(x) — and those predecessors are never themselves roman, so the immediately
# preceding marker disambiguates cleanly. 59 programmes use (h)->(i) as a genuine
# 9th lettered item; 91 use (i) to open a roman sub-list — this tells them apart.
ROMAN_ALPHA_PREDECESSOR = {"(i)": "(h)", "(v)": "(u)", "(x)": "(w)"}


def marker_level_ctx(marker: str, prev_marker: str | None) -> int:
    pred = ROMAN_ALPHA_PREDECESSOR.get(marker)
    if pred is not None:
        return 2 if prev_marker == pred else 3
    return marker_level(marker)


def bucket_for(group_title: str, ancestors: list[str]) -> tuple[str, str | None]:
    """Return (bucket, stream_label). Bucket ∈ required|elective|stream_elective."""
    joined = " ".join(ancestors + [group_title]).lower()
    stream_label = None
    for a in ancestors + [group_title]:
        sm = re.search(r"(stream\s*\d+[^|]*|general[^|]*engineering|option\s*[a-z])", a, re.I)
        if sm:
            stream_label = norm(a)
    if "choose any one" in joined or re.search(r"stream\s*\d", joined) or stream_label:
        return "stream_elective", stream_label
    if "elective" in joined:
        return "elective", None
    return "required", None


def parse_requirements(block: str) -> tuple[list[dict], list[dict]]:
    """Walk the Major Programme Requirement block. Returns (outline, leaf_groups)."""
    # gather items with their following text
    rows: list[dict] = []
    cur: dict | None = None
    prev_marker: str | None = None
    for line in block.split("\n"):
        m = ITEM_RE.match(line)
        if m:
            marker, rest = m.group(1), m.group(2)
            um = re.search(r"\|\s*([\d\-]+)\s*$", rest)
            units = um.group(1) if um else None
            title = norm(re.sub(r"\|\s*[\d\-]+\s*$", "", rest)).rstrip(":")
            cur = {
                "marker": marker, "level": marker_level_ctx(marker, prev_marker),
                "title": title, "units": units, "text": [rest],
            }
            rows.append(cur)
            prev_marker = marker
        elif cur is not None:
            cur["text"].append(line)

    # assign ancestors by level stack
    outline, leaves = [], []
    stack: list[dict] = []
    for r in rows:
        while stack and stack[-1]["level"] >= r["level"]:
            stack.pop()
        ancestors = [s["title"] for s in stack]
        full_text = " ".join(r["text"])
        courses = extract_courses(full_text)
        bucket, stream = bucket_for(r["title"], ancestors)
        outline.append({
            "marker": r["marker"], "level": r["level"], "title": r["title"],
            "units": r["units"], "bucket": bucket, "stream": stream,
            "n_courses": len(courses),
        })
        if courses:
            leaves.append({"bucket": bucket, "stream": stream, "courses": courses,
                           "from": f"{r['marker']} {r['title']}".strip()})
        stack.append(r)
    return outline, leaves


# --------------------------------------------------------------------------- structure
# A faithful hierarchical rebuild of the Major Programme Requirement, mirroring the
# university's numbered / lettered / prose layers so the frontend can render the
# scheme exactly as the calendar prints it. This is additive: the flat `buckets`
# above are still produced for the existing search filter, `structure` is the new
# tree.  See SectionNode schema in the module docstring / build_bundles.mts.

# Trailing "| 9" or "| 15-18" -> the leading integer (lower bound of any range).
UNITS_TAIL_RE = re.compile(r"\|\s*(\d+)(?:\s*-\s*\d+)?\s*$")
# "Choose (at least) 9 units", "Choose 17 units", "12-18 units from ..." -> first int.
CHOOSE_UNITS_RE = re.compile(
    r"(?:at\s+least\s+|at\s+most\s+)?(\d+)(?:\s*-\s*\d+)?\s+units", re.I
)
# Titles that name a structural/leaf section (as opposed to a bare course list or a
# free-text rule). Used to decide whether a marker's text is a heading.
HEADER_TITLE_KW = re.compile(
    r"\b(Stream|General|Foundation|Faculty|Package|Research|Component|Option)\b", re.I
)
# Prose sub-labels that subdivide a leaf node's own text into pseudo-children.
PROSE_HEADER_RE = re.compile(
    r"(?:"
    r"Required\s+Courses?"
    r"|Elective\s+Courses?(?:\s+\d+)?"
    r"|Remaining\s+units\s+can\s+be\s+chosen\s+from(?:\s+the\s+following)?"
    r"|For\s+students\b[^:]*?Stream[^:]*"
    r")\s*:",
    re.I,
)
# The grand total line that closes the Major Programme Requirement items.
TOTAL_RE = re.compile(r"^\s*Total\b")
# A free-text fragment is only kept as a `note` if it reads like an actual rule,
# not a word orphaned by Word's hard line-wrapping ("At", "Capstone") or a bare
# continuation-number tail the course extractor couldn't re-attach.
RULE_KW = re.compile(
    r"\b(units?|courses?|level|following|choose|chosen|least|most|except|"
    r"excluding|stream|option|concentration|prescribed|specialize|any\s+one)\b",
    re.I,
)


def _looks_like_rule(text: str) -> bool:
    t = text.strip()
    return len(t.split()) >= 3 and bool(RULE_KW.search(t))


def normalize_label(text: str) -> str:
    """Collapse whitespace, drop footnote/annotation brackets ([a], [DSME]) and a
    trailing unit tail / colon, leaving a clean human label."""
    text = re.sub(r"\[[^\]]*\]", "", text)
    text = re.sub(r"\s*\|\s*[\d\-]+\s*$", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text.rstrip(":").strip()


def strip_units(text: str) -> tuple[int | None, str]:
    """Split a trailing '| N' unit tail off a line -> (units, text_without_tail)."""
    m = UNITS_TAIL_RE.search(text)
    if m:
        return int(m.group(1)), text[: m.start()].rstrip()
    return None, text


def to_program_courses(refs: list[dict]) -> list[dict]:
    """extract_courses() output -> [{code, alts}], de-duplicated on the primary code,
    first-seen order. code = codes[0] (8-char key), alts = the rest."""
    out: list[dict] = []
    seen: set[str] = set()
    for r in refs:
        codes = r.get("codes") or []
        if not codes:
            continue
        code = codes[0]
        if code in seen:
            continue
        seen.add(code)
        out.append({"code": code, "alts": codes[1:]})
    return out


def _seg_units(seg: str) -> int | None:
    m = CHOOSE_UNITS_RE.search(seg)
    if m:
        return int(m.group(1))
    u, _ = strip_units(seg)
    return u


def _leading_label(text: str) -> str | None:
    """For a course-list line that opens with a 'Foo:' prefix (e.g. 'Capstone
    course[b]: Either MATH4400 ...'), return the label text before the colon."""
    cm = CODE_RE.search(text)
    if not cm:
        return None
    prefix = text[: cm.start()]
    if ":" in prefix:
        lab = prefix.rsplit(":", 1)[0]
        if lab.strip() and not CODE_RE.search(lab):
            return lab
    return None


def _join_title_continuation(
    title: str, rest_complete: bool, cont_lines: list[str]
) -> tuple[str, int | None, int]:
    """Stitch a wrapped heading back together. A heading whose text does not already
    end in ':' (e.g. 'Stream 2: Database and', 'Choose any ONE from the following')
    absorbs the immediately following plain fragment lines ('Information Systems',
    'three options: | 12'). Stops — conservatively — at the first blank line, course
    code, prose sub-label, over-long line, or once the title becomes ':'-terminated."""
    if rest_complete:
        return title, None, 0
    units: int | None = None
    consumed = 0
    for line in cont_lines:
        s = line.strip()
        if not s or extract_courses(s) or PROSE_HEADER_RE.match(s) or len(s) > 60:
            break
        u, s_wo = strip_units(s)
        if u is not None and units is None:
            units = u
        title = (title + " " + s_wo).strip()
        consumed += 1
        if s_wo.rstrip().endswith(":") or consumed >= 3:
            break
    return re.sub(r"\s+", " ", title).strip(), units, consumed


def _parse_body(text: str) -> tuple[list[dict], str | None, list[dict]]:
    """Parse a node's own free text into (direct_courses, leading_note, pseudo_children).
    Pseudo-children are the 'Required Courses:' / 'Elective Courses:' / 'Remaining
    units ...' / 'For students ... Stream:' prose subdivisions."""
    text = text.strip()
    if not text:
        return [], None, []
    matches = list(PROSE_HEADER_RE.finditer(text))
    if not matches:
        courses = to_program_courses(extract_courses(text))
        if courses:
            return courses, None, []
        norm = normalize_label(text)
        return [], (norm if _looks_like_rule(norm) else None), []

    pre = text[: matches[0].start()]
    lead_courses = to_program_courses(extract_courses(pre))
    lead_note = None
    if not lead_courses and pre.strip():
        norm = normalize_label(pre)
        lead_note = norm if _looks_like_rule(norm) else None

    children: list[dict] = []
    for i, m in enumerate(matches):
        seg = text[m.end() : (matches[i + 1].start() if i + 1 < len(matches) else len(text))]
        children.append(
            {
                "marker": "",
                "title": "",
                "units": _seg_units(seg),
                "note": normalize_label(m.group(0)) or None,
                "courses": to_program_courses(extract_courses(seg)),
                "children": [],
            }
        )
    return lead_courses, lead_note, children


class _Row:
    __slots__ = ("marker", "level", "rest", "cont", "children")

    def __init__(self, marker: str, rest: str):
        self.marker = marker
        self.level = marker_level(marker)
        self.rest = rest
        self.cont: list[str] = []
        self.children: list["_Row"] = []


def _gather_rows(block: str) -> list[_Row]:
    """Split the Major Programme Requirement block into a marker tree. Continuation
    (non-marker) lines attach to the current marker as `cont`; parsing stops at the
    grand-total line so trailing ELITE/notes prose can never leak into item 4."""
    roots: list[_Row] = []
    stack: list[_Row] = []
    cur: _Row | None = None
    prev_marker: str | None = None
    for line in block.split("\n"):
        if TOTAL_RE.match(line):
            break
        m = ITEM_RE.match(line)
        if m:
            cur = _Row(m.group(1), m.group(2))
            cur.level = marker_level_ctx(cur.marker, prev_marker)
            while stack and stack[-1].level >= cur.level:
                stack.pop()
            (stack[-1].children if stack else roots).append(cur)
            stack.append(cur)
            prev_marker = cur.marker
        elif cur is not None:
            cur.cont.append(line)
    return roots


def _convert_row(row: _Row) -> dict:
    node_units, rest_wo = strip_units(row.rest)
    rest_codes = extract_courses(rest_wo)
    rest_complete = rest_wo.rstrip().endswith(":")

    title = ""
    note: str | None = None
    body_lines = list(row.cont)
    direct_courses: list[dict] = []

    if rest_codes:
        # Case A: the marker line IS a course list (possibly 'Label: <codes>').
        label = _leading_label(rest_wo)
        if label:
            note = normalize_label(label) or None
        direct_courses = to_program_courses(rest_codes)
    else:
        title_candidate = normalize_label(rest_wo)
        if row.children or HEADER_TITLE_KW.search(title_candidate):
            # Case B: a heading (structural parent, or a named leaf like a stream).
            title, join_units, consumed = _join_title_continuation(
                title_candidate, rest_complete, body_lines
            )
            title = title.rstrip(":").strip()
            if node_units is None:
                node_units = join_units
            body_lines = body_lines[consumed:]
        else:
            # Case C: a bare free-text rule -> note (only if it reads like one; a
            # lone word orphaned by line-wrapping is dropped, its courses still land
            # via the body below).
            note = title_candidate if _looks_like_rule(title_candidate) else None

    body_joined = " ".join(s.strip() for s in body_lines).strip()
    # A course list can carry its unit total on a wrapped continuation line
    # ("(c) | ENGG2440..., \n ENGG2780..., MATH1510 | 10"); pick it up if the
    # marker line itself didn't already state one.
    if node_units is None:
        tail_units, body_joined = strip_units(body_joined)
        node_units = tail_units
    b_courses, b_note, pseudo = _parse_body(body_joined)
    direct_courses.extend(b_courses)
    if note is None and b_note:
        note = b_note

    children = pseudo + [_convert_row(c) for c in row.children]
    return {
        "marker": row.marker,
        "title": title,
        "units": node_units,
        "note": note,
        "courses": direct_courses,
        "children": children,
    }


def build_structure(block: str) -> list[dict]:
    """Top level = the numbered items (1./2./3./4.) of the Major Programme Requirement."""
    return [_convert_row(r) for r in _gather_rows(block)]


def _collect_struct_codes(nodes: list[dict]) -> set[str]:
    """Every course code (primary + alts) placed anywhere in a structure tree."""
    acc: set[str] = set()
    for n in nodes:
        for c in n["courses"]:
            acc.add(c["code"])
            acc.update(c.get("alts") or [])
        acc |= _collect_struct_codes(n["children"])
    return acc


def build_fallback_node(block: str, structure: list[dict]) -> dict | None:
    """Zero-silent-loss safety net (Fix C): any course code present in the Major
    Programme Requirement *block* but not placed anywhere in the structure tree is
    swept into one catch-all node. In practice this captures the concentration /
    stream pools the calendar prints *after* the block's grand-total line (which the
    marker walk stops at) and any rare text shape the tree walk skips — so the info
    page's course table can never silently omit a Major-block course. Returns None
    when the structure already covers everything (the common case after Fix A/B)."""
    placed = _collect_struct_codes(structure)
    leftover: list[dict] = []
    seen: set[str] = set()
    for pc in to_program_courses(extract_courses(block)):
        code = pc["code"]
        if code in placed or code in seen:
            continue
        if any(a in placed for a in pc["alts"]):
            continue  # already represented via its cross-listed alternate
        seen.add(code)
        leftover.append(pc)
    if not leftover:
        return None
    return {
        "marker": "",
        "title": "其他相关课程",
        "units": None,
        "note": "本方案文本中列出、未归入上述分区的课程",
        "courses": leftover,
        "children": [],
    }


# ------------------------------------------------------------------- concentration
# The "Concentration Area:" segment the calendar prints after the Major-block total.
# It names one optional专业方向 per prose line (or per "A."/"B." letter marker), each
# followed by its own Required/Elective marker sub-tree. We rebuild it as ONE top-level
# node tagged kind='concentration', with one child per direction. Robustness first:
# if the direction layout can't be recognised we return None and the caller sweeps the
# segment's courses into the 其他相关课程 catch-all, so a course is never lost.
CONC_HEADER_RE = re.compile(r"\s*Concentration\s+Area\s*:?\s*", re.I)
CONC_INTRO_RE = re.compile(r"\s*(Students?\b.*?:)", re.S)
LETTER_MARKER_RE = re.compile(r"^\s*([A-Z])\.\s*\|")


def _dir_node_from_body(name: str, body_lines: list[str]) -> dict:
    """Build one direction node from its name + the lines of its body. Leading prose
    (before the first '(a)'/'1.' marker) becomes direct courses / a note; the markered
    remainder is rebuilt with the shared build_structure() marker walk."""
    first_marker = None
    for i, l in enumerate(body_lines):
        if ITEM_RE.match(l):
            first_marker = i
            break
    if first_marker is None:
        pre, mark_block = body_lines, []
    else:
        pre, mark_block = body_lines[:first_marker], body_lines[first_marker:]
    lead_courses, lead_note, pseudo = _parse_body(" ".join(s.strip() for s in pre))
    children = pseudo + (build_structure("\n".join(mark_block)) if mark_block else [])
    return {
        "marker": "",
        "title": normalize_label(name),
        "units": None,
        "note": lead_note,
        "courses": lead_courses,
        "children": children,
    }


def _letter_directions(body: str) -> list[dict]:
    """Psychology-style: each direction opens with a 'A. | Name' / 'B. | Name' letter
    marker and its body is a flat course list. Name = text before the first course code."""
    dirs: list[dict] = []
    cur: list[str] | None = None
    for line in body.split("\n"):
        if LETTER_MARKER_RE.match(line):
            cur = [line.split("|", 1)[1] if "|" in line else ""]
            dirs.append(cur)
        elif cur is not None:
            cur.append(line)
    out: list[dict] = []
    for lines in dirs:
        joined = " ".join(s.strip() for s in lines).strip()
        cm = CODE_RE.search(joined)
        name = joined[: cm.start()] if cm else joined
        courses = to_program_courses(extract_courses(joined))
        node = {
            "marker": "",
            "title": normalize_label(name),
            "units": None,
            "note": None,
            "courses": courses,
            "children": [],
        }
        if node["title"] or node["courses"]:
            out.append(node)
    return out


def _looks_like_dir_name(s: str) -> bool:
    """A trustworthy prose direction name: a short title-like phrase with no digits,
    pipe, colon, course code or rule-vocabulary. Prose boundaries are heuristic, so a
    name failing this is dropped and its courses fall through to the catch-all (and if
    the bad names outnumber the good ones the whole segment is rejected); letter-marked
    ('A.'/'B.') directions skip this gate — their boundaries are explicit."""
    s = s.strip()
    if not s or len(s) > 55 or "|" in s or ":" in s or CODE_RE.search(s):
        return False
    if re.search(r"\d", s):
        return False
    low = s.lower()
    # Rule / sub-label vocabulary that a real direction title never carries — these
    # weed out fragments Word's hard-wrapping strands onto a heading line ("Elective",
    # "Programme Requirement", "Required Courses").
    bad = ("unit", "least", "below", "total", "explanatory", "following",
           "maximum", "listed", "module", "cluster", "any ",
           "elective", "required", "course", "requirement", "programme", "addition")
    if any(b in low for b in bad):
        return False
    words = s.split()
    if not 1 <= len(words) <= 7:
        return False
    if words[-1].lower() in ("at", "and", "or", "the", "of", "from", "a", "any"):
        return False
    return True


# Boundary tokens that terminate a (possibly hard-wrapped) prose direction name.
# Used to cut a name run at the first rule/marker/course signal, so Word's hard
# line-wrapping ("Research\nMethods and Data Analytics\nAt\nleast 18 units…", where
# a lone "At" dangles onto the name line before the real "At least …" rule) doesn't
# leak rule text into the direction title.
NAME_CUT_RE = re.compile(
    r"\bAt\s+least\b|\bAt\s+most\b|\bStudents?\b|\bChoose\b|\bA\s+maximum\b|\bUp\s+to\b"
    r"|\bunits?\b|\bcourses?\b|\([a-z]\)|\b[A-Z]{4}\d{4}\b|\d+\.|\|",
    re.I,
)


def _cut_dir_name(s: str) -> str:
    """Trim a joined name-run at the first rule/marker/course token, then normalize."""
    m = NAME_CUT_RE.search(s)
    if m:
        s = s[: m.start()]
    return normalize_label(s)


def _is_dir_header_line(s: str, stream_mode: bool = False) -> bool:
    s = s.strip()
    if not s or ITEM_RE.match(s) or LETTER_MARKER_RE.match(s) or CODE_RE.search(s):
        return False
    # Direction titles never carry a unit pipe or a bare digit; a wrapped course-list
    # tail ("5610 | 3", "4050[j], 4051, …") is data, not a heading.
    if "|" in s or re.search(r"\d", s):
        return False
    lab = normalize_label(s)
    if not lab or len(lab.split()) > 8:
        return False
    if _looks_like_rule(lab):
        # Stream names legitimately contain the word "Stream" (which is a rule keyword),
        # e.g. "Enrichment Stream in Theoretical Physics". In stream mode, a line whose
        # ONLY rule signal is "stream(s)" is still a candidate name; anything with a
        # further rule word (units/courses/following/…) stays a rule.
        if stream_mode and not _looks_like_rule(re.sub(r"\bstreams?\b", "", lab, flags=re.I)):
            return True
        return False
    return True


def _prose_directions(body: str, stream_mode: bool = False) -> list[dict]:
    """Economics / Sociology / Physics-style: each direction is a prose name line
    (possibly hard-wrapped over several lines) followed by its Required/Elective marker
    sub-tree. A name only counts as a direction boundary if a real marker '(a)'/'1.'
    appears before the next candidate name — this rejects stray prose sub-labels
    ('Optional Interdisciplinary Cluster:') that carry no markers, keeping their courses
    attached to the preceding direction instead of spawning a phantom one.

    stream_mode=True relaxes the header test so stream names carrying the word "Stream"
    are recognised, and tags nothing itself (the caller sets kind='stream')."""
    lines = body.split("\n")
    # Group consecutive header-candidate lines into (name, start_idx, end_idx) runs.
    runs: list[tuple[str, int, int]] = []
    i = 0
    n = len(lines)
    while i < n:
        if _is_dir_header_line(lines[i], stream_mode):
            j = i
            parts = []
            while j < n and _is_dir_header_line(lines[j], stream_mode):
                parts.append(lines[j].strip())
                j += 1
            runs.append((" ".join(parts), i, j))
            i = j
        else:
            i += 1
    if not runs:
        return []
    # Keep only runs that have a marker line before the next run starts.
    valid: list[tuple[str, int, int]] = []
    for k, (name, s, e) in enumerate(runs):
        nxt = runs[k + 1][1] if k + 1 < len(runs) else n
        if any(ITEM_RE.match(lines[b]) for b in range(e, nxt)):
            valid.append((name, s, e))
    if not valid:
        return []
    # Cut each run's name at the first rule/marker/course token, appending the first
    # line past the run so a dangling wrapped fragment ("…Analytics At" + "least 18
    # units…") is cleanly severed at "At least".
    cut: list[tuple[str, int, int]] = []
    for name, s, e in valid:
        lookahead = lines[e].strip() if e < n else ""
        cut.append((_cut_dir_name((name + " " + lookahead).strip()), s, e))
    # Quality gate: keep only names that read like a real direction title; a phantom
    # (a wrapped rule/sub-label the cut couldn't rescue) is dropped and its courses
    # fall through to the catch-all. If the phantoms OUTNUMBER the real names the whole
    # segment is untrustworthy → reject it so the caller sweeps everything to the
    # catch-all rather than shipping a mangled tree.
    kept = [k for k, (name, _, _) in enumerate(cut) if _looks_like_dir_name(name)]
    if not kept or len(kept) < (len(cut) - len(kept)):
        return []
    out: list[dict] = []
    for pos, k in enumerate(kept):
        name, _, e = cut[k]
        body_start = e
        if pos + 1 < len(kept):
            # Extend to the next *kept* direction, absorbing any interior phantom (and
            # its courses) into this real direction rather than orphaning them.
            body_end = cut[kept[pos + 1]][1]
        else:
            # Last real direction: stop before the first phantom that trails it so
            # trailing garbage (a separate faculty stream, notes) isn't swallowed —
            # it drops to the catch-all instead.
            trailing = [cut[j][1] for j in range(k + 1, len(cut))]
            body_end = min(trailing) if trailing else n
        node = _dir_node_from_body(name, lines[body_start:body_end])
        if node["title"] or node["courses"] or node["children"]:
            out.append(node)
    return out


def parse_concentration(block: str) -> dict | None:
    """Parse a "Concentration Area:" segment into a kind='concentration' node whose
    children are the individual专业方向. Returns None (→ caller falls back) when no
    direction can be recognised, so courses are never dropped."""
    m = CONC_HEADER_RE.match(block)
    rest = block[m.end():] if m else block
    intro_note = None
    im = CONC_INTRO_RE.match(rest)
    if im:
        intro_note = normalize_label(im.group(1))
        body = rest[im.end():]
    else:
        body = rest
    letters = sum(1 for l in body.split("\n") if LETTER_MARKER_RE.match(l))
    directions = _letter_directions(body) if letters >= 2 else _prose_directions(body)
    if not directions:
        return None
    return {
        "marker": "",
        "kind": "concentration",
        "title": "专业方向 · Concentration Area",
        "units": None,
        "note": intro_note,
        "courses": [],
        "children": directions,
    }


# ------------------------------------------------------------------------- streams
# The "Streams:" segment the calendar prints after the Major-block total (Physics).
# Structurally identical to Concentration Area — a header, prose stream names, and
# (a)/(b) sub-items — but its directions are optional declarable *streams*. We rebuild
# it as ONE top-level node tagged kind='stream', with one child per stream. As with
# concentration, an unrecognisable layout returns None so the caller sweeps the courses
# into the 其他相关课程 catch-all rather than dropping them.
STREAM_HEADER_RE = re.compile(r"\s*Streams?\s*:\s*")


def parse_streams(block: str) -> dict | None:
    """Parse a "Streams:" segment into a kind='stream' node whose children are the
    individual streams. Returns None (→ caller falls back) when none can be recognised."""
    m = STREAM_HEADER_RE.match(block)
    body = block[m.end():] if m else block
    # Leading prose (the "Students may declare at most two of the following streams…"
    # rule sentence) precedes the first stream name; keep it as the segment note and
    # drop it from the body so it can't be mistaken for a stream.
    lines = body.split("\n")
    intro_parts: list[str] = []
    idx = 0
    for idx, line in enumerate(lines):
        if _is_dir_header_line(line, stream_mode=True) or ITEM_RE.match(line) or CODE_RE.search(line):
            break
        if line.strip():
            intro_parts.append(line.strip())
    else:
        idx = len(lines)
    intro_note = normalize_label(" ".join(intro_parts)) or None
    body = "\n".join(lines[idx:])
    letters = sum(1 for l in body.split("\n") if LETTER_MARKER_RE.match(l))
    directions = _letter_directions(body) if letters >= 2 else _prose_directions(body, stream_mode=True)
    if not directions:
        return None
    return {
        "marker": "",
        "kind": "stream",
        "title": "选修方向 · Streams",
        "units": None,
        "note": intro_note,
        "courses": [],
        "children": directions,
    }


# --------------------------------------------------------------------------- program
DEG_RE = re.compile(r"^(.*?)(?:\s+in\s+|\s+\(|\s+-\s+|$)")


def parse_program(rec: dict) -> dict:
    t = rec.get("study_scheme", "") or ""
    inv = sorted(set(c for c in CODE_RE.findall(t)) |
                 {c for grp in extract_courses(t) for c in grp["codes"]})
    deg_m = DEG_RE.match(rec["program_en"])
    out = {
        "program_en": rec["program_en"], "program_chi": rec["program_chi"],
        "admission_year": rec["admission_year"], "faculty": rec["faculty"],
        "degree": (deg_m.group(1).strip() if deg_m else "").rstrip("."),
        "total_units": None, "parse_status": "empty",
        "has_senior_year_variant": False, "has_streams": False,
        "all_course_codes": inv,
        "buckets": {"required": [], "elective": [], "stream_elective": []},
        "groups_outline": [],
        "structure": [],
    }
    if not t.strip():
        return out

    hits = find_sections(t)
    keyed = {k: p for p, k in hits}
    out["has_senior_year_variant"] = "senior_year" in keyed
    tm = re.search(r"minimum of (\d+)\s*units", norm(t))
    if tm:
        out["total_units"] = int(tm.group(1))

    if "major_requirement" in keyed:
        start = keyed["major_requirement"]
        # Optional post-total segments the calendar prints *after* the Major-block grand
        # total: "Concentration Area:" (kind='concentration') and "Streams:"
        # (kind='stream'). Each is only treated as a real, separate section when it sits
        # INSIDE the Major-block region — after the block's Total line and before the
        # first following *hard* section anchor (Explanatory Notes / Recommended Pattern /
        # senior-year variant / ELITE). This rejects a stray "Concentration Area:" /
        # "Stream:" buried deep in a later section (e.g. LL.B.'s concentration appears
        # inside the Recommended Course Pattern, ~15KB in). The structure tree itself
        # already stops at the block's Total line, so where exactly the block is cut only
        # affects which optional-segment courses the tree carries vs. the catch-all — no
        # Major course can ever be lost either way.
        OPTIONAL = ("concentration", "streams")
        hard = [p for p, k in hits if p > start and k not in OPTIONAL]
        first_hard = min(hard) if hard else len(t)
        optionals: list[tuple[int, str]] = []
        for p, k in hits:
            if p > start and k in OPTIONAL and start < p < first_hard and "Total" in t[start:p]:
                optionals.append((p, k))
        optionals.sort()
        cut_points = sorted(hard + [p for p, _ in optionals])
        block = t[start:(min(cut_points) if cut_points else len(t))]
        outline, leaves = parse_requirements(block)
        out["groups_outline"] = outline
        out["structure"] = build_structure(block)

        # Each optional segment spans from its own start to the next boundary (a hard
        # anchor or the next optional segment). Parse it into its kind-tagged node;
        # unrecognisable layouts return None and their courses fall through to the
        # catch-all (fb_text always includes the raw segment, so zero loss).
        bounds = sorted(hard + [p for p, _ in optionals])
        fb_text = block
        for pos, key in optionals:
            after = [b for b in bounds if b > pos]
            seg = t[pos:(min(after) if after else len(t))]
            fb_text = fb_text + "\n" + seg
            node = parse_streams(seg) if key == "streams" else parse_concentration(seg)
            if node is not None:
                out["structure"].append(node)

        fallback = build_fallback_node(fb_text, out["structure"])
        if fallback is not None:
            out["structure"].append(fallback)
        for lf in leaves:
            if lf["bucket"] == "stream_elective":
                out["buckets"]["stream_elective"].append(
                    {"stream": lf["stream"], "from": lf["from"], "courses": lf["courses"]}
                )
            else:
                out["buckets"][lf["bucket"]].extend(
                    {**c, "from": lf["from"]} for c in lf["courses"]
                )
        out["has_streams"] = bool(out["buckets"]["stream_elective"])

    if out["groups_outline"]:
        out["parse_status"] = "full" if out["total_units"] else "partial"
    elif inv:
        out["parse_status"] = "prose_only"
    return out


def main() -> None:
    files = sorted(glob.glob(os.path.join(IN_ROOT, "20*", "*", "*.json")))
    count = 0
    stats = {"full": 0, "partial": 0, "prose_only": 0, "empty": 0}
    for f in files:
        try:
            rec = json.load(open(f, encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue  # skip files mid-write (scraper may still be running)
        if "study_scheme" not in rec:
            continue
        p = parse_program(rec)
        stats[p["parse_status"]] += 1
        count += 1
        rel = os.path.relpath(f, IN_ROOT)
        out_path = os.path.join(OUT_ROOT, rel)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fo:
            json.dump(p, fo, ensure_ascii=False, indent=2)
            fo.write("\n")

    print(f"parsed {count} programs -> {OUT_ROOT}")
    print(f"  status: {stats}")
    print("  (run `npm run data:build` to fold these into data/programs/programs.json)")


if __name__ == "__main__":
    main()
