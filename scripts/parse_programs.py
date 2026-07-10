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


def norm(t: str) -> str:
    return re.sub(r"\s+", " ", t).strip()


# --------------------------------------------------------------------------- courses
def extract_courses(text: str) -> list[dict]:
    """Extract course references from a chunk of requirement text.

    Handles:
      * canonical codes            CENG2010
      * '/ESTR' alternatives       CSCI2100/ESTR2102  -> one entry, alt=True
      * shorthand continuation     'CENG2010, 2030'   -> CENG2010, CENG2030
    Returns a de-duplicated list of {raw, codes, alt} in first-seen order.
    Note refs like '[b]' and prose ('Chemistry Courses:') are ignored.
    """
    out: list[dict] = []
    seen: set[str] = set()
    current_subj: str | None = None
    last_end: int | None = None
    last_was_course = False
    # token = a code (with optional /alts) OR a bare 4-digit number
    token_re = re.compile(r"[A-Z]{4}\d{4}(?:/[A-Z]{4}\d{4})*|(?<![A-Za-z0-9])\d{4}(?![0-9])")
    for tok in token_re.finditer(text):
        s = tok.group(0)
        if s[0].isalpha():
            current_subj = s[:4]
            raw = s
        else:
            # bare number: expand ONLY if it directly continues a course list,
            # i.e. the gap since the last accepted course is just spaces/commas.
            # Kills false positives like "at 1000 or 2000 level", "6 units".
            gap = text[last_end:tok.start()] if last_end is not None else "x"
            if current_subj and last_was_course and re.fullmatch(r"[\s,]*", gap):
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
    for line in block.split("\n"):
        m = ITEM_RE.match(line)
        if m:
            marker, rest = m.group(1), m.group(2)
            um = re.search(r"\|\s*([\d\-]+)\s*$", rest)
            units = um.group(1) if um else None
            title = norm(re.sub(r"\|\s*[\d\-]+\s*$", "", rest)).rstrip(":")
            cur = {
                "marker": marker, "level": marker_level(marker), "title": title,
                "units": units, "text": [rest],
            }
            rows.append(cur)
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
        ends = [p for p, k in hits if p > start]
        block = t[start:(min(ends) if ends else len(t))]
        outline, leaves = parse_requirements(block)
        out["groups_outline"] = outline
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
