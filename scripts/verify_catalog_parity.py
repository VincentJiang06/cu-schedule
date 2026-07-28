#!/usr/bin/env python3
"""权威源 parity 对账:线上目录逐 subject 课程清单 vs 本地 raw。

对每个线上下拉框 subject 拉一次 listing-only 搜索(无 detail/enrollment/outcome,
每 subject 约 2 次请求+验证码),得到该 subject 在目录中的全部课号+标题,与
data/raw/courses/<年>/<SUBJ>.json 对账。

差集语义:
  missing_in_raw  = listing 有、raw 无 —— 需逐门裁决:课在目录但可能只有旧学年
                    学期(raw 按学年拆分后正当排除),用 --adjudicate 跑第二遍
                    detail 检查;若有目标学年学期则为真缺课。
  extra_in_raw    = raw 有、listing 无 —— 课已从目录下架而 raw 未刷新,真陈旧。

用法:
    uv run python scripts/verify_catalog_parity.py [--year 2026-27] [--out report.json]

输出 JSON(每 subject 一条,含差集),逐 subject 落盘可断点续跑(--resume)。
"""

import argparse
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cuhk_scraper import CuhkScraper, ScrapingConfig  # noqa: E402

RAW_DIR = "data/raw/courses"


def load_raw_codes(year: str, subject: str) -> list[str]:
    path = os.path.join(RAW_DIR, year, f"{subject}.json")
    if not os.path.exists(path):
        return []
    with open(path) as f:
        data = json.load(f)
    return sorted({c["subject"] + c["course_code"] for c in data["courses"]})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", default="2026-27")
    parser.add_argument("--out", default="parity-report.json")
    parser.add_argument("--resume", action="store_true", help="skip subjects already in --out")
    parser.add_argument("subjects", nargs="?", help="comma list; default = live dropdown")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
    log = logging.getLogger("parity")

    config = ScrapingConfig(
        max_courses_per_subject=None,
        save_debug_files=False,
        save_debug_on_error=False,
        get_details=False,
        get_enrollment_details=False,
        get_course_outcome=False,
        track_progress=False,
    )
    scraper = CuhkScraper(config)

    if args.subjects:
        subjects = args.subjects.split(",")
    else:
        subjects = scraper.get_subjects_from_live_site()
        if not subjects:
            log.error("could not fetch subject dropdown")
            sys.exit(1)
    log.info(f"parity check over {len(subjects)} subjects, year {args.year}")

    report: dict = {}
    if args.resume and os.path.exists(args.out):
        with open(args.out) as f:
            report = json.load(f).get("subjects", {})
        log.info(f"resuming: {len(report)} subjects already done")

    for i, subj in enumerate(subjects):
        if subj in report:
            continue
        raw = load_raw_codes(args.year, subj)
        try:
            courses = scraper.scrape_subject(subj)
            # 偶发边缘:验证码通过但结果表为空。raw 明明有课时重试两次再定论,
            # 否则会把整个 subject 误报成 extra_in_raw(2026-07-28 GEYS/MIEG 实录)。
            for _ in range(2):
                if courses or not raw:
                    break
                log.warning(f"{subj}: empty listing but raw has {len(raw)} — retrying")
                courses = scraper.scrape_subject(subj)
            listing = sorted({subj + c.course_code for c in courses})
            titles = {subj + c.course_code: c.title for c in courses}
        except Exception as e:  # noqa: BLE001
            log.error(f"{subj}: listing failed: {e}")
            report[subj] = {"error": str(e)}
            continue
        missing = sorted(set(listing) - set(raw))
        extra = sorted(set(raw) - set(listing))
        report[subj] = {
            "listing_count": len(listing),
            "raw_count": len(raw),
            "missing_in_raw": [{"code": c, "title": titles.get(c, "")} for c in missing],
            "extra_in_raw": extra,
        }
        log.info(
            f"[{i + 1}/{len(subjects)}] {subj}: listing={len(listing)} raw={len(raw)} "
            f"missing={len(missing)} extra={len(extra)}"
        )
        with open(args.out, "w") as f:
            json.dump({"year": args.year, "subjects": report}, f, ensure_ascii=False, indent=1)

    n_missing = sum(len(v.get("missing_in_raw", [])) for v in report.values() if isinstance(v, dict))
    n_extra = sum(len(v.get("extra_in_raw", [])) for v in report.values() if isinstance(v, dict))
    n_err = sum(1 for v in report.values() if "error" in v)
    log.info(f"DONE: missing_in_raw={n_missing} extra_in_raw={n_extra} subject_errors={n_err}")


if __name__ == "__main__":
    main()
