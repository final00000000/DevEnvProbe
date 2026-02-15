# 重构大文件提案

## 上下文（Context）

### 问题描述

DevEnvProbe 项目存在多个大文件，影响代码可读性和可维护性：

1. **Rust 后端**：`src-tauri/src/lib.rs` 约 2486 行，聚合了系统采集、工具探测、Docker 管理、部署流程、安装卸载等多个业务域
2. **前端页面**：
   - `src/pages/ToolsPage.ts` 约 1000 行，包含环境探测、安装流程、网格渲染等逻辑
   - `src/pages/DockerPage.ts` 已部分重构为 Controller/Renderer/Coordinator 模式，但相关文件缺失
3. **状态管理**：全局状态通过直接属性修改，缺乏 action 边界，难以追踪和调试

### 用户决策

基于需求研究和用户确认：

- **Rust 后端**：按业务域拆分（system/tools/docker/deploy/install）
- **前端页面**：完全对齐 DockerPage 的 Controller/Renderer/Coordinator 三段式模式
- **状态管理**：引入状态管理库（Redux/MobX）实现不可变状态和时间旅行调试
- **测试基线**：顺手修复已知的 process_runner 超时测试失败

### 约束条件

详见 [constraints.md](./constraints.md)，关键约束包括：

- **接口兼容性**：前端调用的 Tauri 命令名和 JSON 字段不能变更
- **生命周期接口**：页面必须保留 `render(container, epoch)` 方法签名
- **单例模式**：状态类必须导出唯一实例
- **性能优化**：ToolsPage 的分批渲染（RAF）必须保留

## 需求（Requirements）

### REQ-1: Rust 后端模块化

**场景**：开发者需要修改 Docker 相关功能时，只需关注 `docker` 模块，而不是在 2486 行的 `lib.rs` 中查找。

**约束**：
- MUST: 保留 `pub fn run()` 作为 crate 根入口
- MUST: 所有 Tauri 命令在 `run()` 中注册
- MUST: 前端调用的命令名和 JSON 字段保持兼容
- MUST: `lib.rs` 收敛为组合根（< 300 行）

**验收标准**：
- `lib.rs` 行数 < 300
- 业务逻辑拆分为独立模块：system/tools/docker/deploy/install/runtime
- `cargo check` 通过
- `cargo test` 全绿（包括修复已知失败）
- 前端所有 `invoke` 调用正常工作

### REQ-2: 前端页面组件化

**场景**：开发者需要修改 ToolsPage 的安装流程时，只需修改 `ToolsController.ts`，而不影响渲染逻辑。

**约束**：
- MUST: 保留 `render(container, epoch)` 方法签名
- MUST: 保留 ToolsPage 的分批渲染（RAF）优化
- MUST: 事件监听器和定时器在 `cleanup()` 时清理
- MUST: 使用 `renderEpoch` 防止竞态条件

**验收标准**：
- ToolsPage.ts 行数 < 300
- 拆分为 ToolsRenderer/ToolsController/ToolsCoordinator
- DockerPage 补全缺失的 DockerRenderer/DockerController/DockerCoordinator 文件
- 所有功能正常工作且无回归

### REQ-3: 状态管理重构

**场景**：开发者需要调试状态变更时，可以通过 Redux DevTools 查看完整的 action 历史和状态快照。

**约束**：
- MUST: 保持单例模式（每个状态类导出唯一实例）
- MUST: 状态变更后触发 UI 更新
- MUST: 定时器在页面 cleanup 时清理
- MUST: DeployState 的 localStorage 持久化格式兼容

**验收标准**：
- 引入状态管理库（Redux 或 MobX）
- 状态变更通过 action/reducer 模式
- 状态不可变性得到保证
- 支持时间旅行调试（Redux DevTools）
- 所有页面和服务正常工作

### REQ-4: 测试覆盖

**场景**：重构后，开发者可以通过 `cargo test` 和前端测试验证所有功能正常。

**约束**：
- MUST: 修复 process_runner 超时测试失败
- MUST: 保持现有测试覆盖率

**验收标准**：
- `cargo test` 全绿
- 前端测试（如有）全部通过
- 新增模块有单元测试覆盖

## 成功判据（Success Criteria）

### 代码质量

- [ ] `lib.rs` 行数 < 300
- [ ] ToolsPage.ts 行数 < 300
- [ ] DockerPage.ts 补全缺失文件
- [ ] 每个模块职责单一且无循环依赖

### 功能完整性

- [ ] 前端所有 `invoke` 调用正常工作
- [ ] 所有页面功能正常且无回归
- [ ] 状态管理支持时间旅行调试

### 测试覆盖

- [ ] `cargo check` 通过
- [ ] `cargo test` 全绿
- [ ] 前端测试全部通过

### 性能

- [ ] ToolsPage 分批渲染优化保留
- [ ] 系统采样、缓存回退等运行时行为保持一致

### 安全

- [ ] `is_safe_*` 校验逻辑保持或增强
- [ ] 部署参数构建/安全校验无遗漏

## 实施顺序

1. **Phase 1: Rust 后端模块化**
   - 拆分 lib.rs 为业务域模块
   - 修复 process_runner 超时测试
   - 验证前端调用兼容性

2. **Phase 2: 前端页面组件化**
   - 补全 DockerPage 缺失文件
   - 拆分 ToolsPage 为三段式结构
   - 验证所有功能正常

3. **Phase 3: 状态管理重构**
   - 引入状态管理库
   - 迁移现有状态到新模式
   - 验证时间旅行调试

4. **Phase 4: 测试和验证**
   - 运行所有测试
   - 手动验证关键功能
   - 性能基准测试

## 风险缓解

### 高风险项

1. **前端调用断裂**：通过集成测试验证所有 `invoke` 调用
2. **状态同步问题**：逐步迁移，保持新旧模式共存期
3. **性能回退**：性能基准测试对比

### 回滚策略

- 每个 Phase 独立提交，可单独回滚
- 保留原始文件备份（.old 后缀）
- 关键节点创建 git tag

## 参考资料

- [约束集合](./constraints.md)
- [Codex 后端分析报告](../../../.claude/temp/codex-backend-analysis.json)
- [Gemini 前端分析报告](../../../.claude/temp/gemini-frontend-analysis.json)
