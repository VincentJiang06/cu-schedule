# CU Schedule · 中大选课助手

从"我要上哪几门课"和"我已经上过哪几门课"出发，自动排出课表，并主动筛选出**这学期你还能选什么**。

界面只做一件事：把整张课表和整张可选课表同时放进一屏，不用来回滚动。

---

## 它做什么

1. **输入两组课号**。要上的课，和上过的课。都支持整段粘贴（`MATH2050, CSCI2100 ENGG1110`），也支持按课名/教师搜索。
2. **自动排课表**。系统枚举每门课的 section 组合，遵守 CUHK 的 cohort 配对规则（`A-LEC` 只配 `AT01-TUT`、`AE01-EXR`，不配 `BT01-TUT`），排除时间冲突，给出若干种可行排法，按上课天数从少到多排序。
3. **主动筛可选课**。对全学期每一门课，判断它能不能放进你当前的课表：

   | 状态 | 含义 |
   | --- | --- |
   | 可选 | 至少有一种上课组合能直接放进当前排法 |
   | 换排法 | 和当前排法冲突，但换一种排法就放得下 |
   | 冲突 | 所有组合都和你确定要上的课冲突 |
   | 待定 | 本学期尚未公布上课时间 |

4. **读懂选课限制**。课程目录里的 `enrollment_requirement` 是自由文本，我们只解析能确定解析的部分：
   - `Not for students who have taken X` —— 你修过 X，这门课直接从表里移除。
   - `Pre-requisite: A or B` —— 两门都没修过，标一个「缺先修」。
   - 混杂 `and` / `or` 的复合先修（如 `Prerequisite: BCME1205, 2001 and 2201`）**不解析**。宁可不提示，也不给错误提示。

时间偏好（不上早课 / 不上夜课 / 留出午休 / 某天空堂）是硬约束，会直接参与排课与筛选。

---

## 数据从哪来

课程数据抓取自 [CUHK 公开课程目录](https://rgsntl.rgs.cuhk.edu.hk/aqs_prd_applx/Public/tt_dsp_crse_catalog.aspx)。

**抓取管线整套来自 [EagleZhen/another-cuhk-course-planner](https://github.com/EagleZhen/another-cuhk-course-planner)**，包括 `scripts/cuhk_scraper.py`、`scripts/scrape_all_subjects.py`、`scripts/data_utils.py` 及其测试。这些文件基本原样保留。向作者致敬 —— 抓一个会变的、带验证码的、HTML 结构不稳定的教务系统，是这个项目里最脏也最有价值的一段工作，我们没有重造它。

我们自己写的只有 `scripts/build_term_bundles.py`：把抓下来的、按学科分文件的完整数据，压成前端要的**按学期**精简包。

```text
CUHK 公开课程目录（外部）
    ↓  scripts/scrape_all_subjects.py        （来自 EagleZhen）
data/<year>/<SUBJ>.json                       ~38 MB / 学年
    ↓  scripts/build_term_bundles.py          （本项目）
public/data/<year>/<term>.json                ~1.8 MB / 学期（gzip 后 ~220 KB）
    ↓
前端一次性加载整个学期
```

前端一次性把整学期 2973 门课全部读进内存，是"主动筛选可选课"能成立的前提 —— 每次改动课表都要对全目录重算一遍状态。压到 220 KB 才让这件事变得可行。

### 更新数据

```bash
uv sync                                        # 装 Python 依赖
uv run python scripts/scrape_all_subjects.py   # 抓全部学科（慢，有验证码）
uv run python scripts/scrape_all_subjects.py CSCI,MATH   # 只抓几个学科
python3 scripts/build_term_bundles.py          # 生成前端数据包
```

---

## 开发

```bash
npm install
npm run dev
npm run build
```

---

## 许可证

本项目以 **AGPL-3.0** 发布，见 [LICENSE](LICENSE)。

这不是一个自由选择：`scripts/` 下的抓取器直接来自 AGPL-3.0 授权的 `EagleZhen/another-cuhk-course-planner`，AGPL 的传染性条款要求任何包含它的衍生作品同样以 AGPL-3.0 发布，且通过网络提供服务时必须向用户提供完整源码。

---

## 免责声明

名额、Closed 状态、开课与否都会实时变化。**最终选课前请回 CUSIS 核对。**
