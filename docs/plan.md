# 性能优化推进计划

## Summary
- 这份计划就是后续 `docs/plan.md` 的落地内容；进入执行模式后，先创建 `docs/` 并写入本计划，再按阶段推进。
- 推进方式采用“分阶段落地”，第一阶段先做“数据库与列表”优化，因为收益最大、风险最低、最容易验证。
- 已完成的不再重复规划：重复下载时的远端扫描已经移除；公共媒体抓取默认 endpoint 已切到 `media`；下载会话冲突已加保护。
- 当前状态：原计划的 3 个阶段已经完成，本文档保留为实现记录与后续 backlog。

## Key Changes
### 阶段 1：数据库与列表页性能（已完成）
- 扩展 `accounts` 表，新增持久化列：`followers_count INTEGER DEFAULT 0`、`statuses_count INTEGER DEFAULT 0`。
- 在现有 schema 迁移逻辑里加入增量迁移与回填：
  - 新库直接建新列。
  - 老库自动 `ALTER TABLE` 加列。
  - 一次性从现有 `response_json` 回填这两个数；回填完成后，列表查询不再解析 `response_json`。
- `SaveAccountWithStatus` 在保存账号快照时同步写入 `followers_count` 和 `statuses_count`，来源是当前响应里的 `account_info`。
- `GetAllAccounts` 改为直接查询这两个列，不再 `SELECT response_json` 后逐行 `json.Unmarshal`。
- 增加一个新的 Wails 批量接口用于数据库页首屏加载：
  - `CheckFoldersExist(basePath string, folderNames []string) (map[string]bool, error)`
  - 返回值 key 为输入的 folder name，value 为是否存在。
- 数据库页加载账号后，统一走批量文件夹存在检查，不再逐条串行 `await CheckFolderExists(...)`。
- 兼容要求：`response_json` 保留，导出/详情/旧数据兼容行为不变；这次只去掉列表页对它的依赖。

### 阶段 2：抓取状态与多账号 UI 更新频率（已完成）
- 将前端 `localStorage` 中的 fetch state 改成“轻量快照”：
  - 保留 `scope`、`cursor`、`totalFetched`、`completed`、`lastUpdated`、必要的账号摘要。
  - 不再把完整 `timeline` 数组持久化到 `localStorage`。
- 完整时间线快照只保留在数据库里，作为中断恢复和数据库查看的数据来源。
- 抓取中断/重试时：
  - 实时恢复依赖 `cursor`。
  - 如果数据库里存在同 scope 的未完成快照，则优先读取数据库快照恢复 UI。
  - 如果数据库没有快照，则只显示“可恢复数量/状态”，不强求立即恢复完整列表。
- 多账号抓取改为单一节流刷新机制：
  - 用一个集中式 interval 刷新可视状态，间隔固定为 `2000ms`。
  - 账号进度、剩余时间、状态变化先写入 ref/map，再批量 flush 到 React state。
  - 移除“每个账号一个 1 秒 timer + 每次都 map 整个 accounts 数组”的模式。
- 批次内的媒体数量变化提示 `showDiff` 也走同一批量刷新通道，不再每次创建独立 `setTimeout` 去改整表。

### 阶段 3：列表与加载细节收口（已完成）
- 数据库页账号列表维持现有分页/懒加载策略，但所有与首屏无关的次要检查都延后到首屏渲染之后执行。
- `loadAccounts()` 完成顺序固定为：
  1. 读取账号基本列表
  2. 渲染首屏
  3. 异步拉取 group 信息和文件夹存在性
- 现有完整性检查功能继续保留慢路径远端校验；普通下载/列表加载禁止复用该慢路径。
- 不新增新的用户设置项；这一轮只做内部优化，避免引入新的交互决策和兼容面。

## Public Interfaces / Types
- 数据库 schema:
  - `accounts.followers_count`
  - `accounts.statuses_count`
- 新增 Wails 接口：
  - `CheckFoldersExist(basePath string, folderNames []string) -> map[string]bool`
- 前端 fetch-state 持久化结构改为轻量版本：
  - 移除持久化的 `timeline`
  - 保留 `cursor`、`totalFetched`、`completed`、`lastUpdated`、scope 字段
- `backend.AccountListItem` 继续暴露 `followers_count` / `statuses_count`，但数据来源改为数据库列，不再从 `response_json` 动态解析。

## Test Plan
- 数据库迁移：
  - 旧库无新列时，启动后自动补列并成功回填。
  - 已有新列的库不会重复迁移或破坏数据。
- 列表查询：
  - `GetAllAccounts()` 在大量账号下不再解析 `response_json`。
  - `followers_count` / `statuses_count` 在新抓取、旧数据迁移后都能正确显示。
- 批量文件夹存在检查：
  - 输入包含普通账号、`My Bookmarks`、`My Likes` 时返回正确结果。
  - 数据库页首屏加载不会因串行文件检查阻塞。
- 抓取恢复：
  - 中断后能依赖 `cursor` 恢复继续抓取。
  - 重启应用后，轻量状态仍能显示“可恢复”，数据库快照可用于恢复 UI。
- 多账号抓取：
  - 10/50 账号场景下，CPU 占用和 UI 抖动明显下降。
  - 超时、停止、重试、完成四类状态在节流刷新后仍然准确。
- 回归验证：
  - 数据库导出、加载详情、完整性检查、重复下载跳过逻辑保持现有行为。

## Assumptions
- 第一阶段从“数据库与列表”开始，第二阶段再处理抓取状态和多账号 UI。
- 本轮不删除 `response_json`，只降低其热路径参与度。
- 本轮不做纯 Go 重写 extractor，也不新增“关闭元数据写入”等用户设置。
- 进入执行模式后，按上述三阶段推进；若中途需要拆 PR，则按阶段拆，不做一次性大改。

## 后续优化 Backlog
- 下载中心继续独立化：
  - 维持 `App` 顶层作为唯一下载状态源。
  - 进一步抽出统一任务模型，让主页、数据库页、全局面板都只消费同一份只读下载状态。
- extractor worker 池可观测性：
  - 增加 worker 命中率、冷启动次数、回退到 one-shot 次数和平均耗时日志。
  - 为后续继续压缩 fetch 延迟提供真实运行数据。

## 单入口工作台与本地 Fork 收口方案（已完成）

### Summary
- 工作台已收口为单入口结构，不再保留左侧页面式导航。
- 核心内容只保留 `Fetch` 与 `Saved Accounts` 两个页内标签。
- `Settings` 已改为顶部入口打开的右侧面板，`Debug Logs` 已并入设置中的 `Diagnostics` 区域。
- 应用已切到本地 fork 模式：移除了上游 releases 在线更新提示和底部 3 个外链按钮。

### 已完成变更
- `App` 改为单一工作台容器：
  - 用 `workspaceTab = "fetch" | "saved"` 替代旧页面切换模型。
  - `Fetch` 标签内保留搜索、抓取结果和全局下载中心。
  - `Saved Accounts` 标签内联 `DatabaseView`，并在首次进入后复用状态。
- `Header` 改为本地版模式：
  - 保留本地版本号展示。
  - 增加设置入口按钮。
  - 移除 releases 外链和在线更新提示语义。
- `SettingsPage` 改为可嵌入式内容：
  - 支持作为右侧设置面板内容渲染。
  - 新增 `Diagnostics` 折叠区域。
- `DebugLoggerPage` 改为可嵌入式诊断面板：
  - 保留查看、复制、清空日志能力。
  - 不再作为独立页面参与主导航。
- `DatabaseView` 改为工作台内联视图：
  - 移除页面返回型依赖。
  - 保持筛选、导出、分组、批量下载等能力不变。
- 左侧 `Sidebar` 和底部 3 个外链按钮已从渲染树移除。

### 验证记录
- `pnpm exec tsc -b`
- `pnpm exec eslint src/App.tsx src/components/Header.tsx src/components/SettingsPage.tsx src/components/DebugLoggerPage.tsx src/components/DatabaseView.tsx`
- `go test ./backend/...`
- `./build.sh`
