# Physics Papers Hub

[English](./README.md) | [简体中文](./README.zh-CN.md)

这是一个使用 Next.js 和 TypeScript 构建的物理论文追踪工具，汇总 arXiv quant-ph 和部分期刊的近期论文，提供来源与主题筛选、关键词搜索、原文链接和本地收藏。当前主题配置重点关注量子信息、不定因果序和量子精密测量。

本说明介绍项目已经实现的功能，不代表系统能够收集全部论文，也不代表云端部署已经正常运行。应用界面目前使用英文；中英文 README 介绍的功能保持一致。

## 目录

- [功能概览](#features)
- [论文来源](#sources)
- [主题与分类](#classification)
- [数据流程与存储](#storage)
- [本地运行](#local-setup)
- [环境变量](#environment)
- [Vercel 部署](#deployment)
- [API 说明](#api)
- [测试](#tests)
- [项目结构](#structure)
- [常见问题](#troubleshooting)
- [当前限制与后续方向](#limitations)
- [文档维护](#maintenance)

<a id="features"></a>
## 功能概览

- 首页：论文卡片展示标题、作者、摘要、来源、发表日期、主题评分及 DOI/arXiv 链接。缺失的元数据会明确标识，不会仅因元数据缺失就隐藏论文。
- 组合筛选：支持来源、主题、发表时间窗口和关键词。多个来源或主题之间按**任一命中**匹配，不同筛选维度之间按 **AND（同时满足）** 组合。
- 搜索范围：标题 + 作者 + 摘要、仅标题、仅作者或仅摘要。搜索采用不区分大小写的子字符串匹配，不是语义搜索，也不解析布尔检索表达式。
- 展示窗口：支持 7、3、1 个 UTC 日历日，以刷新时间为基准。7 天窗口从刷新日期之前第六天的 UTC 00:00 开始，到刷新时刻结束，并非滚动的 168 小时区间。
- 排序：按发表时间从新到旧或从旧到新排列；时间相同时依次按来源名称、标题排序。
- 主题快捷入口：All topics、Quantum information、Unclassified 和 Low confidence。Unclassified 选择 `other` 标签；Low confidence 包含 `pending`、`low_confidence` 和 `failed` 状态。
- 来源状态：默认收起，可通过鼠标或键盘展开，展示缓存数量、尝试与成功时间、警告，并突出显示连续失败的来源。
- Weekly Source Trends：分别展示 arXiv 和期刊趋势，并提供颜色一致的主题趋势。来源图统计各来源缓存中的记录；主题图按每个已分配主题统计去重后的论文。因此不同图表的总数可能不同，也不代表整个研究领域的发文总量。切换到该视图不会额外请求上游数据。
- 收藏：通过 Save/Saved 按钮将论文保存在当前浏览器的 `localStorage` 中，不提供账号或跨设备同步。收藏的论文在离开当前日期窗口后仍可显示。
- 阅读界面：支持浅色与深色主题、桌面侧栏、移动端导航、滚动超过 300px 后返回顶部，以及从其他视图返回首页时恢复滚动位置。
- 刷新：提供手动刷新按钮、请求触发的过期缓存刷新，以及已配置的每日 Vercel Cron 路由。
- 可选 Neon Postgres 持久化和模型辅助多标签分类。人工修正主题需要数据库正常工作。

<a id="sources"></a>
## 论文来源

启用的来源及其接口地址定义在 [sources.json](./sources.json) 中。

| 来源 ID | 显示名称 | 抓取方式 | Crossref ISSN |
| --- | --- | --- | --- |
| `arxiv-quant-ph` | arXiv quant-ph | arXiv API | 不适用 |
| `prl` | PRL | RSS + Crossref | `0031-9007` |
| `pra` | PRA | RSS + Crossref | `2469-9926` |
| `prx` | PRX | RSS + Crossref | `2160-3308` |
| `prx-quantum` | PRX Quantum | RSS + Crossref | `2691-3399` |
| `nature-physics` | Nature Physics | RSS + Crossref | `1745-2473` |
| `physical-review-research` | Physical Review Research | RSS + Crossref | `2643-1564` |
| `npj-quantum-information` | npj Quantum Information | RSS + Crossref | `2056-6387` |
| `new-journal-of-physics` | New Journal of Physics | RSS + Crossref | `1367-2630` |
| `quantum` | Quantum | RSS + Crossref | `2521-327X` |

对于这些期刊，系统并行请求 RSS 和 Crossref，然后合并结果。因此 Crossref 既用于补充数据，也用于故障回退，不是仅在 RSS 失败后才请求。项目支持 RSS 2.0、Atom 和 RDF RSS 1.0。

Quantum 使用 `https://quantum-journal.org/feed/`，只接受链接位于 `https://quantum-journal.org/papers/` 下的 RSS 条目。npj Quantum Information 使用 `https://www.nature.com/npjqi.rss`；仅重复标题的出版通知不会被视为摘要。

Communications Physics 和 Journal of Physics A 已不再启用。恢复缓存时会按当前配置核对启用的来源；数据库中可能仍有已停用来源的旧记录，但不会将它们加入当前论文列表或来源趋势。浏览器收藏属于独立保存的记录。

**覆盖范围限制：** arXiv 当前只获取最新的 120 条记录，没有分页。期刊 Crossref 请求使用 `max(rows, 250)`，当前每次请求为 250 条，同样没有分页。RSS 条目数量和上游索引延迟还可能进一步限制覆盖范围。

<a id="classification"></a>
## 主题与分类

[topics.json](./topics.json) 控制主题顺序、名称、描述、颜色、关键词和短语。界面标签保持英文。

| 主题 ID | 界面标签 |
| --- | --- |
| `indefinite-causal-order` | Indefinite Causal Order & Quantum Switch |
| `quantum-metrology` | Quantum Metrology |
| `quantum-information` | Quantum Information |
| `quantum-computing` | Quantum Computing |
| `quantum-optics` | Quantum Optics & Photonics |
| `atomic-molecular-optical` | Atomic, Molecular & Optical Physics |
| `other` | Other / Unclassified |

分类逻辑实现在 [lib/classifier.ts](./lib/classifier.ts) 中：

1. 规范化标题和摘要文本，处理大小写、重音符号、分隔符及简单复数形式。按完整词或短语匹配，提高标题中证据的权重，并避免嵌套词语重复计分。
2. 独立评估每个主题，允许输出多个标签。期刊名称不作为分类证据。
3. 规则明确命中时直接采用结果。否则，在配置 `OPENAI_API_KEY` 时进行可选模型复核；没有配置时，保留暂定的规则标签或 Other / Unclassified。
4. 模型复核使用 Responses API、配置中的主题定义和经过校验的结构化输出。系统会向 OpenAI 发送标题及最多 8,000 个字符的摘要；启用该功能涉及外部数据处理和 API 使用费用。
5. 每次聚合最多尝试八次模型请求，每次请求超时为 12 秒，不立即重试。请求失败或预算耗尽时，论文仍正常显示，并标记为 `pending`。Pending/failed 结果在一小时后可由后续请求触发重试，不存在独立后台工作进程。
6. 保存标签、分类方式、置信度、分类器版本和时间。当规范化后的标题、摘要、主题定义或模型模式/名称改变时，`topics-v2` 内容与配置指纹也会改变。
7. 优先复用仍有效的人工标签，不以自动结果覆盖。已停用标签会被隐藏；只有停用标签的记录可以重新分类。人工有意设置的空标签列表会保留。

评分属于启发式指标，**不是经过校准的概率，也不是准确率保证**。摘要缺失或过短时（规范化或去除首尾空白后不足约 60 个字符），置信度上限为 0.64。当前分类器采用规则与可选的零样本模型复核，并非基于专家标注语料训练的监督分类器。[分类回归测试](./tests/topic-regression.test.ts) 展示了已测试的案例，不能据此估计真实场景准确率。

<a id="storage"></a>
## 数据流程与存储

主要流程如下：

```text
页面/API 请求 -> 加载来源状态 -> 按需刷新
-> 抓取/补全 -> 规范化与 UTC 窗口过滤 -> 来源缓存
-> 去重 -> 复用/计算主题分类 -> 持久化 -> 返回结果
```

- 每个来源独立刷新。抓取失败，或当前窗口没有新结果但存在可用旧数据时，会保留该来源之前的缓存。保留的旧论文仍需经过展示窗口筛选。
- 默认缓存有效期为 30 分钟，在请求到达时检查，不是本地定时器。首次请求和新加入的来源可能触发抓取。浏览器筛选使用已经加载的数据。
- RSS 论文的 DOI 元数据补全依次尝试 Crossref、OpenAlex、Semantic Scholar，最后尝试出版商/DOI 落地页 HTML。HTML 回退逻辑提取 JSON-LD、元数据和摘要容器；项目不下载或解析全文 PDF。
- 去重键按以下优先级选择：规范化 DOI、arXiv ID、规范化 URL、规范化标题 + 第一作者。每个键保留一条优选记录。论文 ID 由该键生成，因此补全原本缺失的 DOI 后，ID 可能改变；不能保证合并预印本和期刊版本。
- 聚合过程会等待分类和持久化完成。这不是持久化任务队列；读取页面或 API 也可能触发写入及可选模型调用。

未设置任一数据库 URL 时，服务端数据保存在实例内部的临时内存中，重启或冷启动后会丢失。收藏和主题外观设置保存在浏览器本地，与服务端存储相互独立。

使用有效的 Neon 连接时，[lib/database.ts](./lib/database.ts) 会在首次使用时创建以下表和所需索引：

| 数据表 | 用途 |
| --- | --- |
| `papers` | 元数据、分类状态/版本/时间、首次与最后发现时间 |
| `source_states` | 各来源缓存论文、状态、错误及连续失败次数 |
| `refresh_runs` | 刷新触发方式、开始/结束时间、数量及执行结果 |
| `topics` | 配置中的主题定义 |
| `paper_topics` | 多标签分配、置信度、分类方式及人工标记 |

数据库连接角色需要具有创建/更新数据库结构的权限。初始化逻辑不是通用的数据库迁移系统。项目使用 `@neondatabase/serverless` 驱动，通过 Neon 的 HTTP 接口访问数据库；仅支持普通 TCP 连接的任意 Postgres URL 不能直接替代 Neon 连接。

当前页面/API 读取近期来源缓存，**不是查询整个历史 `papers` 表**。界面展示最近一次刷新摘要，没有可浏览全部刷新历史的页面。`Storage: Postgres` 表示已配置 URL，不表示连接检查成功。数据库错误被捕获后，页面可能仍可使用，但不保证数据已经持久化。在内存模式下，`newPaperCount` 为 0，不能用它可靠地统计新发现的论文。

<a id="local-setup"></a>
## 本地运行

使用 Node.js 24.x 和 npm。根目录的软件包声明仍为 `>=18.17.0`，但已安装的 Neon 驱动要求 `>=19.0.0`，因此不要依赖 Node.js 18 运行完整项目。本地与部署环境应保持相同的 Node.js 主版本；参见 [Vercel 的 Node.js 版本说明](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)。

在项目根目录执行：

```bash
npm ci
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次抓取与补全可能需要一定时间，并要求能够访问上游网络。需要更换端口时执行：

```bash
npm run dev -- --port 3001
```

基础内存模式预览不需要数据库或模型密钥。需要配置相关服务时，仅在 `.env.local` 尚不存在的情况下复制 [.env.example](./.env.example)：

```bash
cp .env.example .env.local
```

PowerShell 对应命令：

```powershell
Copy-Item .env.example .env.local
```

**重启前先修改配置：** 示例数据库 URL 和令牌都是占位符，不是有效凭据。使用内存模式时，从本地配置中删除 `DATABASE_URL` 和 `POSTGRES_URL`，并确认没有从终端环境继承这两个变量。使用数据库模式时，填写真实的 Neon 连接字符串。将令牌占位符替换为不同的随机密钥；示例联系邮箱应改为自己的邮箱或删除。不设置 `OPENAI_API_KEY` 或将其留空即可只使用规则分类。不要提交真实密钥。

本地生产构建与启动：

```bash
npm run build
npm run start
```

这会启动应用服务器，不会启动 Cron 调度器。

<a id="environment"></a>
## 环境变量

以下均为服务端配置，不要给密钥添加 `NEXT_PUBLIC_` 前缀。Next.js 从 `.env.local` 读取本地配置；云端变量应在部署平台的设置中填写。修改后需要重启或重新部署。

| 变量 | 默认值 / 行为 |
| --- | --- |
| `DATABASE_URL` | 未设置时使用内存，除非提供了 `POSTGRES_URL`；只要已定义就优先采用 |
| `POSTGRES_URL` | 仅当 `DATABASE_URL` 未定义时使用的备用 Neon 连接字符串 |
| `CRON_SECRET` | 生产环境 Cron 鉴权所必需 |
| `REFRESH_TOKEN` | 代码中可选；未设置时手动刷新 API 公开可用，生产环境也如此 |
| `CLASSIFICATION_ADMIN_TOKEN` | 人工修正密钥；未定义时回退到 `REFRESH_TOKEN` |
| `OPENAI_API_KEY` | 可选；启用模型复核 |
| `OPENAI_CLASSIFIER_MODEL` | `gpt-5-mini`；账号需要具备所配置模型的访问权限 |
| `CROSSREF_MAILTO` | 可选，用于 Crossref 请求的联系邮箱 |
| `OPENALEX_MAILTO` | 可选联系邮箱；回退到 `CROSSREF_MAILTO` |
| `CACHE_TTL_MS` | `1800000`（30 分钟） |
| `REQUEST_TIMEOUT_MS` | 一般上游请求每次 `15000` 毫秒 |
| `REQUEST_MAX_RETRIES` | 首次请求后的重试次数，默认为 `2` |
| `REQUEST_BACKOFF_BASE_MS` | `500` 毫秒；采用带随机抖动的指数退避 |
| `REQUEST_USER_AGENT` | `physics-paper-hub/1.0 (+https://example.com)` |
| `SOURCE_REFRESH_CONCURRENCY` | `3` 个来源抓取工作任务 |
| `METADATA_ENRICH_CONCURRENCY` | 每批元数据补全使用 `3` 个 DOI 工作任务 |
| `ABSTRACT_PAGE_TIMEOUT_MS` | 落地页请求超时为 `10000` 毫秒 |
| `ABSTRACT_DEBUG` | 设为 `1` 时在生产环境输出摘要调试日志；非生产环境默认开启 |

时长和并发数应使用有限正数，重试次数应使用非负整数。目前没有对数字环境变量进行全面校验。部分请求流程会覆盖通用默认值，包括模型复核和部分元数据回退请求。

<a id="deployment"></a>
## Vercel 部署

1. 将仓库推送到 GitHub，再导入 Vercel，选择 Next.js 预设和项目根目录。Node.js 版本与本地运行环境保持一致。
2. 通过 Vercel Marketplace 连接 Neon，或者在项目环境变量中设置真实的 `DATABASE_URL`。确认连接对应所需的部署环境。
3. 为 Production 配置不同的 `CRON_SECRET`、`REFRESH_TOKEN` 和 `CLASSIFICATION_ADMIN_TOKEN`。在具备 OpenSSL 的终端中执行三次 `openssl rand -hex 32`，生成三个独立密钥。不要使用示例值。
4. 按需配置联系邮箱和模型复核。首次部署不配置 `OPENAI_API_KEY` 时只运行规则分类。Preview 与 Production 的数据和凭据应相互隔离。
5. 执行部署；新增或修改环境变量后需重新部署。首次使用数据库会初始化表结构；应检查数据库记录和运行日志，而不是仅凭存储标签判断成功。
6. 在 Vercel 项目中核对 Cron 配置和执行日志。重新部署后验证数据仍然存在，并检查各来源的执行结果。

[vercel.json](./vercel.json) 为 `GET /api/cron/refresh` 配置了 `0 0 * * *`，即每日 UTC 00:00，也就是 Asia/Shanghai 时区的 08:00。Vercel 在 Bearer 鉴权请求头中发送 `CRON_SECRET`。Cron 运行于生产部署，不会在本地开发服务器上运行。Hobby 套餐可能在指定小时内任意时刻执行，不能保证准确在 08:00 触发。参见 [Vercel Cron 管理说明](https://vercel.com/docs/cron-jobs/manage-cron-jobs)。

两个刷新路由均声明 `maxDuration = 300` 秒，实际运行仍受平台限制和工作量影响。页面上的下次刷新时间是计算结果，不是调度器已启用的证明。

在 POSIX shell 中手动检查 Cron 路由时，将 `BASE_URL` 设为实际部署地址，并以安全方式将该部署的 `CRON_SECRET` 设置为 shell 变量。终端不会自动加载 Next.js 的 `.env.local` 文件。

```bash
BASE_URL=https://your-project.vercel.app
curl --fail-with-body -H "Authorization: Bearer ${CRON_SECRET}" "${BASE_URL}/api/cron/refresh"
```

此操作会执行真实刷新，并可能产生模型费用。应检查 `latestRefreshRun.status`、各来源状态和数据库写入结果；仅有 `ok: true` 不代表所有来源、分类和持久化都成功。公开部署前，请检查依赖安全公告及下文的访问与运行限制。

<a id="api"></a>
## API 说明

所有路由使用 Node.js 运行时。请求首页或 `GET /api/papers` 可能触发过期缓存刷新和分类。

| 方法与路径 | 行为 / 鉴权 |
| --- | --- |
| `GET /api/papers` | 公开的筛选聚合接口 |
| `POST /api/refresh` | 手动刷新；配置后需通过 Bearer 发送 `REFRESH_TOKEN` |
| `GET /api/cron/refresh` | 以自动任务类型触发刷新；使用 Bearer `CRON_SECRET`；生产环境未配置密钥时拒绝请求 |
| `PUT /api/papers/:paperId/topics` | 人工标签；需要正常工作的数据库和 Bearer 管理令牌（回退到刷新令牌）；生产环境未配置密钥时拒绝请求 |

未设置密钥时，Cron 和人工主题接口允许本地非生产环境请求。若未设置 `REFRESH_TOKEN`，手动刷新在所有环境中都允许无令牌访问。

### 论文查询参数

| 参数 | 支持的值 / 默认值 |
| --- | --- |
| `source` | 逗号分隔的来源 ID；不传表示全部 |
| `topic` | 逗号分隔的主题 ID；不传表示全部；命中任一选定主题即可 |
| `q` | 不区分大小写的子字符串；为空时不进行关键词筛选 |
| `field` | `all`、`title`、`authors`、`abstract`；默认 `all` |
| `days` | `1`、`3`、`7`；默认 `7` |
| `sort` | `asc`、`desc`；默认 `desc` |
| `classificationStatus` | `pending`、`low_confidence`、`failed`；不传表示不按状态筛选 |

```bash
curl "http://localhost:3000/api/papers?source=quantum,npj-quantum-information&topic=quantum-metrology&days=7&q=quantum&field=all&sort=desc"
```

响应包含 `papers`、`total`、`totalBeforeDedupe`、`sources`、`sourceViews`、`sourceDailyCounts`、`topics`、`persistenceMode`、`timeWindowDays`、`searchField`、刷新时间戳，以及可选的 `latestRefreshRun` / `nextScheduledRefreshAt`。`total` 是筛选后的数量；`totalBeforeDedupe` 是查询筛选前的原始聚合数量。准确字段定义请参见 [lib/types.ts](./lib/types.ts) 和[接口实现](./app/api/papers/route.ts)。

手动刷新返回未筛选的聚合结果和状态元数据。Cron 返回 `ok`、`total`、`latestRefreshRun` 和 `lastSuccessfulRefreshAt`。

### 人工修正主题

使用已持久化论文的 ID，向 `PUT /api/papers/:paperId/topics` 发送以下 JSON：

```json
{ "topicIds": ["indefinite-causal-order", "quantum-metrology"] }
```

此操作替换论文的标签列表，空数组表示有意清空标签。无效主题 ID 或不是字符串数组的标签载荷返回 400；鉴权失败返回 401；被捕获的数据库错误返回 500。成功时返回 `paperId`、`topics`、`classificationStatus` 和 `classifiedAt`。

界面中的 Refresh data 和 Edit topics 操作在首次收到 401 后提示输入对应令牌，并将其保存在 `sessionStorage` 中。更换令牌后，若旧令牌持续失败，应清除已保存的令牌或开启新的浏览器会话。这些共享管理令牌并非用户账号系统。

<a id="tests"></a>
## 测试

执行默认检查前，确保测试终端没有导出真实模型密钥：

```bash
npm test
npm run lint
```

`npm test` 包含摘要样例测试、分类回归测试，以及模拟来源/API 测试；不包含浏览器测试、真实上游检查或真实 Neon/模型集成测试。通过 shell 启动的测试不会自动加载 Next.js 环境文件。

| 命令 | 覆盖范围 |
| --- | --- |
| `npm run test:abstract` | 摘要提取、HTML 元数据、实体清理 |
| `npm run test:classification` | 主题规则、多标签案例、结果复用/人工覆盖、模拟模型失败 |
| `npm run test:sources` | RSS/RDF、回退合并、停用来源、API 组合筛选 |
| `npm run test:ui` | 使用合成样例对构建后的应用进行浏览器回归测试 |

浏览器检查需要生产构建和 Chromium。构建/测试前，请停止所有使用同一 `.next` 目录的开发服务器：

```bash
npm run build
npx playwright install chromium
npm run test:ui
```

UI 测试在 `127.0.0.1:3107` 启动隔离服务器，从该样例服务器环境中移除数据库和模型配置，测试桌面端、移动端及深色模式，将截图写入 `/tmp/paper-tracker-ui`，最后停止服务器。正常应用入口不会加载这些样例论文。可通过 `UI_TEST_PORT`、`UI_SCREENSHOT_DIR` 和 `PLAYWRIGHT_MODULE` 覆盖默认设置。如果默认路径不适合当前操作系统，请将 `UI_SCREENSHOT_DIR` 设为可写目录。

可选的真实摘要检查需要网络访问，可能受到上游封锁或限流影响。

macOS/Linux：

```bash
ABSTRACT_LIVE_TEST=1 npm run test:abstract
```

PowerShell：

```powershell
$env:ABSTRACT_LIVE_TEST = "1"
npm run test:abstract
Remove-Item Env:ABSTRACT_LIVE_TEST
```

合成测试通过不保证真实分类准确率、抓取完整性或生产环境可靠性。

<a id="structure"></a>
## 项目结构

```text
app/
  page.tsx                         服务端渲染首页
  layout.tsx, globals.css           布局与样式
  api/papers/route.ts               论文筛选 API
  api/papers/[paperId]/topics/route.ts  人工主题 API
  api/refresh/route.ts              手动刷新 API
  api/cron/refresh/route.ts          Cron 刷新 API
components/paper-dashboard.tsx      筛选、卡片、趋势、收藏
lib/
  cache.ts                         刷新调度与聚合
  database.ts                      Neon 持久化与表结构初始化
  classifier.ts, topics.ts          分类逻辑与当前主题体系
  fetchers/                        arXiv、RSS、Crossref、DOI 元数据适配器
  abstract.ts                      摘要清理与 HTML 回退
  dedupe.ts, utils.ts               标识、排序、文本与日期工具
  sources.ts, types.ts, errors.ts   配置、类型契约、错误
  http.ts, paper-service.ts         HTTP 重试与服务兼容层
scripts/                           摘要与浏览器检查工具
tests/                             分类与来源回归测试
sources.json, topics.json          来源与主题配置
.env.example                       仅含占位配置
vercel.json                        部署预设与每日调度
package.json, package-lock.json    命令与依赖版本
README.md, README.zh-CN.md         内容对应的中英文说明
```

<a id="troubleshooting"></a>
## 常见问题

| 现象 | 含义 / 处理方法 |
| --- | --- |
| `Storage: temporary memory` | 没有生效的数据库连接字符串；需要持久保存数据时请配置 Neon |
| 显示 `Storage: Postgres`，但没有保存记录 | 检查 URL、表结构权限和数据库错误日志；该标签只反映配置状态 |
| `0 new papers` | 内存模式下始终为 0；启用持久化时统计本次聚合插入的记录，不是未读论文数量 |
| 来源状态为 `success`，但论文数为零 | 当前窗口没有找到论文可能是正常情况；请检查覆盖范围限制 |
| `partial_data` | 至少 10% 的记录缺少有效作者或至少 60 个字符的摘要，不一定是抓取失败 |
| `stale_cache` | 本次抓取失败或没有窗口内论文，因此保留此前可用数据 |
| `failed_no_cache` | 抓取失败，且没有可用的旧缓存 |
| `source_returned_empty` | 当前窗口为空的诊断信息，不一定是解析器崩溃 |
| 刷新/修正返回 401 | 检查对应密钥及浏览器会话中保存的旧令牌 |
| 内存模式下修正返回 500 | 人工修正需要正常工作的数据库 |
| 分类持续处于 pending | 检查模型可用性、请求预算和日志；满足重试条件不会自行启动后台任务 |
| 本地页面显示未来自动刷新时间 | 显示的时间只是预计时间，本地没有内置每日调度器 |
| 缺少论文或摘要 | 先检查筛选条件、来源状态、上游访问和抓取数量限制，不要直接认为所有可获取论文都已收集 |

<a id="limitations"></a>
## 当前限制与后续方向

- 尚无全历史搜索、自定义日期范围、抓取分页、未读追踪、保存搜索、订阅或通知推送。
- 尚无语义搜索、全文 PDF 阅读器、引用导出，也不能可靠关联预印本与期刊版本。
- 收藏仅保存在当前浏览器及站点来源下，清除浏览器存储会删除收藏。
- 已有持久化和人工标签功能，但数据库写入不是一次完整、原子的刷新事务；刷新协调仅在单实例内部进行，没有分布式锁。并发的无服务器调用可能带来运行风险。
- 公开读取请求可能触发高成本工作。项目没有应用级限流或完整身份认证系统；大范围公开前应保护管理接口并评估防滥用措施。
- 外部来源的可用性和元数据质量会变化。公开部署前还需要检查现有依赖版本的安全性；构建成功不代表通过安全审查。
- 分类依赖不完整的证据和可选外部推理。在宣称精确率/召回率前，应使用独立的专家标注集评估。后续宜优先完善抓取完整性、历史数据库查询、未读状态和可保存的研究筛选视图，再扩展推荐功能。

上述内容是后续方向，不是已经可用的功能。

<a id="maintenance"></a>
## 文档维护

在同一次修改中同步维护 [README.md](./README.md) 和 [README.zh-CN.md](./README.zh-CN.md)。对应实现改变时，同时更新两版的来源/主题表、命令、环境变量默认值、API 契约、限制和部署步骤。两份文件使用相同的章节锚点，便于跨语言核对。

判断当前行为时，应以可执行代码和配置为准，不要依赖 `Agent.md` 或 `MEMORY.md` 中较早的历史记录。不要向任一 README 添加未经验证的部署状态、固定实时论文数量或准确率承诺。
