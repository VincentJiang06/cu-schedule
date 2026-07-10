# 数据契约与多用户访问设计

回答一个核心问题:**"很多用户同时使用这个网页实例,行不行?"——行,而且这正是本架构
最擅长的场景。** 本文说明为什么,并把前端消费的数据契约(实际上就是我们的"API")
一次性定清楚。

---

## 1. 并发模型:静态实例,服务端零计算

本应用没有传统后端。所谓"接口"是一组**不可变的静态 JSON 文件**;排课、冲突检测、
可选课筛选、先修判断全部在**每个用户自己的浏览器**里执行。

由此得到的并发性质:

| 性质 | 说明 |
| --- | --- |
| 无共享可变状态 | 用户之间没有任何交互;一个用户的操作不可能影响另一个 |
| 读路径全静态 | 每个用户下载同一份文件,CDN/静态托管天然横向扩展 |
| 服务端零计算 | 没有每请求的服务器工作,不存在"算力被打爆" |
| 写路径不存在 | 用户状态只在各自的 localStorage;数据更新是维护者手动构建+推送 |

**容量估算**(实测 gzip 体积):首屏全量 ≈ Term1 218KB + Term2 215KB + subjects 3KB +
manifest/index <1KB ≈ **446KB**;接入 programs.json 后 +88KB ≈ **534KB**。
1 万次完整加载 ≈ 5.4GB 流量——Cloudflare Pages(免费、不限流量)随便扛;
GitHub Pages(100GB/月软限)约可支撑 18 万次加载/月。二次访问命中 HTTP 缓存,
接近零流量。

**结论:只要保持"目录数据走静态文件、计算留在客户端"这条线,并发不是问题,
也永远不要为目录数据建动态 API。**

---

## 2. 数据契约(前端消费的"只读端点")

所有文件位于 `<BASE>/data/` 下,由 `npm run data:build` 从 `data/` 真源生成。
TS 类型的唯一权威在 `src/lib/types.ts`(课程侧)与 `src/lib/programs.ts`(方案侧)。

| 文件 | 形状(权威类型) | 变更时机 | 缓存策略 |
| --- | --- | --- | --- |
| `manifest.json` | `{ years: string[], generatedAt: string }` | 每次数据构建 | **no-cache(每次再验证)**,35B |
| `<年>/index.json` | `YearIndex`:该学年 term 清单+课数 | 每次数据构建 | `?v=` 版本化,不可变 |
| `<年>/<term>.json` | `TermBundle`:整学期课程包(短键,含预解析 `req`) | 每次数据构建 | `?v=` 版本化,不可变 |
| `<年>/subjects.json` | `{ subjects: {code,title}[] }` | 每次数据构建 | `?v=` 版本化,不可变 |
| `programs.json` | 见 `programs.ts` 的 `Program` | 方案数据重建时 | `?v=` 版本化,不可变 |

### 版本与缓存协议(核心)

数据是**维护者手动更新**的(Opus 指引的抓取→构建→提交→部署),更新频率低但更新后
必须让所有用户尽快看到新数据。协议:

1. `manifest.json` 携带 `generatedAt`(构建时刻 ISO UTC)= 整套数据的 **dataVersion**。
2. 前端以 `cache: 'no-cache'` 获取 manifest(强制 HTTP 再验证,代价 35 字节)。
3. 其后**所有**数据请求 URL 追加 `?v=<generatedAt>`——版本变则 URL 变,旧缓存自然
   失效;版本不变则长期命中缓存。
4. 客户端 localStorage 中缓存的派生数据(若将来有)一律带 dataVersion 校验,不匹配即弃。

这让"手动更新"获得与内容寻址等价的缓存语义,而无需重命名文件。

### 启动请求序列

```
manifest.json (no-cache, 35B)
  → <年>/index.json (?v=)            term 清单
  → <年>/term-1.json + term-2.json (?v=, 并行)   全年目录
  → <年>/subjects.json (?v=)
  → programs.json (?v=, 接入后)
```

已知小毛病(P2,不阻塞):`index.json` 目前被 `loadTermList` 与 `loadYearOfferings`
各取一次(重复一次 200/304);`programs.json` 字段为 snake_case 而课程包为短键——
两者均已被类型覆盖,统一留待下次 wire 格式变更时顺手做,不单独发版本。

---

## 3. 将来若要"用户账号/多设备同步"(可选,当前不做)

当前用户状态(`taken`、每学期的 `committed`)存 localStorage,单设备够用。
若将来要登录同步,原则不变:**目录仍走静态,只为用户状态建一个微型 API。**

- 状态模型(注意语义拆分,localStorage 现状是混存的,API 化时必须拆):
  `taken: string[]` 是**跨学期全局**的;`committed` 是 **per-term** 的。
  ```json
  { "taken": ["CSCI1130"],
    "selections": { "2026-27-term-1": { "committed": ["MATH2050"] } },
    "updatedAt": "…" }
  ```
- 接口只需两个:`GET /api/v1/me`、`PUT /api/v1/me`(整体读写,`If-Match` ETag,
  409 冲突由客户端合并重试)。每用户数据 <2KB、互相独立,并发依旧平凡。
- 服务端仍然零计算:排课/筛选不上服务器。
- 未登录/离线:localStorage 继续作为本地模式;登录时做一次性合并,此后以服务端为准。

## 4. 合规

以网络服务形式提供本应用受 **AGPL-3.0 §13** 约束:界面必须提供完整源码入口。
页脚已含 GitHub 仓库链接,部署时保留即可。
