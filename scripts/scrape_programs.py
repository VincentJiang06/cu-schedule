#!/usr/bin/env python3
"""Scrape CUHK 'Browse Program Information' (tt_dsp_acad_prog.aspx) — UG program curricula.

Companion to the vendored course-catalog scraper. Where cuhk_scraper.py scrapes single
courses from tt_dsp_crse_catalog.aspx, this scrapes whole *programmes* (majors): each
programme's Learning Outcomes and Study Scheme (Major Programme Requirement + Recommended
Course Pattern), per admission year.

Mechanics (both pages are ASP.NET WebForms twins):
  1. GET the page -> read hidden state (__VIEWSTATE, __EVENTVALIDATION, ...) + captcha image.
  2. Solve the 4-char captcha with ddddocr; POST the search. Retry on "Invalid Verification
     Code" with a fresh captcha. One captcha-guarded search per admission year returns EVERY
     UG programme across ALL faculties (faculty left blank).
  3. For each programme row, ASP.NET __doPostBack into its detail page (no new captcha needed
     -- the results page's ViewState is reused, exactly like get_course_details does).
  4. Extract the two content spans and save.

CAPTCHA is auto-solved (OCR), never bypassed. The captcha widget is byte-for-byte the same
as the course-catalog page, so the ddddocr technique carries over unchanged.

Reuses techniques from scripts/cuhk_scraper.py
(EagleZhen/another-cuhk-course-planner, AGPL-3.0). This file is therefore also AGPL-3.0.

Output per programme:
    data/raw/programs/<year>/<Faculty>/<slug>.json      metadata + extracted text
    data/raw/programs/<year>/<Faculty>/<slug>.html.gz   COMPLETE raw detail page (lossless)
    data/raw/programs/index.json                        manifest of everything scraped

The .html.gz is the untouched server response, kept so later schema/post-processing can
re-parse from ground truth rather than trusting the text extraction. gunzip to inspect.

Usage:
    uv run python scripts/scrape_programs.py                 # years 2023 2024 2025
    uv run python scripts/scrape_programs.py 2024            # one year
    uv run python scripts/scrape_programs.py 2023 2024 2025  # several
    uv run python scripts/scrape_programs.py --force         # re-scrape (ignore existing)
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import ddddocr
import requests
from bs4 import BeautifulSoup

BASE_URL = "http://rgsntl.rgs.cuhk.edu.hk/aqs_prd_applx/Public/tt_dsp_acad_prog.aspx"
DIR_URL = "http://rgsntl.rgs.cuhk.edu.hk/aqs_prd_applx/Public/"

DEFAULT_YEARS = ["2023", "2024", "2025"]
CAREER = "UG"          # undergraduate only, per request
STUDY_LOAD = "F"       # Full-time
STUDY_MODE_LABEL = "Full-time"

OUT_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw", "programs")

REQUEST_DELAY = 1.0        # polite delay between programme postbacks (seconds)
CAPTCHA_MAX_TRIES = 25     # per-search captcha attempts (each search happens once per year)
POSTBACK_MAX_TRIES = 6     # per-programme detail retries
REQUEST_TIMEOUT = (10, 40) # (connect, read)

FACULTY_SHORT = {
    "Faculty of Arts": "Arts",
    "Faculty of Business Administration": "Business",
    "Faculty of Education": "Education",
    "Faculty of Engineering": "Engineering",
    "Faculty of Law": "Law",
    "Faculty of Medicine": "Medicine",
    "Faculty of Science": "Science",
    "Faculty of Social Science": "SocialScience",
    "Others": "Others",
}


def log(msg: str) -> None:
    print(f"{datetime.now().strftime('%H:%M:%S')} {msg}", flush=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slugify(name: str) -> str:
    s = re.sub(r"[^0-9A-Za-z]+", "-", name).strip("-")
    return s or "program"


def faculty_short(faculty: str) -> str:
    return FACULTY_SHORT.get(faculty, slugify(faculty))


class ProgramScraper:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Connection": "keep-alive",
            }
        )
        self.ocr = ddddocr.DdddOcr(show_ad=False)

    # ---- network with infinite retry on transient errors (mirrors cuhk_scraper) ----
    def _request(self, method: str, url: str, **kw) -> requests.Response:
        kw.setdefault("timeout", REQUEST_TIMEOUT)
        attempt = 0
        while True:
            try:
                r = self.session.request(method, url, **kw)
                r.raise_for_status()
                _ = r.content  # force read to surface connection resets here
                return r
            except (requests.ConnectionError, requests.Timeout) as e:
                attempt += 1
                wait = min(60, 2 ** (attempt - 1))
                log(f"  net issue (attempt {attempt}), retry in {wait}s: {e}")
                time.sleep(wait)
            except requests.HTTPError as e:
                code = e.response.status_code if e.response is not None else 0
                if code in (500, 502, 503, 504):
                    attempt += 1
                    wait = min(60, 2 ** (attempt - 1))
                    log(f"  server {code} (attempt {attempt}), retry in {wait}s")
                    time.sleep(wait)
                else:
                    raise

    @staticmethod
    def _hidden(soup: BeautifulSoup) -> dict:
        return {
            i["name"]: i.get("value", "")
            for i in soup.find_all("input", {"type": "hidden"})
            if i.get("name")
        }

    def _solve_captcha(self, soup: BeautifulSoup) -> str | None:
        img = soup.find("img", {"id": "imgCaptcha"})
        if not img or not img.get("src"):
            return None
        src = img["src"]
        url = src if src.startswith("http") else DIR_URL + src
        raw = self._request("GET", url).content
        text = str(self.ocr.classification(raw)).strip().upper()
        if len(text) == 4 and text.isalnum():  # server always uses 4 alnum chars
            return text
        return None

    # ---- one captcha-guarded search per year: all UG programmes, all faculties ----
    def search_year(self, year: str) -> str | None:
        for attempt in range(1, CAPTCHA_MAX_TRIES + 1):
            soup = BeautifulSoup(self._request("GET", BASE_URL).text, "html.parser")
            data = self._hidden(soup)
            captcha = self._solve_captcha(soup)
            if not captcha:
                continue
            data.update(
                {
                    "ddl_acad_career": CAREER,
                    "ddl_acad_year": year,
                    "ddl_faculty": "",            # blank -> every faculty at once
                    "ddl_acad_load": STUDY_LOAD,
                    "tb_prog_descr": "",
                    "tb_prog_descr_chi": "",
                    "txt_captcha": captcha,
                    "btn_search": "Search",
                }
            )
            resp = self._request("POST", BASE_URL, data=data)
            rs = BeautifulSoup(resp.text, "html.parser")
            err = rs.find("span", {"id": "lbl_error"})
            if err and "Invalid Verification Code" in err.get_text():
                log(f"  captcha '{captcha}' rejected ({attempt}/{CAPTCHA_MAX_TRIES})")
                time.sleep(0.4)
                continue
            if not rs.find("table", {"id": "gv_detail"}):
                log(f"  captcha '{captcha}' ok but no results table; retrying")
                continue
            log(f"  captcha '{captcha}' accepted for {year}")
            return resp.text
        return None

    @staticmethod
    def parse_rows(results_html: str) -> list[dict]:
        soup = BeautifulSoup(results_html, "html.parser")
        table = soup.find("table", {"id": "gv_detail"})
        rows: list[dict] = []
        if not table:
            return rows
        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 6:
                continue
            career = tds[0].get_text(strip=True)
            if career.lower() in ("", "academic career"):
                continue
            link = tds[4].find("a", href=re.compile("__doPostBack"))
            if not link:
                continue
            m = re.search(r"__doPostBack\('([^']+)','([^']*)'\)", link["href"])
            if not m:
                continue
            rows.append(
                {
                    "career": career,
                    "year": tds[1].get_text(strip=True),
                    "faculty": tds[2].get_text(strip=True),
                    "study_mode": tds[3].get_text(strip=True),
                    "program_en": tds[4].get_text(strip=True),
                    "program_chi": tds[5].get_text(strip=True),
                    "target": m.group(1),
                    "argument": m.group(2),
                }
            )
        return rows

    # ---- postback into a programme's detail page (reuses results-page ViewState) ----
    def open_program(self, results_html: str, row: dict) -> str:
        base_hidden = self._hidden(BeautifulSoup(results_html, "html.parser"))
        last_detail: str | None = None
        for attempt in range(1, POSTBACK_MAX_TRIES + 1):
            try:
                data = dict(base_hidden)
                data["__EVENTTARGET"] = row["target"]
                data["__EVENTARGUMENT"] = row.get("argument", "")
                resp = self._request("POST", BASE_URL, data=data)
                if "uc_scheme_lbl_study_scheme" not in resp.text:
                    raise ValueError("detail page missing study-scheme span")
                last_detail = resp.text
                # The postback intermittently returns a blank study-scheme span that
                # still contains the id. Retry a few times; the content is usually there.
                span = BeautifulSoup(resp.text, "html.parser").find(id="uc_scheme_lbl_study_scheme")
                if span and span.get_text(strip=True):
                    return resp.text
                log(f"    empty study_scheme span, retry {attempt}/{POSTBACK_MAX_TRIES}")
                time.sleep(1.5)
            except Exception as e:  # transient / corrupted HTML -> retry
                wait = min(30, 2 ** (attempt - 1))
                log(f"    postback retry {attempt}/{POSTBACK_MAX_TRIES} ({e}); wait {wait}s")
                time.sleep(wait)
        # Exhausted retries: keep the last response even if blank (genuinely empty
        # programmes exist), so it is saved rather than dropped.
        if last_detail is not None:
            return last_detail
        raise RuntimeError(f"failed to open programme {row['program_en']!r}")

    @staticmethod
    def _to_text(el) -> str:
        """Render a content span to readable text.

        The Study Scheme is a deeply nested *layout* table (spacer cells for
        indentation), so a real markdown/table conversion explodes into noise.
        Instead: cell boundary -> separator, row/<br> boundary -> newline, then
        drop empty cells and blank lines. Units stay on the line of their item.
        """
        if el is None:
            return ""
        frag = BeautifulSoup(str(el), "html.parser")
        for bad in frag.select(".noPrint"):
            bad.decompose()
        for bad in frag(["script", "style", "button"]):
            bad.decompose()
        sep = "\x1f"  # unit separator sentinel for cell boundaries
        for cell in frag.find_all(["td", "th"]):
            cell.append(sep)
        for tr in frag.find_all("tr"):
            tr.append("\n")
        for br in frag.find_all("br"):
            br.replace_with("\n")
        out: list[str] = []
        for line in frag.get_text().split("\n"):
            cells = [re.sub(r"\s+", " ", c).strip() for c in line.split(sep)]
            cells = [c for c in cells if c]
            if cells:
                joined = "  |  ".join(cells)
                if not out or out[-1] != joined:  # drop consecutive duplicates
                    out.append(joined)
        return "\n".join(out)

    def extract(self, detail_html: str) -> dict:
        soup = BeautifulSoup(detail_html, "html.parser")
        prog = soup.find(id="uc_scheme_lbl_prog_descr")
        year = soup.find(id="uc_scheme_lbl_acad_year")
        lo = soup.find(id="uc_scheme_lbl_learning_outcomes")
        ss = soup.find(id="uc_scheme_lbl_study_scheme")
        return {
            "program_en_detail": prog.get_text(strip=True) if prog else "",
            "acad_year_detail": year.get_text(strip=True) if year else "",
            "learning_outcomes": self._to_text(lo),
            "study_scheme": self._to_text(ss),
            "learning_outcomes_html": str(lo) if lo else "",
            "study_scheme_html": str(ss) if ss else "",
        }


def scrape(years: list[str], force: bool) -> None:
    scraper = ProgramScraper()
    os.makedirs(OUT_ROOT, exist_ok=True)
    manifest: list[dict] = []
    totals = {"scraped": 0, "skipped": 0, "failed": 0}

    for year in years:
        log(f"=== admission year {year}: searching (UG, all faculties, {STUDY_MODE_LABEL}) ===")
        results_html = scraper.search_year(year)
        if not results_html:
            log(f"!! {year}: could not pass captcha after {CAPTCHA_MAX_TRIES} tries; skipping year")
            continue
        rows = scraper.parse_rows(results_html)
        log(f"    {year}: {len(rows)} UG programmes found")
        seen_slugs: dict[str, int] = {}

        for i, row in enumerate(rows, 1):
            fac = faculty_short(row["faculty"])
            base = slugify(row["program_en"])
            key = f"{fac}/{base}"
            if key in seen_slugs:  # de-collide within a (year, faculty)
                seen_slugs[key] += 1
                base = f"{base}-{seen_slugs[key]}"
            else:
                seen_slugs[key] = 1
            out_dir = os.path.join(OUT_ROOT, year, fac)
            json_path = os.path.join(out_dir, base + ".json")
            html_path = os.path.join(out_dir, base + ".html.gz")
            rel = os.path.relpath(json_path, OUT_ROOT)

            if os.path.exists(json_path) and not force:
                log(f"    [{i}/{len(rows)}] skip (exists): {rel}")
                totals["skipped"] += 1
                try:
                    manifest.append(json.load(open(json_path, encoding="utf-8"))["_manifest"])
                except Exception:
                    pass
                continue

            log(f"    [{i}/{len(rows)}] {row['program_en']}  ->  {rel}")
            try:
                detail_html = scraper.open_program(results_html, row)
                content = scraper.extract(detail_html)
            except Exception as e:
                log(f"        FAILED: {e}")
                totals["failed"] += 1
                continue

            manifest_entry = {
                "admission_year": year,
                "academic_career": CAREER,
                "faculty": row["faculty"],
                "faculty_short": fac,
                "study_mode": STUDY_MODE_LABEL,
                "program_en": row["program_en"],
                "program_chi": row["program_chi"],
                "file": rel,
                "has_learning_outcomes": bool(content["learning_outcomes"]),
                "study_scheme_chars": len(content["study_scheme"]),
            }
            record = {
                "admission_year": year,
                "academic_career": CAREER,
                "faculty": row["faculty"],
                "study_mode": STUDY_MODE_LABEL,
                "program_en": row["program_en"],
                "program_chi": row["program_chi"],
                "language": "English",
                "source_url": BASE_URL,
                "scraped_at_utc": utc_now(),
                "learning_outcomes": content["learning_outcomes"],
                "study_scheme": content["study_scheme"],
                "raw_html_file": os.path.basename(html_path),
                "_manifest": manifest_entry,
            }

            os.makedirs(out_dir, exist_ok=True)
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(record, f, ensure_ascii=False, indent=2)
                f.write("\n")
            # complete, untouched detail page — lossless ground truth for post-processing
            with gzip.open(html_path, "wt", encoding="utf-8") as f:
                f.write(detail_html)
            manifest.append(manifest_entry)
            totals["scraped"] += 1
            time.sleep(REQUEST_DELAY)

    index = {
        "generated_at_utc": utc_now(),
        "source_url": BASE_URL,
        "academic_career": CAREER,
        "study_mode": STUDY_MODE_LABEL,
        "years": years,
        "program_count": len(manifest),
        "programs": sorted(
            manifest, key=lambda m: (m["admission_year"], m["faculty_short"], m["program_en"])
        ),
    }
    with open(os.path.join(OUT_ROOT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")

    log(
        f"=== done: scraped={totals['scraped']} skipped={totals['skipped']} "
        f"failed={totals['failed']} | manifest={len(manifest)} -> {os.path.join(OUT_ROOT, 'index.json')}"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("years", nargs="*", help=f"admission years (default: {' '.join(DEFAULT_YEARS)})")
    ap.add_argument("--force", action="store_true", help="re-scrape even if output JSON exists")
    args = ap.parse_args()
    years = args.years or DEFAULT_YEARS
    for y in years:
        if not re.fullmatch(r"\d{4}", y):
            sys.exit(f"bad year: {y!r}")
    scrape(years, args.force)


if __name__ == "__main__":
    main()
