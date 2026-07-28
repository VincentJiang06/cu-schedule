#!/usr/bin/env python3
"""serper 逐课号公网检索验证:每个课号搜 Google,确认可检索性。

对 app 可搜索语料(data/courses/<年>/ 各 term bundle 的全部唯一课号)逐一调
serper.dev 搜索 `"<课号>" CUHK`,按命中质量分类:

  cuhk_hit         cuhk.edu.hk 域名结果中含课号 —— 最强佐证
  web_hit          其他公网结果含课号(课评站/GitHub/RMP 等)
  cuhk_domain_only 有 cuhk.edu.hk 结果但未含课号(弱佐证)
  no_hit           公网零命中 —— 不等于数据错误(新课/PG 课常未被索引),
                   须与 parity 对账交叉裁决:目录里有即为真课
  error            重试后仍失败

用法:
    SERPER_API_KEY=... uv run python scripts/verify_serper.py [--year 2026-27] \
        [--out serper-report.jsonl] [--workers 5]

JSONL 逐行落盘,天然断点续跑(重跑自动跳过已完成课号)。
成本:1 credit/课号,5530 门 ≈ 5530 credits。
"""

import argparse
import glob
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

API = "https://google.serper.dev/search"


def load_codes(year: str) -> dict[str, str]:
    codes: dict[str, str] = {}
    for path in sorted(glob.glob(f"data/courses/{year}/{year}-*.json")):
        with open(path) as f:
            bundle = json.load(f)
        for c in bundle["courses"]:
            codes.setdefault(c["c"], c["t"])
    return codes


def classify(code: str, organic: list[dict]) -> str:
    code_l = code.lower()

    def has_code(r: dict) -> bool:
        return code_l in (r.get("title", "") + r.get("snippet", "") + r.get("link", "")).lower()

    cuhk = [r for r in organic if "cuhk.edu.hk" in r.get("link", "")]
    if any(has_code(r) for r in cuhk):
        return "cuhk_hit"
    if any(has_code(r) for r in organic):
        return "web_hit"
    if cuhk:
        return "cuhk_domain_only"
    return "no_hit"


def query_one(key: str, code: str, title: str) -> dict:
    body = json.dumps({"q": f'"{code}" CUHK', "num": 10}).encode()
    for attempt in range(5):
        req = urllib.request.Request(
            API, data=body, headers={"X-API-KEY": key, "Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            organic = data.get("organic", [])
            return {
                "code": code,
                "title": title,
                "class": classify(code, organic),
                "results": len(organic),
                "top": organic[0].get("link") if organic else None,
            }
        except urllib.error.HTTPError as e:
            if e.code == 429:  # rate limited — back off harder
                time.sleep(5 * (attempt + 1))
            else:
                time.sleep(2 * (attempt + 1))
        except Exception:  # noqa: BLE001
            time.sleep(2 * (attempt + 1))
    return {"code": code, "title": title, "class": "error"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", default="2026-27")
    parser.add_argument("--out", default="serper-report.jsonl")
    parser.add_argument("--workers", type=int, default=5)
    args = parser.parse_args()

    key = os.environ.get("SERPER_API_KEY")
    if not key:
        print("SERPER_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    codes = load_codes(args.year)
    done: set[str] = set()
    if os.path.exists(args.out):
        with open(args.out) as f:
            for line in f:
                try:
                    rec = json.loads(line)
                    if rec.get("class") != "error":
                        done.add(rec["code"])
                except json.JSONDecodeError:
                    pass
    todo = sorted(c for c in codes if c not in done)
    print(f"{len(codes)} codes total, {len(done)} done, {len(todo)} to query")

    lock = threading.Lock()
    counts: dict[str, int] = {}
    with open(args.out, "a") as out, ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(query_one, key, c, codes[c]): c for c in todo}
        for i, fut in enumerate(as_completed(futures)):
            rec = fut.result()
            with lock:
                out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                out.flush()
                counts[rec["class"]] = counts.get(rec["class"], 0) + 1
                if (i + 1) % 200 == 0:
                    print(f"{i + 1}/{len(todo)} {counts}", flush=True)
    print(f"DONE {counts}")


if __name__ == "__main__":
    main()
