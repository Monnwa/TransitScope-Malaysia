# Phase 1.7 — Production 归档上线评审与执行计划

**评审结论为暂缓启用 Production 归档。** 2026 年 11 月 11 日完成了部署配置只读核对、源代码检查、19 项针对性回归测试和验收证据复核。

## 当前生产基线

| 核对项 | 11 月 11 日马来西亚时间的结果 |
| --- | --- |
| GitHub Production 分支 | `master` 指向 `235f7cb67d631a17df86bfc23f70de93dc0fff5d`。该版本早于 PostgreSQL 归档和发件箱。 |
| Vercel Production | 22:29 核对到 `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6` 为 Ready，与 GitHub SHA 一致。项目配置返回 Node.js 26.x、部署区域 `iad1` 和 Hobby 套餐。 |
| Vercel 环境变量 | Production 部署和项目的 Production 范围均有 0 项归档、回放或 Redis 证据相关配置。相关配置位于 `feature/postgres-outbox-preview` 的 Preview。 |
| 已验证 Preview | `dpl_5HgW3wjeG6kWV9r8jFp2ajev5gSq` 为 Ready，源码为 `3bb0e2a48f3c1047b886c79a9c2497961de78d45`。两套临时可写测试部署已退役。 |
| 接口性能基线 | 22:32 查询 Production 的 `/api/transit` 与 `/api/bus-journey`，最近 20 分钟返回 0 条匹配请求。仍需采集代表性流量，才能设定 p95、p99 和错误率阈值。 |

已验证的 Preview 源码在 `VERCEL_ENV=production` 时直接跳过归档初始化。应用还在模块加载时创建归档实例。上线需要一个专门审阅的候选提交，明确校验两个 Vercel 环境标识和启用开关。当前 Preview 与 `master` 相差 33 个文件，涵盖 Redis、GPS 历史与回放等改动。应从 `master` 审阅最小上线差异，并继续把回放路由限定在受保护的 Preview。 [归档初始化器](../lib/classification-evidence-store.ts#L486) · [回放路由环境检查](../lib/preview-evidence-replay-http.ts#L39)

## 验收证据与待验证范围

- Phase 1.6X 的七项验收通过。受保护 Preview 中，A、C、E 的中断标记与 Vercel 原始调用的 504 一致。B 验证收据写入中断时的事务回滚，D 验证并发恢复，F 验证数据库客户端超时后重试，G 验证 Production 路由拒绝。 [托管验收](timetable-adherence-evidence-phase1-6x.md#authorized-hosted-recovery-results)
- 本次评审的 19 项本地测试通过，涵盖归档启用条件、从持久化意图恢复，以及相同输入下归档关闭、同步和延后模式的旅程一致性。 [归档测试](../tests/classification-evidence.test.ts) · [一致性测试](../tests/journey-archive-parity.test.ts)
- Production 评审仍需真实车队入口的写入和延迟证据、提交前损失分母、低流量时的积压处理、正式数据库的恢复演练，以及归档和收据的物理清理。当前等待写入的候选先存在进程内存。持久化边界是 PostgreSQL 发件箱提交。 [采集与发件箱处理](../lib/classification-evidence-store.ts#L289) · [候选生命周期定义](timetable-adherence-evidence-phase1-6j.md#candidate-lifecycle-accounting)

## 按顺序执行

| 阶段 | 交付与验收 |
| --- | --- |
| **1. 选定归档承诺** | 建议把首轮上线设计为尽力归档，并明确允许的提交前损失、拒绝率、终态交付失败率和最大积压年龄。若业务要求所有已接收记录均可恢复，先设计独立的持久化接收，或验证能恢复原始快照的重放来源。记录负责人、统计窗口和对账截止时间。 |
| **2. 审阅候选提交** | 以当前 `master` 为基线，逐项审阅归档和发件箱所需改动。默认关闭归档。测试 Production 标识匹配、缺失、冲突及开关关闭时的行为。保留 Preview 回放限制。验证旅程结果一致，数据库错误会被归档路径隔离，并保留审阅通过的完整 SHA。 |
| **3. 验证正式数据面** | 选定独立的长期 Neon 项目、预算和区域。以当前 `iad1` 为测量起点，在预演环境量测数据库往返时间。由迁移角色在一个事务内应用正式证据表和发件箱迁移。写入角色仅获证据表 SELECT/INSERT、发件箱 SELECT/INSERT/UPDATE 和指定交付函数 EXECUTE。另设只读观察角色与限范围的过期清理角色。读回项目、分支、端点、角色及实际权限。在独立恢复分支验证备份时间点、恢复时间、行数和校验和。 [证据迁移](../database/classification-evidence.sql) · [发件箱迁移](../database/classification-outbox.sql) · [Neon 恢复演练](https://neon.com/docs/postgres/backup-restore/branch-restore) |
| **4. 演练保留和恢复** | 建议以当前代码的 7 个服务日设置作为预演起点，由负责人确认正式期限与备份窗口。现有逻辑按马来西亚服务日计算过期时间。实现按索引分批清除过期归档与到期终态收据，先核对待删除行数。对待处理或重试中的记录先结算并对账。演练低流量、冷启动和数据库故障恢复，测量待处理记录最老年龄和清空积压的时间。若需要分钟级唤醒，先验证独立运行机制。Vercel Hobby 的 Cron 调度上限为每日一次。 [过期计算](../lib/classification-evidence.ts#L111) · [Vercel Cron 限制](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing) |
| **5. 建立可比较的预演证据** | 在同源码、同地区、同输入和相近负载下对比归档关闭与启用。对照同一组稳定 ID 和校验和，覆盖峰值、空闲、冷启动、故障及恢复。验证旅程一致性、端到端 p95/p99、5xx、PostgreSQL 1.5 秒查询截止、2.5 秒处理预算、已提交意图、终态收据、积压和有效拒绝。汇总以独立 SQL 对账为准。 |
| **6. 演练部署与回退** | 获批后先以归档关闭配置准备 Production 目标的候选构建，暂不分配正式域名。记录候选和紧邻的可回退部署 ID，验证旧版本的归档状态以及切回后的访问。Hobby 使用暂存、受控验证及单次提升流程。流量比例发布需要支持 Rolling Releases 的套餐。将正式凭据绑定和域名提升交给独立上线决策。 [Vercel 暂存与提升](https://vercel.com/docs/deployments/promoting-a-deployment) · [Rolling Releases](https://vercel.com/docs/rolling-releases) |

## 监控和回滚条件

每个告警需关联部署 SHA、路由、时间窗、请求数和可核对的运行或记录 ID。监控记录保留计数、时间、状态和必要的校验和。原始 GPS 载荷和凭据留在各自的存储边界内。

| 信号 | 决策规则 |
| --- | --- |
| 旅程一致性、数据完整性和环境隔离 | 发现一条可复现的同输入旅程差异、一项重复终态、一项校验和或已确认收据不一致、一次越界绑定或一次可归因于归档的用户可见 5xx，立即停止提升或执行回退。 |
| 请求延迟与错误率 | 以代表性归档关闭样本确定两条入口各自的请求量、p95、p99 和 5xx 基线。值班负责人在预演前确认增量上限、统计窗和最小样本数。上线期间连续两个达到样本数的观测窗越限即回退。22:32 的空样本无法用于设定阈值。 |
| 提交前损失、拒绝和终态失败 | 按马来西亚时间对稳定 ID 去重。保守损失率使用 `(确认丢失 + 未对账) / 已接收`，分别报告拒绝、终态失败和提交结果未知。超过已批准上限就暂停写入并对账。已接收数为 0 时记录样本不足。 |
| 持久化积压 | 独立观察者按约定间隔读回 PENDING/RETRYING 数、最老记录年龄和恢复后清空时间。年龄或清空时限超出批准值时暂停写入并启动已演练的处理流程。使用一段连续采样覆盖峰值和空闲期，为阈值提供依据。 |

回退时先将后续部署的归档开关设为 `false`，再把正式域名切回已验证的归档关闭部署。环境变量更改会进入后续部署。Hobby 的即时回退使用紧邻的上一套 Production 部署及其原配置。核对域名、版本、接口错误和新写入量。若已退役的写入部署仍能通过独立 URL 写入，按预先批准的应急流程隔离该部署或撤销其专用写入凭据，独立对账已提交和仍在处理的记录。保留回退前的发件箱和收据供复核。 [Vercel 环境变量生效范围](https://vercel.com/docs/environment-variables) · [Vercel 即时回退](https://vercel.com/docs/instant-rollback)

## 临时证据收尾

22:31 的只读复核确认用例 E 的运行 `dd4fde1b-2e4e-43d6-a66b-239b739f3f1b` 保留 1 条归档和 1 条收据，另有 3 个未解决候选。其余 5 个测试运行已清理。临时库的记录到期时间为 **11 月 13 日 23:59:55 MYT**。现有脱敏快照和调用证据已足够支撑本次评审。若需要托管原始记录，须在到期前决定单独保留。新的演练使用新的隔离存储和运行 ID。 [脱敏验收证据](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/hosted-recovery/verified-evidence.json>) · [按时间记录的观察](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/hosted-recovery/observations.jsonl>)

## 首轮归档承诺与验收口径

**候选设计采用尽力归档，首轮预演的提交前损失提案上限为 0.5%。** 该值选自 Phase 1.6J 已列出的政策场景，用于设计采样与判定。Production 的损失率仍待实测，正式上限需在上线评审时确认。若业务要求所有已接收记录都可恢复，则把持久化接收或经验证的原始快照重放来源纳入候选设计。 [Phase 1.6J 损失预算](timetable-adherence-evidence-phase1-6j.md#proposed-data-loss-budgets)

| 项目 | 首轮预演口径 |
| --- | --- |
| 已接收 | 以有独立证据证明首次进入暂存区的稳定记录 ID 为准。按马来西亚时间归入首次接收日，跨实例和重试去重。预期清单和已生成候选各自记录。 |
| 已提交 | 由 PostgreSQL 发件箱或可核对的持久化收据确认 ID 与校验和。PENDING/RETRYING 的已提交意图仍属于已提交。收到响应前断开的请求可用独立 SQL 读回确认。 |
| 确认丢失 | 有接收证据，且相关重试与恢复观察结束后，原始暂存载荷已不可恢复，仍无持久化提交。 |
| 未对账 | 有接收证据，截止时仍无法确认提交或丢失。单列提交结果未知和仍在暂存的记录。缺少接收证据的候选计入观测缺口。 |
| 对账时间 | 预演前登记数据范围、最小样本量和截止时间。截止时间覆盖恢复、重试与租约窗口。晚到的提交归回原接收日并追加对账修订，保留初次判定。 |

每组样本核对 `已接收 = 已提交 + 确认丢失 + 未对账`。保守损失率为 `(确认丢失 + 未对账) / 已接收`，同时报告 `确认丢失 / 已接收` 作为观测下界。按 `向下取整(已接收 × 0.005)` 比较分子。每 1,000 条已接收记录最多允许 5 条确认丢失或未对账，每 5,000 条最多允许 25 条。

- **通过**要求代表性样本达到预先登记的最小样本量、接收证据完整，且保守损失率至多 0.5%。
- **暂停推进**适用于保守损失率越限。已接收数为零、样本不足或接收记录有观测缺口时，记录为证据不足，先补齐观测。
- 拒绝率、提交后的终态失败、积压年龄和故障注入结果分别报告。用例 E 的三个未解决预期 ID 缺少首次暂存证据，归入预期清单的观测缺口。 [候选生命周期](timetable-adherence-evidence-phase1-6j.md#candidate-lifecycle-accounting) · [用例 E 证据](timetable-adherence-evidence-phase1-6x.md#authorized-hosted-recovery-results)

候选提交评审应覆盖独立的接收证据、可去重 ID、校验和、接收与提交时间，以及故障期间的证据完整性。保留指标所需字段，避免在日志中携带原始 GPS 载荷。首轮预演分别校验正常峰值、低流量和故障场景，再用观测结果确认正式阈值。

## 基于 master 的最小候选补丁评审

已从 `master` 的 `235f7cb67d631a17df86bfc23f70de93dc0fff5d` 在隔离本地副本中提取 12 文件的候选补丁，并核对可以应用到干净的基线。候选树为 `f64363ece5e64800eddaa5e1494812449e9e6e6b`，补丁 SHA-256 为 `5758d2fce2532f7eba71ded284dd870b6baf2a324159a71237365c67d10df552`。候选代码默认关闭归档，并保留现有 Production 拦截。 [可审阅补丁](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-candidate-review/master-archive-review.patch>)

| 范围 | 候选改动 |
| --- | --- |
| 归档核心 | 归档证据、发件箱存储、两份正式 SQL 迁移及归档测试。将现有 GPS passage 校验定义移入证据模块，保留字段次序和校验约束。 |
| 正常请求入口 | 仅在启用归档的车队处理路径调用归档。保留 `master` 的旅程计算、缓存、实时数据字段和响应结构。两条 API 增加归档工作交接。 |
| 配置和依赖 | 归档环境模板、Neon 驱动及用于本地 SQL 测试的 PGlite。Redis、GPS 持久化诊断与 Preview 回放属于各自的发布范围。 |

候选通过 **326 项单元测试**、5 项独立旅程对照、TypeScript、ESLint 和生产构建。对照先在干净的 `master` 用固定输入计算完整旅程输出摘要，再检查候选关闭、同步成功、延后成功、同步失败和延后失败的输出。五种结果均与基线摘要 `c433d0fa20e4df43906e511eb49dd6af5229d280341df070ec5f2caf3ca9a451` 一致。成功路径在嵌入式 PostgreSQL 核对了固定候选 ID 和校验和的待处理及终态收据。失败路径核对数据库为空。

### 跨实例去重与接收证据

独立数据库探针用两个存储实例提交同一稳定 ID 的两个快照。两者的校验和不同。数据库保留先提交的载荷，后一次返回 `alreadyQueued=1`。用后一次的快照调用现有 `committedIntents()` 也会查到这个 ID。稳定 ID 和唯一键足以避免同一身份写入两行。证明首次接收的快照已提交还需要对上校验和。 [稳定 ID 与快照摘要](../lib/classification-evidence.ts#L63) · [当前按 ID 读回](../lib/classification-evidence-store.ts#L136)

首轮预演可采用以下最小观测方案。独立观察方在请求发出前登记被测调用和唯一尝试 ID。调用在实际暂存后提交该调用的接收事件清单，由观察方持久化并回执，再进入被测提交或中断点。每条事件保留稳定 ID、精确校验和、暂存时间、调用 ID 与尝试 ID。回执重试使用相同尝试 ID。已登记调用缺少完整接收清单时，记录该范围的分母缺口。进程内暂存和远端观察记录之间存在退出窗口，预演需要验证如何识别这类缺口。

按稳定 ID 去重后，首次接收日归属依据可核验的暂存记录。跨实例顺序有歧义的记录进入对账待核。独立 SQL 用发件箱中的待处理载荷，或交付后归档行的校验和核对精确快照。另一版本的同 ID 收据单列，直到确认首次快照的去向。保留核对所需的收据与校验和到对账结束。应验证回执丢失、暂存后进程退出、SQL 提交后响应丢失、相同 ID 不同校验和以及跨马来西亚午夜重试。

**评审通过了最小依赖范围和本地旅程对照。** 0.5% 预演口径仍需独立接收记录和精确校验和对账支持。下一步先在隔离预演中验证这套观测，再审阅 Production 启用条件。

## 独立接收记录的本地隔离预演

2026 年 11 月 11 日 22:57 MYT 完成 **11 项预演，全部通过**。测试使用候选树 `f64363ece5e64800eddaa5e1494812449e9e6e6b` 的实际暂存和归档适配器、独立 SQLite 观察进程及本地嵌入式 PostgreSQL。测试控制器只终止自己创建的工作进程。结果记录了 **8 次 SIGKILL**，并在每项测试后用新观察进程重新读取已持久化记录。观察方只保留 ID、校验和、暂存时间及调用和尝试标识。 [预演结果](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-pilot/pilot-results.json>)

| 场景 | 实测判定 |
| --- | --- |
| 观察回执丢失与重试 | 观察方已持久化，工作进程用相同尝试 ID 和清单重试。最终只有一条接收记录和一份校验和匹配的终态收据。用相同尝试 ID 提交不同校验和被拒绝。 |
| 已完成调用，零条暂存 | 观察方记录了完整的空清单，判为无分母。 |
| 暂存前退出、暂存后但观察记录提交前退出、观察方不可用 | 已登记的调用缺少完整接收清单。三项均判为分母缺口，发件箱均为零行。观察方不可用由测试控制器模拟。 |
| 部分样本已提交，同时存在分母缺口 | SQL 与已见证记录精确匹配。由于另一个调用缺少完整清单，仍判为证据不足，0.5% 判定值留空。 |
| 观察回执后、SQL 前退出 | 一条已接收记录有持久观察证据，SQL 未执行。测试样本的原始暂存载荷随进程退出，按受控场景计为一条确认丢失。 |
| SQL 提交后、应用收到回执前退出 | 重新打开 PostgreSQL 后，查回一条 PENDING 意图，校验和与已见证快照一致，计为已提交。 |
| 跨马来西亚午夜的同 ID 重试 | 相同校验和成功对账，归回首次接收日并只计一次。另一校验和即使已归档，首次快照仍列为未对账。两次首次暂存时间相同且校验和不同时，也列为未对账。 |

跨午夜测试使用受控暂存时钟，GPS 分类仍使用原始固定样本的测量时间。结果文件的 SHA-256 为 `9168440788eda659bcb662bd46d2e31c21dfbbceb7e2432f89885838a265a375`，隔离候选及工作进程通过 TypeScript 检查。

本次验证了对账规则在单机进程故障下的分类。**0.5% 的实际验收仍需代表性流量和独立托管观测。** 下一轮使用受保护的隔离 Preview，先登记被测调用，核对观察方在独立托管环境的回执与缺口，再采样两条正常车队入口的延迟、接收量和持久化结果。


## 托管预演准备与采样计划

2026 年 11 月 12 日，已在候选树 `f64363ece5e64800eddaa5e1494812449e9e6e6b` 的本地隔离副本接通两个正常请求入口。全量 **330 项测试**、TypeScript、ESLint 和 Next.js 构建通过。用两套嵌入式 PostgreSQL 实测，公共缓冲区只能提交已获对应车源回执的记录。覆盖了回执丢失后幂等重试、错误回执、超时关闭、角色权限和精确校验和读回。路由测试让详情请求与车队请求共用一次车源处理，核对了关联记录和两端旅程输出。此节记录本地准备，托管采样尚未开始。

观察库仅保存尝试、车源、结果、稳定 ID、校验和和时间，运行角色只能执行登记查询和完成函数。归档库的独立核对角色只读回执视图，视图提供状态和校验和。写入要求两项 Vercel 环境标识均为 Preview、限时窗口有效、请求持有专用 bearer、尝试已在观察库预登记。车源回执需匹配本次清单摘要后才允许对应候选进入归档 SQL。普通请求和观察失败时的请求继续提供旅程结果。 [观察库迁移](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/observer.sql>) · [归档角色与回执视图](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/archive-grants.sql>) · [本地文件摘要](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/sha256.txt>)

### 部署范围

- 在 Vercel 项目 `transit-scope-malaysia`（`prj_DqTjkYBkW3dmA0hEteczCHOQNVgE`） 用同一份本地候选创建两份限时、受保护的 Preview。两组使用相同区域和运行设置，启用观察回执。实验组开启归档，对照组关闭归档。上线前核对登录保护、目标环境、两组部署 ID 和配置，确认默认项目环境中无预演变量。
- 计划新建两个免费、72 小时到期的 Claimable Neon 项目。归档位于 `aws-us-east-1`，观察位于 `aws-us-east-2`。两库分别使用独立项目、计算和角色，仍共享 Neon 服务商。用例 E 的现有临时库存留原验收证据。本轮使用专用数据库、运行 ID 和凭据。
- 归档写入角色凭据只绑定实验组。观察写入角色凭据和本轮专用 bearer 仅绑定这两份受保护 Preview。数据库所有者、登记和只读核对凭据留在操作端。关闭项目级凭据继承的路径或核对有效环境后再发送请求，操作日志只记录变量名称和目标。 [Neon 临时项目](https://neon.com/docs/reference/claimable-neon) · [Neon 区域](https://neon.com/docs/introduction/regions) · [Vercel 部署保护](https://vercel.com/docs/deployment-protection) · [Vercel 敏感环境变量](https://vercel.com/docs/environment-variables/sensitive-environment-variables)

### 采样与对账

1. 先用固定输入做两组旅程输出对照并核对数据库空基线。预先登记两组部署 ID、精确时间窗口、采样和对账截止时间、样本上限和故障测试安排。实时采样使用一段两小时高峰和一段两小时低峰。两组每 30 秒近配对调用一次 `/api/transit?mode=live`，交替请求顺序。每两分钟补一次 `/api/bus-journey`，轮换三车源并使用刚观察到的有效车辆。无车辆时记录缺样。各组各路由分别记录时延和可用性，标记冷启动、缓存、上游时间、空响应和故障。实时输入漂移用健康状态和时间戳解释，固定输入对照用来核对精确输出。
2. 每个请求使用新的 UUID，先通过独立登记角色写入预期车源，再发出正常受保护请求。车队预期为 `rapid-bus-kl`、`rapid-bus-mrtfeeder`、`rapid-bus-penang`，详情只登记目标车源。操作端保留 UUID 与部署、组别、路由、请求时刻和响应状态的对应表。HTTP 成功后仍须核对观察回执。
3. 展开每个已登记尝试的车源清单，与每车源的完成记录逐项匹配。空的 `PROCESSED` 或 `NO_WORK` 是完整的零候选清单。`JOINED` 需能关联同组同车源的已完成所有者，候选只计一次。缺失完成记录、无法关联所有者或无法验证摘要的样本记为分母缺口。观察摘要按应用使用的字段顺序重建，核对时采用独立只读角色。
4. 实验组预先采用至少 **1,000 个首次见证的不同稳定 ID** 作为本次最小样本量。按 MYT 首次暂存时间归日，并用发件箱或归档读回的精确校验和匹配。出现分母缺口或样本不足时，结论为证据不足。满足观测条件后，按 `(确认丢失 + 未对账) / 已接收` 与 0.5% 比较。每 1,000 个 ID 允许最多 5 个确认丢失或未对账。故障注入结果单列。实时延迟用样本量说明，单组单路由分别达到 100 或 400 次有效响应时才给出描述性 p95 或 p99。
5. 采样在限时窗口关闭前停止，留下已启动工作和重试的观察窗口。到对账截止时间后导出脱敏清单、校验和、回执和汇总，记录未清积压，退役两份预演部署并撤销临时运行角色。保留临时库到登记的到期时间。Production 的归档开关继续关闭。

两份预演部署及两套数据库尚待创建。本地报告中的 0.5% 仍是预演判定标准，托管样本量和损失率待实测。



### 2026 年 11 月 12 日托管执行记录

用户已授权本节限定的临时资源和凭据绑定。本次登记了两个 MYT 采样区段，低峰 **12:30–14:30**，高峰 **17:00–19:00**。最早对账时间为 **19:15**，写入窗口在 **19:45** 关闭。每组最多 480 次车队与 120 次详情请求。 [预登记参数](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/pilot-window.json>)

| 独立项目 | 区域 | 供应商记录的到期时间 |
| --- | --- | --- |
| 归档 `muddy-mud-63126863` | `aws-us-east-1` | 2026-11-15 11:20:59 MYT |
| 观察 `shy-rain-61684311` | `aws-us-east-2` | 2026-11-15 11:21:04 MYT |

两库通过验证 TLS 的直连初始化，核对了五个受限角色的实际登录及权限，并使用独立只读角色确认空基线。Vercel 预检核对到 `all_except_custom_domains` 登录保护、零绕过、`iad1` 和 Node.js 26.x。Production 仍为 `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6`，提交 `235f7cb67d631a17df86bfc23f70de93dc0fff5d`。 [Neon 角色与基线核对](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/neon-bootstrap.json>)


Vercel 两份临时 Preview 已就绪，均在 `iad1`，源码摘要相同，无别名，匿名请求均返回 HTTP 302 并跳转至 Vercel 登录。部署时只向对应组绑定专用运行凭据，预检确认项目默认环境无本轮变量。 [对照组部署凭证](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/vercel-control.json>) · [实验组部署凭证](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/vercel-archive.json>)


**11:32 MYT** 完成两组正常 Edge 登录和演示接口只读检查，均返回 HTTP 200。第一次登录探测把 Vercel 对未登录 JSON 请求返回的 401 当成了演示数据异常。修正后重新打开正常登录页，两库仍为空。真实车队请求与回执校验安排在 12:30 MYT 首个登记时段。 [采样进度](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/sample-progress.jsonl>)


- **12:30 MYT** 两组首个实时请求均返回 HTTP 200，六条车源清单均持久化且摘要匹配。解压后响应分别为 18,846,991 和 18,847,035 字节，触发原先 12 MiB 本地解析限额。已将采样器的 JSON 解析限额调整为 48 MiB，保留首组记录。
- **12:34 MYT** 恢复后两组 HTTP 200，解析到对照组 355 个旅程条目和实验组 351 个。实验组 Rapid KL 和 MRT Feeder 两条回执缺失，Penang 及对照组三条均有回执。四个尝试登记共收到 10/12 条回执，观察到零暂存事件和零归档收据。现有证据无法定位到归档就绪检查、静态数据处理或观察写入。缺失项保留在预检记录，随后只在原采样窗口内安排一组有界复查。 [逐请求记录](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/sample-ledger.jsonl>)


- **12:40 MYT** 最后一次复查未在低峰登录窗口内取得授权会话，因此没有发出新请求。**16:05 MYT** 独立只读复核仍为 4 次登记、10/12 条回执、零暂存事件和零归档收据。两份原 Preview 仍处于 Ready，匿名访问均为 302。
- 收到继续指示后，沿用原 Preview、凭据、请求上限及 19:45 MYT 写入截止，恢复 **17:00–19:00 MYT** 的高峰段。先用新的请求 ID 完成一次受限复查。低峰段只有预检记录，全计划的验收结论将保留该覆盖缺口。 [逐请求记录](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/sample-ledger.jsonl>)


### 托管预演结论

**证据不足，正式采样未开始。** 17:00 MYT 的复查中，两份 Preview 均返回 HTTP 200，各有 394 条实时记录和 387 个旅程条目，三个公交源均为 healthy。两次请求的登记均成功，六条车源回执均缺失。Vercel 日志按两条请求 ID 对上了函数调用，只有信息级记录。现有日志无法区分登记查询、数据库就绪、静态数据处理和观察写入各环节的结果。 [对照组日志](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/peak-vercel-runtime-control.json>) · [实验组日志](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/peak-vercel-runtime-archive.json>)

17:02:27 MYT，在最后两次登记到期后用独立只读角色导出。三组预检共 6 次请求，收到 **10/18 条车源回执**，缺少 8 条。观察到零暂存事件、零归档收据和零正式样本。低峰和高峰均缺少正式样本，1,000 条样本门槛未达到，**0.5% 损失率验收无法判定**。本轮在预检停止，最后一次读回覆盖了所有实际尝试的到期时间。 [脱敏收尾摘要](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/pilot-closeout.json>) · [独立读回](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/sample-evidence.json>)

两份临时 Preview 均已退役，Vercel 管理 API 对两个确切部署 ID 均返回 404。两套 Neon 的运行写入角色已停用登录并撤销运行权限，两库保留至各自登记到期时间。复核确认 Production 仍指向 `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6`，归档关闭。 [对照 Preview 退役](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/vercel-control-retired.json>) · [实验 Preview 退役](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/vercel-archive-retired.json>) · [Neon 权限撤销](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/neon-retired-writers.json>) · [Production 复核](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-hosted-witness/post-retirement-production.json>)



### 回执缺口诊断候选

已从原托管预演候选复制出独立的本地诊断副本，原部署源码摘要和收尾证据可继续核对。本地候选沿用原有回执与写入门槛、超时预算和重试次数。日志只为带有效预演凭据和合法 UUID 的 Preview 请求生成，以同一尝试 ID 关联两条 API、车源和各阶段的结果与耗时。结构化日志保留阶段、结果和候选数量，凭据、连接地址、SQL 参数、车牌、GPS 数据、原始错误和校验和均排除。 [日志入口](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-diagnostics/candidate/lib/classification-pilot-witness.ts>) · [变更文件摘要](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-diagnostics/sha256.txt>)

| 阶段 | 下一次可辨认的结果 |
| --- | --- |
| 预演开关和观察库配置 | Preview 目标不匹配、开关关闭、窗口关闭和无效绑定。 |
| 登记查询 | 已登记、未登记、异常响应、超时或数据库错误。 |
| 实时与静态车源 | 实时源为空或不可用、静态资料失败，以及并发请求关联到已有车源处理。 |
| 归档库就绪和旅程处理 | 共享就绪检查超时、权限或迁移未就绪、旅程计算成功或失败。 |
| 回执写入 | 每次写入的结果和耗时，区分正常零候选、超时重试、摘要不匹配。 |

全量 333 项测试、TypeScript、ESLint 和 Next.js 构建均通过。本地验证覆盖登记超时、未登记、回执超时后的幂等重试、摘要不匹配、正常空回执和并发关联。也验证了归档库未就绪时仍返回相同旅程，并留下未完成的见证记录供独立对账。下一轮托管检查先用有限请求验证冷启动、热实例和并发请求的三车源回执，再用固定样本核对实际归档记录的 ID 和校验和。此前 8 条缺失回执的根因仍待托管复现，Production 归档关闭。



### 小规模托管复查准备

固定样本使用一个仅向归档实验 Preview 开启的限时 POST 入口。入口要求现有 Preview 环境保护、独立登记的尝试 ID、专用 bearer 和部署级开关。调用方不提供样本输入。服务端使用部署时指定的固定日期生成一条合成分类记录，并沿用原暂存、独立回执、发件箱和交付代码。HTTP 202 返回预期 ID 与校验和，实际提交通过独立只读角色查询两库核实。 [固定样本入口](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-recheck/candidate/app/api/internal/preview/classification-pilot-fixture/route.ts>) · [变更摘要](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-recheck/sha256.txt>)

本地固定样本测试实际查回同一个 ID 和校验和，归档终态为 `PERSISTED`。测试还确认 Production、关闭开关、普通入口登记和额外输入均无法触发固定样本写入。全量 **334 项测试**、TypeScript、ESLint 和 Next.js 构建通过。Vercel 只读预检确认登录保护开启、零自动化绕过、无项目级预演变量，Production 部署 ID 和提交保持原基线。可审阅部署清单共 118 个文件，SHA-256 为 `fe43c5b7c44b6e0150ea9dab8e116a073deb89138f311d78837c774b1b023efa`。 [本地部署工具](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-recheck/vercel-pilot.cjs>)

本轮拟用两套新的免费 72 小时 Claimable Neon，归档在 `aws-us-east-1`、观察在 `aws-us-east-2`。用同一候选创建两份受保护临时 Preview，归档写入凭据仅绑定实验组，观察写入凭据与本轮 bearer 仅绑定这两份部署。操作端保管数据库所有者、登记和只读核对凭据。上一轮的库、退役部署和证据继续保留原状态。

计划最多发送 **9 次**已登记测量请求。每组包含一次首次车队调用、一次热车队调用和一次车队与详情并发调用，实验组额外发起一次固定样本 POST。复查逐车源核对回执和阶段日志，并用独立 SQL 核实合成记录的终态。若仍缺回执，保留失败请求和阶段日志并定位失败环节。完成后撤销本轮写入权限和退役两份临时 Preview。新资源与凭据绑定待本轮单独授权。



### 小规模托管复查结果

2026 年 11 月 12 日 **17:25 MYT**，使用两套新建的临时 Neon 和两份受保护 Preview 完成 **9 次**登记请求。两份部署采用同一候选摘要、独立部署级凭据和普通 Edge 登录。独立观察库核对到 21 条预期车源回执中的 **18 条**，现有清单的摘要均匹配。 [独立读回和请求清单](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-recheck/recheck-evidence.json>)

| 场景 | 结果 |
| --- | --- |
| 首次车队请求 | 对照组与实验组均返回 HTTP 200。对照组 3/3，实验组 1/3。实验组 Rapid KL 与 MRT Feeder 缺少回执。 |
| 热请求与并发请求 | 6 次请求均为 HTTP 200，14/14 条预期回执齐全，包括对照组一条有明确所有者的 `JOINED`。 |
| 固定样本 | HTTP 400，观察库登记成功。该请求使用空 POST，旧处理器把托管 Next.js 提供的零字节请求流当成有输入。固定样本未进入归档链路，独立只读角色查回零归档收据。 |

同一首次实验组调用的阶段日志显示，两车源均完成登记、实时数据、静态数据和旅程计算，但归档库就绪检查分别在约 **3,260 ms** 和 **259 ms** 的车源等待后报告 `TIMEOUT`。这定位了本轮两个缺口的直接环节，尚无证据确认触发超时的底层原因。此前高峰中两组共六条缺口也没有足够阶段日志供归因。 [按尝试 ID 关联的阶段日志](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-recheck/recheck-runtime.json>)

已在独立本地副本修正固定样本的零字节请求流判断。测试通过可读空流接收固定样本，拒绝含数据的流，并从两套本地数据库独立核对同一 ID、校验和及 `PERSISTED`。334 项测试、ESLint 和含类型检查的 Next.js 构建通过。本轮 9 次托管额度已用完，修正后的固定样本待托管验证。 [修正后的固定样本入口](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-recheck-bodyfix/candidate/app/api/internal/preview/classification-pilot-fixture/route.ts>)

两份本轮临时 Preview 已退役，管理 API 均确认 404。两套临时库的运行写入角色已停用并撤销权限，保留只读证据至登记到期时间。Production 仍指向原部署，归档关闭。 [对照部署退役](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-recheck/vercel-control-retired.json>) · [实验部署退役](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-recheck/vercel-archive-retired.json>) · [写入权限撤销](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-recheck/neon-retired-writers.json>) · [Production 复核](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-recheck/post-retirement-production.json>)



### 共享就绪检查重试候选

本地候选为归档库只读就绪检查保留 1.5 秒单次超时，增加最多一次共享重试。重试只针对超时，共用 2.5 秒检查预算，后续尝试只使用剩余时间。权限或迁移未就绪、显式取消和其他错误直接返回。等待同一检查的车源共享查询与重试结果。阶段日志附带查询次数，既能识别重试后成功，也能识别预算耗尽。候选保留空 POST 修复及原部署证据。 [重试实现](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-readiness-retry/candidate/lib/classification-evidence-store.ts:72>) · [部署清单](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-readiness-retry/manifest.json>)

**336 项测试、ESLint 和带类型检查的 Next.js 构建通过。** 测试让首次查询在收到取消信号后仍保持未决，确认共享检查按期退出并通过一次重试恢复。两个并发车源写入各自的有效回执。连续两次超时时，旅程输出与原路径一致，回执缺口可对账。固定样本使用零字节流通过，并独立读回匹配的归档收据。此前托管超时的触发原因与本修复的托管效果仍待确认。

本轮拟在同一对新的受保护临时 Preview 上完成两个阶段。先执行最多 9 次登记复查，要求首次、热实例和并发请求回执齐全，同时确认固定样本的 ID、校验和与 `PERSISTED` 收据。通过后才开始两段各 2 小时的正式低峰和高峰采样，仍按每组最多 480 次车队和 120 次详情请求。预检记录单独保留，固定样本不计入 1,000 条正式样本门槛。达到样本量、回执完整且保守损失率至多 0.5% 后进入 Production 上线评审。各轮结束后保留证据并撤销临时写入权限。

预计使用两套新的免费 72 小时 Neon，归档在 `aws-us-east-1`，观察在 `aws-us-east-2`。归档写入凭据仅发送至实验组，观察写入凭据和本轮令牌仅发送至 `transit-scope-malaysia` 的两份受保护部署。数据库所有者、登记和核对凭据留在本机。本次 Vercel 只读预检已通过，Production 仍指向原部署且归档关闭。新资源和凭据绑定待本轮授权。



### 共享重试托管预检与正式采样计划

2026 年 11 月 12 日 **17:41–17:42 MYT** 完成授权的 9 次预检。8 次正常接口请求返回 HTTP 200，固定样本返回 202。独立读回核对 **21/21 条有效回执**，固定样本的同一 ID 与校验和在归档库为 `PERSISTED`。本轮 10 个归档就绪日志均在第一次检查成功，因此这次托管预检验证了就绪后的完整链路。本轮还观察到一次独立观察库写入超时，原有的同清单重试成功。 [独立预检读回](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-readiness-retry/recheck-evidence.json>) · [阶段日志](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-readiness-retry/recheck-runtime.json>)

正式采样登记在 **11 月 13 日 12:30–14:30 和 17:00–19:00 MYT**，最早对账 **19:15**，预演写入窗口 **19:45** 关闭。仍使用两份已受保护的临时部署与本轮新建的归档库 `icy-mud-20071592`、观察库 `small-resonance-67033293`。正式采样前独立只读检查确认预检数据保留，固定样本单列。对独立系统间的时钟比较登记 250 ms 容差，保留原始时间戳，数据库内部登记先于回执且回执早于到期的顺序仍按同一数据库时钟核对。此时正式样本尚未采集。 [登记窗口](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-readiness-retry/pilot-window.json>)



### Production 代码发布，归档关闭

按用户指示取消 11 月 13 日的两段正式采样。预检证据已保存，正式样本为零，0.5% 归档损失率留空。本轮两个临时 Preview 已退役，管理 API 对其部署 ID 返回 404。两套临时库的运行写入角色已停用并撤销权限。 [对照 Preview](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-readiness-retry/vercel-control-retired.json>) · [实验 Preview](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-readiness-retry/vercel-archive-retired.json>) · [临时权限撤销](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-witness-readiness-retry/neon-retired-writers.json>)

2026 年 11 月 12 日 **17:58 MYT**，从已评审源码树 `f64363ece5e64800eddaa5e1494812449e9e6e6b` 直接发布 Vercel Production。部署 `dpl_CJooTQJvR5shgicdzRDA6truhJyG` 为 Ready，已核对正式域名 `transit-scope-malaysia.vercel.app` 指向该部署。构建和运行时的 `TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED` 均显式为 `false`。发布包包含已评审的生产源码和归档组件，Preview 回放、固定样本入口和临时凭据均未进入该部署。使用 Vercel 暂存 Production 构建并在 Ready 后切换域名。Git 分支未用于此次发布。 [上传清单](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-production-release/verified-upload.json>) · [正式域名核对](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-production-release/production-published.json>) · [Vercel 分阶段发布](https://vercel.com/docs/deployments/promoting-a-deployment)

本地 **331 项测试**通过，其中包含 5 项旅程一致性对照，Next.js 构建通过。正式域名的首页、演示接口、实时车队和有效巴士旅程详情均返回 HTTP 200，演示内容摘要与发布前基线一致。无效旅程参数返回 400，两个 Preview 专用路径均返回 404。上一套正式部署为 `dpl_AJksjHdwSp7EsyL7cBE82PBySeW6`。 [正式接口冒烟结果](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-production-release/smoke-published.json>) · [有效巴士详情](<C:/Users/loong/.codex/visualizations/2026/11/09/01a1c07c-5f8b-7273-b32d-2abb110c6c2c/phase17-production-release/published-bus-journey.json>)

