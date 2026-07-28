#!/usr/bin/env python3
"""裁决 parity 报告中的 missing_in_raw:逐门 detail 检查是否真在目标学年开课。

对 verify_catalog_parity.py 报出的每门「listing 有、raw 无」的课,用
only_course_codes 过滤只抓这些课的 detail(term 下拉框),判定:

  REAL_MISS            有目标学年学期 —— 真缺课,必须补抓入 raw
  confirmed_not_offered 无目标学年学期 —— 目录挂着但不开,排除正当

用法:
    uv run python scripts/adjudicate_missing.py --parity parity-report.json \
        [--year 2026-27] [--out adjudication.json]
"""

import argparse
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cuhk_scraper import CuhkScraper, ScrapingConfig  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parity", required=True)
    parser.add_argument("--year", default="2026-27")
    parser.add_argument("--out", default="adjudication.json")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
    log = logging.getLogger("adjudicate")

    with open(args.parity) as f:
        parity = json.load(f)["subjects"]

    plan = {
        subj: [m["code"] for m in v.get("missing_in_raw", [])]
        for subj, v in parity.items()
        if isinstance(v, dict) and v.get("missing_in_raw")
    }
    total = sum(len(v) for v in plan.values())
    log.info(f"adjudicating {total} missing courses across {len(plan)} subjects")

    result: dict = {}
    if args.resume and os.path.exists(args.out):
        with open(args.out) as f:
            result = json.load(f).get("subjects", {})
        log.info(f"resuming: {len(result)} subjects already adjudicated")

    for i, (subj, codes) in enumerate(sorted(plan.items())):
        if subj in result:
            continue
        four_digit = {c[len(subj) :] for c in codes}
        config = ScrapingConfig(
            max_courses_per_subject=None,
            save_debug_files=False,
            save_debug_on_error=False,
            get_details=True,
            get_enrollment_details=False,
            get_course_outcome=False,
            track_progress=False,
            term_prefix=args.year,
            only_course_codes=four_digit,
        )
        scraper = CuhkScraper(config)
        try:
            courses = scraper.scrape_subject(subj)
        except Exception as e:  # noqa: BLE001
            log.error(f"{subj}: adjudication scrape failed: {e}")
            result[subj] = {"error": str(e)}
            continue
        verdicts = {}
        for c in courses:
            terms = [t.term_name for t in c.terms]
            verdicts[subj + c.course_code] = {
                "terms": terms,
                "verdict": "REAL_MISS" if terms else "confirmed_not_offered",
            }
        # courses the filter didn't return at all (listing/detail drift) — flag loudly
        for code in codes:
            if code not in verdicts:
                verdicts[code] = {"terms": None, "verdict": "detail_unreachable"}
        n_miss = sum(1 for v in verdicts.values() if v["verdict"] == "REAL_MISS")
        result[subj] = {"verdicts": verdicts}
        log.info(f"[{i + 1}/{len(plan)}] {subj}: {len(codes)} checked, REAL_MISS={n_miss}")
        with open(args.out, "w") as f:
            json.dump({"year": args.year, "subjects": result}, f, ensure_ascii=False, indent=1)

    all_v = [v for s in result.values() if "verdicts" in s for v in s["verdicts"].values()]
    n_real = sum(1 for v in all_v if v["verdict"] == "REAL_MISS")
    n_ok = sum(1 for v in all_v if v["verdict"] == "confirmed_not_offered")
    n_un = sum(1 for v in all_v if v["verdict"] == "detail_unreachable")
    log.info(f"DONE: REAL_MISS={n_real} confirmed_not_offered={n_ok} unreachable={n_un}")


if __name__ == "__main__":
    main()
