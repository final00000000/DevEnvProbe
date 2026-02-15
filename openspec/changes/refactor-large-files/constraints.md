# 重构大文件约束集合

## 硬约束（Hard Constraints）

### Rust 后端（lib.rs）

1. **入口函数约束**：必须保留 `pub fn run()` 作为 crate 根入口，`src-tauri/src/main.rs` 依赖此函数
2. **Tauri 命令注册**：所有 `#[tauri::command]` 必须在 `run()` 的 `tauri::generate_handler![]` 中注册
3. **命令接口兼容性**：前端已固定调用的命令名（如 `get_system_snapshot`、`detect_dev_tools` 等）不能变更
4. **数据契约兼容性**：`CommandResponse` 及相关结构字段必须保持 camelCase（对应 `src/types.ts`）
5. **运行时状态注入**：`AppRuntimeState` 必须通过 `.manage()` 注入，命令层通过 `app.state::<AppRuntimeState>()` 读取
6. **模块可见性**：当前大部分类型/函数是私有的，模块拆分后必须显式处理可见性（通常 `pub(crate)`）
7. **Windows 平台绑定**：系统采集/目录选择/服务探测高度 Windows 绑定（PowerShell、`where`、`winget`）
8. **超时语义**：`process_runner::execute_process_with_timeout` 的超时返回 `TIMEOUT_EXIT_CODE` 但仍是 `Ok(ProcessCapture)` 的语义已被工具探测逻辑依赖
9. **部署步骤枚举**：部署流程依赖固定步骤枚举字符串（`pull_code`/`stop_old`/`deploy_new`）与模式字符串（`compose`/`run`）
10. **插件注册**：`tauri_plugin_opener` 与 `tauri_plugin_single_instance` 在 `run()` 注册，不能遗漏

### 前端页面（DockerPage/ToolsPage）

1. **生命周期接口**：必须保留 `render(container, epoch)` 方法签名以适配核心路由/导航系统
2. **事件监听器管理**：必须手动管理事件监听器（pageListeners）和定时器的销毁
3. **渲染保护**：使用 `renderEpoch` 和 `appState.isRenderStale` 模式防止竞态条件
4. **性能优化**：ToolsPage 的工具网格采用分批渲染（requestAnimationFrame），拆分时需保留此优化
5. **状态驱动**：UI 状态严格依赖全局 state 对象（dockerState/toolsState）
6. **事件委托**：ToolsPage 强依赖 ID 选择器和数据属性（data-*），Renderer 模板变动可能破坏 Controller 的绑定

### 状态管理

1. **单例模式**：每个状态类必须导出唯一实例（systemState, toolsState, dockerState, deployState, appState）
2. **状态同步**：状态变更后必须手动调用页面的 `refreshPageView()` 触发 UI 更新
3. **定时器清理**：定时器必须在页面 `cleanup()` 时清理，否则会内存泄漏
4. **持久化兼容性**：DeployState 的 localStorage 持久化格式不能变更

## 软约束（Soft Constraints）

### Rust 后端

1. **编码规范**：接口契约统一使用 `serde(rename_all = "camelCase")`
2. **错误处理**：所有对前端暴露的命令都返回 `CommandResponse<T>`，避免直接抛裸错误
3. **命令层职责**：命令层只做编排，阻塞 I/O 逻辑下沉到同步函数，通过 `run_blocking` 包装执行
4. **安全校验**：存在明确的输入安全校验函数（`is_safe_identifier`、`is_safe_git_ref`、`is_safe_docker_image_ref`）
5. **超时策略**：超时策略集中常量化（`*_TIMEOUT_MS`），避免魔法数字
6. **文案规范**：错误与提示文案主要为中文，且不少文案会直接返回前端展示
7. **容错策略**：系统采样失败时优先返回 stale 缓存或占位数据，而非直接失败

### 前端页面

1. **增量更新**：优先使用 `refreshPageView/renderWithData` 进行 DOM 局部更新，而非全量重绘
2. **组件化模式**：DockerPage 已采用 Controller/Renderer/Coordinator 三段式结构（目标状态）
3. **异步任务管理**：所有异步任务在页面销毁时能正确取消或静默处理

### 状态管理

1. **状态变更模式**：直接修改属性，无 action/reducer 抽象
2. **定时器管理**：每个状态类提供 `clearAllTimers()` 方法统一清理

## 依赖关系（Dependencies）

### Rust 后端

- `lib.rs` → `process_runner.rs`：核心命令执行、超时与输出捕获
- `run()` → `AppRuntimeState`：通过 `.manage()` 注入共享状态
- `run()` → `spawn_system_sampling_workers`：应用启动时创建后台线程
- 前端 `src/services/*.ts` 直接 `invoke` 对应命令

### 前端页面

- DockerPage 深度依赖 `dockerState`, `dockerService`, `docker-workbench`, `deploy-panel`
- ToolsPage 深度依赖 `toolsState`, `toolsService`, `shell-ui`
- 两者均通过 `appState` 监控当前活跃页面

### 状态管理

- 所有页面和服务都依赖全局状态实例
- 状态变更触发 UI 更新依赖页面的 `refreshPageView()` 方法

## 风险点（Risks）

### Rust 后端

1. 拆分命令函数后若漏注册或命令名变更，会直接导致前端 `invoke` 运行时失败
2. 私有类型跨模块移动时可见性处理不当，容易引入大面积编译错误
3. 模型字段或 `serde` 命名策略改动会破坏 TypeScript 类型契约和 UI 数据绑定
4. 若改变 `process_runner` 超时语义，工具探测"超时但有输出仍判已安装"的行为可能被破坏
5. 部署参数构建/安全校验迁移时若遗漏，可能引入命令注入或误操作风险
6. 后台采样线程启动时机或并发更新逻辑若变动，可能导致系统面板数据抖动或 stale 逻辑异常
7. PowerShell 脚本拆分/重排时容易出现转义、编码、换行导致的解析失败
8. 当前测试基线并非全绿（1 例失败），若不先定义验收口径，重构后结果解释会产生歧义

### 前端页面

1. 拆分导致事件委托失效：ToolsPage 强依赖 ID 选择器和数据属性（data-*）
2. 状态竞争风险：ToolsPage 的自动刷新（scheduleAutoRefresh）与手动刷新存在重叠
3. 文件引用断裂：DockerPage 目前表现出的 import 缺失问题需优先解决

### 状态管理

1. 状态重构会影响所有页面和服务
2. 状态变更无边界，难以追踪和调试

## 成功判据（Success Criteria）

### Rust 后端

1. `lib.rs` 收敛为"组合根"，主要保留 `mod` 声明、`run()`、少量装配代码（建议 < 300 行）
2. 业务逻辑按职责拆分为独立模块（system/tools/docker/deploy/install/runtime），单模块职责单一且无循环依赖
3. 前端无改动情况下，所有既有 `invoke` 命令调用仍可正常返回，命令名与 JSON 字段保持兼容
4. `cargo check` 持续通过；`cargo test` 给出明确目标（保持现状或顺手修复已知失败后全绿）
5. 运行时行为不回退：系统采样、缓存回退、部署步骤执行、Docker 批处理语义保持一致
6. 安全防线不弱化：`is_safe_*` 校验和目录/路径验证逻辑保持或增强
7. 模块边界清晰并可测试：核心 helper 可单测，命令层仅做编排与协议转换

### 前端页面

1. ToolsPage.ts 文件体量从 1000 行降至 300 行以内
2. DockerPage.ts 保持当前的 Controller/Renderer/Coordinator 三段式结构
3. 渲染逻辑（HTML 字符串拼接）与业务逻辑完全解耦
4. 所有异步任务在页面销毁时能正确取消或静默处理
5. 所有功能正常工作且无回归

### 状态管理

1. 状态变更有明确的 action 边界（可选）
2. 状态不可变性得到保证（可选）
3. 状态变更可追踪和调试（可选）
