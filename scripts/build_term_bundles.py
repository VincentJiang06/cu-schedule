#!/usr/bin/env python3
"""
Build the compact per-term bundles the web app fetches.

The scraper (scripts/cuhk_scraper.py, vendored from EagleZhen/another-cuhk-course-planner)
writes one rich JSON per subject into data/<year>/<SUBJ>.json. Those files carry every
field the catalog exposes, across every term, and total tens of megabytes per year — far
too much to hand a browser.

This step pivots that raw shape into one file per term, keeping only the fields the UI
renders and pre-parsing meeting times into minute offsets so the client never re-parses
strings. A full undergraduate term lands around 1.8 MB raw / 0.2 MB gzipped, small enough
to load the entire catalog up front, which is what makes whole-catalog conflict filtering
possible.

Usage:
    uv run python scripts/build_term_bundles.py            # every year under data/
    uv run python scripts/build_term_bundles.py 2026-27    # one year
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

DATA_DIR = Path("data")
OUT_DIR = Path("public/data")

# "Th 1:30PM - 2:15PM"
TIME_RE = re.compile(
    r"^(?P<day>Mo|Tu|We|Th|Fr|Sa|Su)\s+"
    r"(?P<sh>\d{1,2}):(?P<sm>\d{2})(?P<sap>AM|PM)\s*-\s*"
    r"(?P<eh>\d{1,2}):(?P<em>\d{2})(?P<eap>AM|PM)$"
)
DAY_INDEX = {"Mo": 1, "Tu": 2, "We": 3, "Th": 4, "Fr": 5, "Sa": 6, "Su": 7}

# "AT01-TUT (1234)" -> cohort "A", group "T01", component "TUT", class number 1234.
# A leading "-" means the section carries no cohort letter ("--LEC", "-T01-TUT").
SECTION_RE = re.compile(r"^(?P<prefix>.*)-(?P<component>[A-Z]{3})\s*\((?P<class_no>\d+)\)$")
GROUP_RE = re.compile(r"^(?P<cohort>[A-Z]*?)(?P<group>[A-Z]\d+)?$")

TERM_NAME_RE = re.compile(r"^(\d{4}-\d{2})\s+(.+)$")

# Terms are listed in the order a student meets them, not alphabetically, so the
# app's default selection lands on Term 1 rather than "Acad Year (Medicine)".
TERM_ORDER = ["Term 1", "Term 2", "Summer Session"]


def term_rank(name: str) -> tuple:
    match = TERM_NAME_RE.match(name)
    suffix = match.group(2) if match else name
    year = match.group(1) if match else ""
    try:
        return (year, TERM_ORDER.index(suffix), suffix)
    except ValueError:
        return (year, len(TERM_ORDER), suffix)


def to_minutes(hour: str, minute: str, meridiem: str) -> int:
    value = int(hour) % 12
    if meridiem == "PM":
        value += 12
    return value * 60 + int(minute)


def parse_time(raw: str) -> dict | None:
    match = TIME_RE.match((raw or "").strip())
    if not match:
        return None
    start = to_minutes(match["sh"], match["sm"], match["sap"])
    end = to_minutes(match["eh"], match["em"], match["eap"])
    if end <= start:
        return None
    return {"d": DAY_INDEX[match["day"]], "s": start, "e": end}


def parse_section(raw: str) -> dict | None:
    match = SECTION_RE.match((raw or "").strip())
    if not match:
        return None
    prefix = match["prefix"].lstrip("-")
    group_match = GROUP_RE.match(prefix)
    if not group_match:
        # Unexpected shape; treat the whole prefix as a cohort so nothing silently merges.
        cohort, group = prefix, ""
    else:
        cohort = group_match["cohort"] or ""
        group = group_match["group"] or ""
    return {
        "cohort": cohort,
        "group": group,
        "component": match["component"],
        "class_no": int(match["class_no"]),
    }


def normalize_units(raw: str) -> float:
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def build_course(course: dict, term: dict) -> dict | None:
    sections = []
    for entry in term.get("schedule", []):
        parsed = parse_section(entry.get("section", ""))
        if not parsed:
            continue

        meetings = []
        seen = set()
        instructors = []
        for meeting in entry.get("meetings", []):
            instructor = (meeting.get("instructor") or "").strip()
            if instructor and instructor not in instructors:
                instructors.append(instructor)

            slot = parse_time(meeting.get("time", ""))
            if not slot:
                continue
            # The catalog repeats one weekly slot once per date range; collapse them.
            key = (slot["d"], slot["s"], slot["e"], meeting.get("location"))
            if key in seen:
                continue
            seen.add(key)
            meetings.append({**slot, "l": (meeting.get("location") or "").strip()})

        availability = entry.get("availability") or {}
        sections.append(
            {
                "id": str(parsed["class_no"]),
                "co": parsed["cohort"],
                "gp": parsed["group"],
                "cp": parsed["component"],
                "m": meetings,
                "in": instructors,
                "st": (availability.get("status") or "").strip(),
            }
        )

    if not sections:
        return None

    return {
        "c": f"{course['subject']}{course['course_code']}",
        "sj": course["subject"],
        "t": (course.get("title") or "").strip(),
        "u": normalize_units(course.get("credits")),
        "cr": (course.get("academic_career") or "").strip(),
        "gr": (course.get("academic_group") or "").strip(),
        "rq": (course.get("enrollment_requirement") or "").strip(),
        "x": sections,
    }


def build_year(year_dir: Path) -> None:
    by_term: dict[str, list] = defaultdict(list)
    term_codes: dict[str, str] = {}

    for path in sorted(year_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for course in payload.get("courses", []):
            for term in course.get("terms", []):
                name = (term.get("term_name") or "").strip()
                if not TERM_NAME_RE.match(name):
                    continue
                built = build_course(course, term)
                if built:
                    by_term[name].append(built)
                    term_codes[name] = term.get("term_code", "")

    out_year = OUT_DIR / year_dir.name
    out_year.mkdir(parents=True, exist_ok=True)

    terms_meta = []
    for name, courses in sorted(by_term.items(), key=lambda item: term_rank(item[0])):
        courses.sort(key=lambda item: item["c"])
        slug = name.lower().replace(" ", "-").replace("(", "").replace(")", "")
        target = out_year / f"{slug}.json"
        target.write_text(
            json.dumps(
                {"term": name, "termCode": term_codes[name], "courses": courses},
                ensure_ascii=False,
                separators=(",", ":"),
            )
            + "\n",
            encoding="utf-8",
        )
        size_mb = target.stat().st_size / 1e6
        terms_meta.append({"name": name, "slug": slug, "courseCount": len(courses)})
        print(f"  {name:<34} {len(courses):>5} courses  {size_mb:>5.2f} MB  -> {target}")

    (out_year / "index.json").write_text(
        json.dumps({"year": year_dir.name, "terms": terms_meta}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    if not DATA_DIR.is_dir():
        print(f"missing {DATA_DIR}/ — run the scraper first", file=sys.stderr)
        return 1

    requested = sys.argv[1:]
    year_dirs = [DATA_DIR / name for name in requested] if requested else sorted(
        path for path in DATA_DIR.iterdir() if path.is_dir() and re.fullmatch(r"\d{4}-\d{2}", path.name)
    )

    if not year_dirs:
        print("no year directories to build", file=sys.stderr)
        return 1

    manifest_years = []
    for year_dir in year_dirs:
        if not year_dir.is_dir():
            print(f"missing {year_dir}", file=sys.stderr)
            return 1
        print(f"{year_dir.name}:")
        build_year(year_dir)
        manifest_years.append(year_dir.name)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "manifest.json").write_text(
        json.dumps({"years": sorted(manifest_years, reverse=True)}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
