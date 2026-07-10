# 第三方代码来源 / Third-Party Attribution

## another-cuhk-course-planner

以下文件复制自 [EagleZhen/another-cuhk-course-planner](https://github.com/EagleZhen/another-cuhk-course-planner)，
基本原样保留，仅做必要的路径适配：

```text
scripts/cuhk_scraper.py
scripts/scrape_all_subjects.py
scripts/data_utils.py
scripts/tests/test_cuhk_scraper.py
scripts/tests/test_data_utils.py
```

上游的 `scripts/generate_subjects.py` 未收录：它生成的是上游 Next.js 应用的 `web/src/lib/generated/subjects.ts`，
本项目的学科列表在运行时从课程数据里直接得出，收录它只会留下一份跑不通的死代码。

`data/` 下的原始课程 JSON 同样由上述抓取器产出。

上游项目版权归其作者 (EZ) 所有，以 GNU Affero General Public License v3.0 授权。
本项目因此同样以 AGPL-3.0 授权发布，完整条款见 [LICENSE](LICENSE)。

---

The files listed above are copied from
[EagleZhen/another-cuhk-course-planner](https://github.com/EagleZhen/another-cuhk-course-planner),
kept substantially unmodified apart from path adaptation. The raw course JSON under `data/`
is likewise produced by that scraper.

Copyright of the upstream project belongs to its author (EZ) and is licensed under the
GNU Affero General Public License v3.0. This project is therefore also distributed under
AGPL-3.0. See [LICENSE](LICENSE).

## 数据来源 / Data Source

Course data originates from the public
[CUHK Course Catalog](https://rgsntl.rgs.cuhk.edu.hk/aqs_prd_applx/Public/tt_dsp_crse_catalog.aspx).
This project is not affiliated with or endorsed by The Chinese University of Hong Kong.
