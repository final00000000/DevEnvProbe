# 重构大文件技术设计

## Context

DevEnvProbe 项目当前存在三个主要的大文件问题：

1. **Rust 后端单体**：`src-tauri/src/lib.rs` 约 2486 行，混合了系统采集、工具探测、Docker 管理、部署流程、安装卸载等多个业务域
2. **前端页面单体**：`src/pages/ToolsPage.ts` 约 1000 行，包含 HTML 模板、事件绑定、业务逻辑和状态同步
3. **状态管理缺陷**：全局状态通过直接属性修改，缺乏 action 边界，难以追踪和调试

**关键约束**：
- 前端调用的 11 个 Tauri 命令名和 JSON 字段（camelCase）不能变更
- 页面必须保留 `render(container, epoch)` 方法签名
- ToolsPage 的 RAF 分批渲染优化必须保留
- DeployState 的 localStorage 持久化格式必须兼容

## Goals / Non-Goals

**Goals:**
- 将 `lib.rs` 收敛为组合根（< 300 行），业务逻辑按域拆分
- 将 `ToolsPage.ts` 拆分为 Controller/Renderer/Coordinator 三段式（< 300 行）
- 补全 DockerPage 缺失的三段式文件
- 引入 Redux Toolkit 实现不可变状态和时间旅行调试
- 修复 process_runner 超时测试失败
- 保持所有功能正常工作且无性能回退

**Non-Goals:**
- 不改变前端 API 契约（命令名、参数、返回字段）
- 不引入新的外部依赖（除 Redux Toolkit）
- 不重写业务逻辑（仅重组代码结构）
- 不改变 Windows 平台绑定的行为
- 不优化算法或数据结构（保持行为等价）

## Decisions

### D1: Rust 后端按业务域拆分

**决策**：采用业务域模块结构（system/tools/docker/deploy/install/runtime），而非分层架构（commands/services/models）。

**理由**：
- 业务域拆分与现有代码组织一致，迁移路径最短
- 定位问题成本低，修改 Docker 不会污染 system/install 代码
- 更容易做命令级兼容回归和域内单测

**替代方案**：
- 分层架构：横切能力统一性好，但会引入大量映射与胶水代码，短期回归风险高
- 混合架构：保留业务域 + 轻量 shared 内核，可作为未来演进方向

**模块结构**：
```
src-tauri/src/
├── lib.rs                    # 组合根（< 300 行）
├── contracts/                # CommandResponse 与所有前后端契约结构
├── runtime/                  # AppRuntimeState、缓存、线程启动
├── system/                   # 系统采集、实时采样、缓存回退
├── tools/                    # 工具探测、where 路径解析
├── docker/                   # docker action、batch、参数构建
├── deploy/                   # 部署步骤编排、参数构建、安全校验
├── install/                  # 安装/卸载计划、目录选择
├── command_registry.rs       # 命令注册清单与统一 handler 入口
└── process_runner.rs         # 保持独立，作为跨域基础设施
```

**可见性策略**：
- 模块内部 helper 保持私有
- 跨模块共享类型/函数使用 `pub(crate)`
- 仅 crate 对外入口 `run()` 使用 `pub`
- 命令函数建议 `pub(crate)` 并通过 `command_registry` 暴露

### D2: 前端页面采用三段式架构

**决策**：ToolsPage 完全对齐 DockerPage 的 Controller/Renderer/Coordinator 三段式模式。

**理由**：
- 统一架构，易于维护和理解
- 职责清晰：Renderer 负责 HTML 模板，Controller 负责事件绑定，Coordinator 负责业务协调
- 已有 DockerPage 作为参考实现（虽然文件缺失，但结构清晰）

**替代方案**：
- 仅拆分 Renderer：改动最小，但职责仍不够清晰
- 自定义拆分：更贴合实际需求，但增加学习成本

**文件结构**：
```
src/pages/
├── ToolsPage.ts              # 入口类（< 300 行）
├── tools/
│   ├── ToolsRenderer.ts      # HTML 模板生成
│   ├── ToolsController.ts    # 事件绑定与交互控制
│   └── ToolsCoordinator.ts   # 业务协调与状态同步
└── docker/
    ├── DockerPage.ts         # 入口类（已存在）
    ├── DockerRenderer.ts     # HTML 模板生成（需补全）
    ├── DockerController.ts   # 事件绑定（需补全）
    └── DockerCoordinator.ts  # 业务协调（需补全）
```

**职责划分**：
- **Renderer**：无状态的模板引擎，仅负责 HTML 字符串拼接
- **Controller**：管理事件监听器生命周期，处理用户交互
- **Coordinator**：协调服务调用、状态更新和页面刷新

### D3: 引入 Redux Toolkit 作为状态管理库

**决策**：选择 Redux Toolkit（而非 MobX）作为状态管理库。

**理由**：
- Redux Toolkit 是 Redux 官方推荐的现代化工具集，减少样板代码
- 内置 Immer 支持不可变更新，无需手动深拷贝
- Redux DevTools 成熟稳定，支持时间旅行调试
- 社区生态丰富，文档完善

**替代方案**：
- MobX：更简洁的 API，但响应式系统与现有手动刷新模式冲突较大
- Zustand：轻量级，但缺少时间旅行调试能力

**集成策略**：
- 保留现有状态类外壳（systemState, toolsState 等）作为 facade
- 内部通过 Redux Store 管理状态
- 导出的单例实例通过 Store 连接，保持 API 兼容
- 状态变更通过 dispatch(action) 触发，自动触发 UI 更新

**迁移路径**：
```typescript
// Phase 1: 创建 Store 和 Slices
const store = configureStore({
  reducer: {
    system: systemSlice.reducer,
    tools: toolsSlice.reducer,
    docker: dockerSlice.reducer,
    deploy: deploySlice.reducer,
  },
});

// Phase 2: 状态类作为 Facade
export class SystemState {
  get snapshotCache() {
    return store.getState().system.snapshotCache;
  }

  setSnapshotCache(value: SystemSnapshot | null) {
    store.dispatch(systemSlice.actions.setSnapshotCache(value));
  }
}

// Phase 3: 导出单例
export const systemState = new SystemState();
```

### D4: process_runner 超时语义保持不变

**决策**：修复超时测试断言，但保持 `execute_process_with_timeout` 超时返回 `Ok(ProcessCapture { exit_code: TIMEOUT_EXIT_CODE })` 的语义。

**理由**：
- 工具探测逻辑依赖"超时但有输出仍可判定已安装"的行为
- 改变语义会破坏现有的 fallback 逻辑
- 测试失败是断言问题，而非实现问题

**修复方案**：
```rust
#[test]
fn execute_process_with_timeout_timeout() {
    let result = execute_process_with_timeout("powershell", &["-Command", "Start-Sleep -Seconds 10"], 100);
    assert!(result.is_ok()); // 超时应返回 Ok
    let capture = result.unwrap();
    assert_eq!(capture.exit_code, TIMEOUT_EXIT_CODE); // 退出码为 -1000
}
```

### D5: 命令注册采用单一注册源模式

**决策**：在 `command_registry.rs` 内维护命令函数清单，`run()` 仅调用一次 `invoke_handler`。

**理由**：
- 防止拆分过程中出现漏注册或误改名
- 便于维护命令契约测试
- 集中管理命令清单，易于审查

**实现**：
```rust
// command_registry.rs
pub fn register_commands() -> impl Fn(tauri::Invoke) {
    tauri::generate_handler![
        get_system_snapshot,
        get_system_realtime,
        detect_dev_tools,
        run_docker_action,
        get_docker_overview_batch,
        list_git_branches,
        execute_deploy_step,
        install_market_item,
        uninstall_market_item,
        pick_install_directory,
        pick_project_directory
    ]
}

// lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // ...
        }))
        .manage(AppRuntimeState::default())
        .setup(|app| {
            adapt_main_window_for_monitor(&app.handle());
            let runtime_state = app.state::<AppRuntimeState>().inner().clone();
            spawn_system_sampling_workers(runtime_state);
            Ok(())
        })
        .invoke_handler(command_registry::register_commands())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Risks / Trade-offs

### R1: 命令注册遗漏导致前端调用失败
**风险**：拆分过程中漏注册命令或改名，导致前端 `invoke` 运行时失败。
**缓解**：
- 建立命令契约测试，比对前端 `invoke` 名单与 Rust 注册清单
- CI 冒烟调用 11 个命令
- 禁止在业务模块中分散注册

### R2: 模块可见性处理不当导致编译错误
**风险**：`pub`/`pub(crate)`/private 处理不当，引发大面积编译错误。
**缓解**：
- 按模块逐步迁移，每步 `cargo check`
- 默认 private，仅对跨模块调用最小化提升为 `pub(crate)`
- 禁止一次性全局提权为 `pub`

### R3: JSON 字段命名变更破坏前端契约
**风险**：`serde` 字段命名或结构变更破坏 TypeScript 契约。
**缓解**：
- DTO 统一放在 `contracts` 并强制 `#[serde(rename_all = "camelCase")]`
- 增加序列化金丝雀测试，检查关键键名（`elapsedMs`、`sampledAtMs`、`itemKey`、`exitCode`）

### R4: 状态管理重构影响所有页面
**风险**：状态管理重构会影响所有页面和服务，可能引入大面积回归。
**缓解**：
- 保留状态类外壳作为 facade，渐进迁移
- 新旧模式共存期，逐步切换
- 每个状态域独立迁移并验证

### R5: RAF 分批渲染优化丢失
**风险**：ToolsPage 拆分后，RAF 分批渲染逻辑可能被破坏。
**缓解**：
- Renderer 仅作为无状态模板引擎，由 Controller 驱动渲染序列
- 保留 `gridRenderToken` 机制防止过期渲染
- 性能基准测试对比重构前后

### R6: 事件委托失效
**风险**：Renderer 模板变动可能破坏 Controller 的事件绑定。
**缓解**：
- 建立 HTML 契约，规定 Renderer 生成的关键 DOM 节点必须保留特定的 ID 或 Data 属性
- 集成测试验证事件绑定完整性

## Migration Plan

### Phase 1: Rust 后端模块化（预计 2-3 天）

**步骤**：
1. 冻结命令契约清单（11 个命令名、JSON 字段）
2. 提取 `contracts` 模块（CommandResponse、DTO）
3. 提取 `runtime` 模块（AppRuntimeState、采样线程）
4. 迁移 `system` 域（系统采集、实时采样）
5. 迁移 `tools` 域（工具探测、路径解析）
6. 迁移 `docker` 域（Docker 操作、批处理）
7. 迁移 `deploy` 域（部署步骤、安全校验）
8. 迁移 `install` 域（安装卸载、目录选择）
9. 创建 `command_registry.rs`
10. 收敛 `lib.rs` 为组合根
11. 修复 `process_runner` 超时测试

**验证检查点**：
- 每步 `cargo check` 通过
- JSON 序列化契约测试通过
- `run()` 装配回归（插件、状态注入、setup）
- `cargo test` 全绿
- 前端冒烟调用 11 个命令

**回滚策略**：
- 每个模块迁移独立提交
- 保留 `lib.rs.backup` 备份
- 失败时回滚到上一个稳定提交

### Phase 2: 前端页面组件化（预计 2-3 天）

**步骤**：
1. 补全 DockerPage 缺失文件（DockerRenderer/Controller/Coordinator）
2. 从 `DockerPage.old.ts` 提取 HTML 模板到 `DockerRenderer.ts`
3. 提取事件绑定逻辑到 `DockerController.ts`
4. 提取业务协调逻辑到 `DockerCoordinator.ts`
5. 验证 DockerPage 功能正常
6. 拆分 ToolsPage 为三段式结构
7. 保留 RAF 分批渲染逻辑
8. 验证 ToolsPage 功能正常

**验证检查点**：
- `render(container, epoch)` 签名保持
- `renderEpoch` 竞态保护有效
- 事件委托绑定完整
- RAF 分批渲染性能保持
- 所有功能正常工作

**回滚策略**：
- 每个页面拆分独立提交
- 保留 `.old.ts` 备份
- 失败时回滚到上一个稳定提交

### Phase 3: 状态管理重构（预计 3-4 天）

**步骤**：
1. 安装 Redux Toolkit：`npm install @reduxjs/toolkit react-redux`
2. 创建 Store 和 Slices（system/tools/docker/deploy）
3. 状态类作为 Facade，内部连接 Store
4. 迁移 SystemState 到 Redux
5. 迁移 ToolsState 到 Redux
6. 迁移 DockerState 到 Redux
7. 迁移 DeployState 到 Redux（保持 localStorage 兼容）
8. 配置 Redux DevTools
9. 验证时间旅行调试
10. 移除旧的直接属性修改代码

**验证检查点**：
- 单例模式保持
- 状态变更触发 UI 更新
- 定时器清理正常
- localStorage 持久化兼容
- Redux DevTools 可用
- 所有页面和服务正常工作

**回滚策略**：
- 每个状态域迁移独立提交
- 新旧模式共存期保持双写
- 失败时回滚到上一个稳定提交

### Phase 4: 测试和验证（预计 1-2 天）

**步骤**：
1. 运行 `cargo test` 验证所有 Rust 测试通过
2. 运行前端测试（如有）
3. 手动验证关键功能（系统面板、工具页、Docker 页、部署流程）
4. 性能基准测试对比（首屏渲染、工具网格、Docker 面板）
5. 内存泄漏检测（切换页面 100 次）
6. 创建 git tag `v1.0.0-refactor-complete`

**验证检查点**：
- `cargo check` 通过
- `cargo test` 全绿
- 前端测试全部通过
- 所有功能正常工作
- 性能无回退
- 无内存泄漏

## Open Questions

1. **Redux DevTools 在 Tauri 环境中的配置**：是否需要 Remote DevTools？如何配置？
2. **状态持久化策略**：是否扩展到其他域（如 Tools filters、Docker tab/filter）？
3. **测试覆盖率基线**：当前覆盖率是多少？目标覆盖率是多少？
4. **性能基准测试工具**：使用什么工具进行性能对比？
5. **CI/CD 集成**：是否需要在 CI 中添加命令契约测试和性能基准测试？
