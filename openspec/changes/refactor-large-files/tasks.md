# 重构大文件实施任务清单

## 1. Rust 后端模块化 - 基础设施

- [ ] 1.1 冻结命令契约清单（11 个命令名、JSON 字段、camelCase）
- [ ] 1.2 创建 contracts 模块目录结构
- [ ] 1.3 提取 CommandResponse 到 contracts/mod.rs
- [ ] 1.4 提取所有 DTO 结构体到 contracts（SystemSnapshot、ToolStatus、DockerCommandResult、DeployStepRequest 等）
- [ ] 1.5 验证 JSON 序列化契约测试通过

## 2. Rust 后端模块化 - Runtime 模块

- [ ] 2.1 创建 runtime 模块目录
- [ ] 2.2 迁移 RuntimeSampleCache 到 runtime/mod.rs
- [ ] 2.3 迁移 AppRuntimeState 到 runtime/mod.rs
- [ ] 2.4 迁移 current_timestamp_ms 到 runtime/mod.rs
- [ ] 2.5 迁移 spawn_system_sampling_workers 到 runtime/mod.rs
- [ ] 2.6 验证 cargo check 通过

## 3. Rust 后端模块化 - System 模块

- [ ] 3.1 创建 system 模块目录
- [ ] 3.2 迁移 query_system_snapshot_precise 到 system/mod.rs
- [ ] 3.3 迁移 query_system_snapshot_quick 到 system/mod.rs
- [ ] 3.4 迁移 query_system_realtime_quick 到 system/mod.rs
- [ ] 3.5 迁移 placeholder/fallback 逻辑到 system/mod.rs
- [ ] 3.6 创建 get_system_snapshot 命令包装器
- [ ] 3.7 创建 get_system_realtime 命令包装器
- [ ] 3.8 验证 cargo check 通过

## 4. Rust 后端模块化 - Tools 模块

- [ ] 4.1 创建 tools 模块目录
- [ ] 4.2 迁移 default_tool_specs 到 tools/mod.rs
- [ ] 4.3 迁移 detect_tool 和 detect_tool_with_fallback 到 tools/mod.rs
- [ ] 4.4 迁移 resolve_tool_path 到 tools/mod.rs
- [ ] 4.5 创建 detect_dev_tools 命令包装器
- [ ] 4.6 验证 cargo check 通过

## 5. Rust 后端模块化 - Docker 模块

- [ ] 5.1 创建 docker 模块目录
- [ ] 5.2 迁移 build_docker_args 到 docker/mod.rs
- [ ] 5.3 迁移 execute_docker_action 到 docker/mod.rs
- [ ] 5.4 迁移 execute_docker_overview_batch 到 docker/mod.rs
- [ ] 5.5 创建 run_docker_action 命令包装器
- [ ] 5.6 创建 get_docker_overview_batch 命令包装器
- [ ] 5.7 验证 cargo check 通过

## 6. Rust 后端模块化 - Deploy 模块

- [ ] 6.1 创建 deploy 模块目录
- [ ] 6.2 迁移 execute_deploy_step_internal 到 deploy/mod.rs
- [ ] 6.3 迁移 build_run_* 参数构建函数到 deploy/mod.rs
- [ ] 6.4 迁移 is_safe_git_ref 到 deploy/mod.rs
- [ ] 6.5 迁移 is_safe_docker_image_ref 到 deploy/mod.rs
- [ ] 6.6 创建 execute_deploy_step 命令包装器
- [ ] 6.7 创建 list_git_branches 命令包装器
- [ ] 6.8 验证安全校验测试通过

## 7. Rust 后端模块化 - Install 模块

- [ ] 7.1 创建 install 模块目录
- [ ] 7.2 迁移 install_specs 到 install/mod.rs
- [ ] 7.3 迁移 execute_install_item 到 install/mod.rs
- [ ] 7.4 迁移 execute_uninstall_item 到 install/mod.rs
- [ ] 7.5 迁移 select_install_directory 到 install/mod.rs
- [ ] 7.6 迁移 select_project_directory 到 install/mod.rs
- [ ] 7.7 创建 install_market_item 命令包装器
- [ ] 7.8 创建 uninstall_market_item 命令包装器
- [ ] 7.9 创建 pick_install_directory 命令包装器
- [ ] 7.10 创建 pick_project_directory 命令包装器
- [ ] 7.11 验证 cargo check 通过

## 8. Rust 后端模块化 - 命令注册

- [ ] 8.1 创建 command_registry.rs
- [ ] 8.2 实现 register_commands() 函数
- [ ] 8.3 在 register_commands 中注册所有 11 个命令
- [ ] 8.4 创建命令契约测试（对比前端 invoke 名单与 Rust 注册清单）
- [ ] 8.5 验证命令契约测试通过

## 9. Rust 后端模块化 - lib.rs 收敛

- [ ] 9.1 在 lib.rs 中添加所有模块声明（mod contracts; mod runtime; 等）
- [ ] 9.2 简化 run() 函数，仅保留插件注册、状态注入、setup、invoke_handler
- [ ] 9.3 删除 lib.rs 中已迁移的业务逻辑代码
- [ ] 9.4 验证 lib.rs 行数 < 300
- [ ] 9.5 验证 cargo check 通过

## 10. Rust 后端模块化 - 测试修复

- [ ] 10.1 修复 process_runner 超时测试断言
- [ ] 10.2 验证超时返回 Ok(ProcessCapture { exit_code: TIMEOUT_EXIT_CODE })
- [ ] 10.3 运行 cargo test 验证所有测试通过
- [ ] 10.4 添加工具探测超时场景测试

## 11. Rust 后端模块化 - 集成验证

- [ ] 11.1 运行前端冒烟测试调用 11 个命令
- [ ] 11.2 验证 get_system_snapshot 返回有效数据
- [ ] 11.3 验证 detect_dev_tools 返回有效数据
- [ ] 11.4 验证 run_docker_action 正确执行
- [ ] 11.5 验证 execute_deploy_step 正确执行
- [ ] 11.6 创建 git tag rust-backend-modularization-complete

## 12. 前端页面组件化 - DockerPage 补全

- [ ] 12.1 创建 src/pages/docker/DockerRenderer.ts
- [ ] 12.2 从 DockerPage.old.ts 提取 HTML 模板到 DockerRenderer
- [ ] 12.3 实现 DockerRenderer.renderPage() 方法
- [ ] 12.4 实现 DockerRenderer.renderResourceOverview() 方法
- [ ] 12.5 创建 src/pages/docker/DockerController.ts
- [ ] 12.6 从 DockerPage.old.ts 提取事件绑定逻辑到 DockerController
- [ ] 12.7 实现 DockerController.bindDockerActions() 方法
- [ ] 12.8 创建 src/pages/docker/DockerCoordinator.ts
- [ ] 12.9 从 DockerPage.old.ts 提取业务协调逻辑到 DockerCoordinator
- [ ] 12.10 实现 DockerCoordinator.refreshOverview() 方法
- [ ] 12.11 实现 DockerCoordinator.runDockerAction() 方法
- [ ] 12.12 更新 DockerPage.ts 导入和使用新的三段式组件
- [ ] 12.13 验证 DockerPage 功能正常工作

## 13. 前端页面组件化 - ToolsPage 拆分

- [ ] 13.1 创建 src/pages/tools/ 目录
- [ ] 13.2 创建 src/pages/tools/ToolsRenderer.ts
- [ ] 13.3 从 ToolsPage.ts 提取 HTML 模板到 ToolsRenderer
- [ ] 13.4 实现 ToolsRenderer.renderToolsGrid() 方法
- [ ] 13.5 实现 ToolsRenderer.renderInstallState() 方法
- [ ] 13.6 创建 src/pages/tools/ToolsController.ts
- [ ] 13.7 从 ToolsPage.ts 提取事件绑定逻辑到 ToolsController
- [ ] 13.8 实现 ToolsController.bindToolPageActions() 方法
- [ ] 13.9 保留 RAF 分批渲染逻辑在 Controller 中
- [ ] 13.10 创建 src/pages/tools/ToolsCoordinator.ts
- [ ] 13.11 从 ToolsPage.ts 提取业务协调逻辑到 ToolsCoordinator
- [ ] 13.12 实现 ToolsCoordinator.refreshTools() 方法
- [ ] 13.13 实现 ToolsCoordinator.installTool() 方法
- [ ] 13.14 简化 ToolsPage.ts 为入口类
- [ ] 13.15 验证 ToolsPage.ts 行数 < 300
- [ ] 13.16 验证 ToolsPage 功能正常工作

## 14. 前端页面组件化 - 验证

- [ ] 14.1 验证 render(container, epoch) 签名保持
- [ ] 14.2 验证 cleanup() 方法清理所有资源
- [ ] 14.3 验证 renderEpoch 竞态保护有效
- [ ] 14.4 验证事件委托绑定完整
- [ ] 14.5 验证 RAF 分批渲染性能保持
- [ ] 14.6 手动测试所有页面功能
- [ ] 14.7 创建 git tag frontend-componentization-complete

## 15. 状态管理重构 - Redux Toolkit 安装

- [ ] 15.1 安装 @reduxjs/toolkit ^2.2.x
- [ ] 15.2 安装 react-redux（如需要）
- [ ] 15.3 创建 src/store/ 目录
- [ ] 15.4 创建 src/store/index.ts 配置 Store

## 16. 状态管理重构 - SystemState Slice

- [ ] 16.1 创建 src/store/systemSlice.ts
- [ ] 16.2 定义 SystemState 初始状态
- [ ] 16.3 实现 systemSlice reducers（setSnapshotCache、updateUptimeAnchor 等）
- [ ] 16.4 修改 src/state/system-state.ts 为 Facade
- [ ] 16.5 实现 SystemState getter 从 Store 读取
- [ ] 16.6 实现 SystemState setter 通过 dispatch 更新
- [ ] 16.7 验证 SystemPage 功能正常

## 17. 状态管理重构 - ToolsState Slice

- [ ] 17.1 创建 src/store/toolsSlice.ts
- [ ] 17.2 定义 ToolsState 初始状态
- [ ] 17.3 实现 toolsSlice reducers（setDataCache、updateCategories 等）
- [ ] 17.4 修改 src/state/tools-state.ts 为 Facade
- [ ] 17.5 实现 ToolsState getter 从 Store 读取
- [ ] 17.6 实现 ToolsState setter 通过 dispatch 更新
- [ ] 17.7 验证 ToolsPage 功能正常

## 18. 状态管理重构 - DockerState Slice

- [ ] 18.1 创建 src/store/dockerSlice.ts
- [ ] 18.2 定义 DockerState 初始状态
- [ ] 18.3 实现 dockerSlice reducers（setPendingAction、armDangerConfirm 等）
- [ ] 18.4 修改 src/state/docker-state.ts 为 Facade
- [ ] 18.5 实现 DockerState getter 从 Store 读取
- [ ] 18.6 实现 DockerState setter 通过 dispatch 更新
- [ ] 18.7 验证 DockerPage 功能正常

## 19. 状态管理重构 - DeployState Slice

- [ ] 19.1 创建 src/store/deploySlice.ts
- [ ] 19.2 定义 DeployState 初始状态
- [ ] 19.3 实现 deploySlice reducers（setSelectedProfile、updatePipeline 等）
- [ ] 19.4 实现 localStorage 持久化中间件（保持格式兼容）
- [ ] 19.5 修改 src/state/deploy-state.ts 为 Facade
- [ ] 19.6 实现 DeployState getter 从 Store 读取
- [ ] 19.7 实现 DeployState setter 通过 dispatch 更新
- [ ] 19.8 验证 localStorage 兼容性
- [ ] 19.9 验证部署流程功能正常

## 20. 状态管理重构 - Redux DevTools 配置

- [ ] 20.1 配置 Redux DevTools Extension
- [ ] 20.2 验证开发环境 DevTools 可用
- [ ] 20.3 配置生产环境禁用 DevTools
- [ ] 20.4 测试时间旅行调试功能
- [ ] 20.5 测试 action 序列回放

## 21. 状态管理重构 - UI 自动更新

- [ ] 21.1 实现 Store 订阅机制
- [ ] 21.2 在页面中订阅状态变更
- [ ] 21.3 状态变更时自动触发 refreshPageView()
- [ ] 21.4 实现高频更新去抖
- [ ] 21.5 验证所有页面自动更新

## 22. 状态管理重构 - 清理旧代码

- [ ] 22.1 移除直接属性修改代码
- [ ] 22.2 移除手动 refreshPageView() 调用（保留必要的）
- [ ] 22.3 验证所有功能正常工作
- [ ] 22.4 创建 git tag state-management-refactor-complete

## 23. 测试和验证 - Rust 测试

- [ ] 23.1 运行 cargo check 验证编译通过
- [ ] 23.2 运行 cargo test 验证所有测试通过
- [ ] 23.3 验证命令契约测试通过
- [ ] 23.4 验证安全校验测试通过
- [ ] 23.5 验证 process_runner 超时测试通过

## 24. 测试和验证 - 前端测试

- [ ] 24.1 运行前端单元测试（如有）
- [ ] 24.2 验证页面渲染测试通过
- [ ] 24.3 验证状态管理测试通过
- [ ] 24.4 验证事件绑定测试通过

## 25. 测试和验证 - 集成测试

- [ ] 25.1 测试系统快照集成
- [ ] 25.2 测试工具探测集成
- [ ] 25.3 测试 Docker 操作集成
- [ ] 25.4 测试部署流程集成
- [ ] 25.5 验证所有集成测试通过

## 26. 测试和验证 - 性能基准测试

- [ ] 26.1 测量首屏渲染时间
- [ ] 26.2 测量工具网格渲染时间
- [ ] 26.3 测量 Docker 面板刷新时间
- [ ] 26.4 测量内存占用
- [ ] 26.5 验证性能无回退（< 110% 基线）

## 27. 测试和验证 - 手动验证

- [ ] 27.1 手动测试系统面板显示
- [ ] 27.2 手动测试工具页安装流程
- [ ] 27.3 手动测试 Docker 页容器管理
- [ ] 27.4 手动测试部署流程执行
- [ ] 27.5 手动测试页面切换流畅性
- [ ] 27.6 手动测试内存泄漏（切换页面 100 次）

## 28. 测试和验证 - 代码质量检查

- [ ] 28.1 验证 lib.rs 行数 < 300
- [ ] 28.2 验证 ToolsPage.ts 行数 < 300
- [ ] 28.3 验证 DockerPage 三段式文件完整
- [ ] 28.4 验证无循环依赖
- [ ] 28.5 验证测试覆盖率保持

## 29. 最终验收

- [ ] 29.1 运行完整测试套件（Rust + 前端）
- [ ] 29.2 验证所有成功判据达成
- [ ] 29.3 创建 git tag v1.0.0-refactor-complete
- [ ] 29.4 更新文档（如需要）
- [ ] 29.5 清理备份文件（.old 后缀）
