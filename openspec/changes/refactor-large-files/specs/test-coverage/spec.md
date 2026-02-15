## ADDED Requirements

### Requirement: 修复 process_runner 超时测试

process_runner 超时测试 SHALL 修复，保持超时返回 Ok(ProcessCapture { exit_code: TIMEOUT_EXIT_CODE }) 的语义。

#### Scenario: 超时返回 Ok
- **WHEN** process_runner 执行超时
- **THEN** 必须返回 Ok(ProcessCapture)，而非 Err

#### Scenario: 超时退出码
- **WHEN** process_runner 执行超时
- **THEN** ProcessCapture.exit_code 必须等于 TIMEOUT_EXIT_CODE（-1000）

#### Scenario: 超时测试通过
- **WHEN** 运行 process_runner 超时测试
- **THEN** 测试必须通过

#### Scenario: 工具探测依赖超时语义
- **WHEN** 工具探测遇到超时但有输出的情况
- **THEN** 必须能正确判定工具已安装

### Requirement: cargo test 全绿

重构后 SHALL 保持 cargo test 全部通过。

#### Scenario: 所有 Rust 测试通过
- **WHEN** 运行 cargo test
- **THEN** 所有测试必须通过，无失败

#### Scenario: 新增模块有测试覆盖
- **WHEN** 检查新增模块（system/tools/docker/deploy/install/runtime）
- **THEN** 每个模块必须至少有一组单元测试

#### Scenario: 命令契约测试
- **WHEN** 运行命令契约测试
- **THEN** 前端 invoke 名单与 Rust 注册清单必须一致

### Requirement: 前端测试通过

重构后 SHALL 保持前端测试（如有）全部通过。

#### Scenario: 前端单元测试
- **WHEN** 运行前端单元测试
- **THEN** 所有测试必须通过

#### Scenario: 页面渲染测试
- **WHEN** 测试页面渲染逻辑
- **THEN** render() 方法必须正确生成 DOM

#### Scenario: 状态管理测试
- **WHEN** 测试状态变更逻辑
- **THEN** action/reducer 必须正确更新状态

### Requirement: 测试覆盖率保持

重构后 SHALL 保持现有测试覆盖率，不得降低。

#### Scenario: Rust 代码覆盖率
- **WHEN** 统计 Rust 代码覆盖率
- **THEN** 覆盖率不得低于重构前基线

#### Scenario: 前端代码覆盖率
- **WHEN** 统计前端代码覆盖率
- **THEN** 覆盖率不得低于重构前基线

#### Scenario: 新增代码有测试
- **WHEN** 检查新增代码
- **THEN** 必须有对应的测试覆盖

### Requirement: 集成测试验证

重构后 SHALL 通过集成测试验证关键功能。

#### Scenario: 系统快照集成测试
- **WHEN** 运行系统快照集成测试
- **THEN** 前端调用 get_system_snapshot 必须返回有效数据

#### Scenario: 工具探测集成测试
- **WHEN** 运行工具探测集成测试
- **THEN** 前端调用 detect_dev_tools 必须返回有效数据

#### Scenario: Docker 操作集成测试
- **WHEN** 运行 Docker 操作集成测试
- **THEN** 前端调用 run_docker_action 必须正确执行

#### Scenario: 部署流程集成测试
- **WHEN** 运行部署流程集成测试
- **THEN** 前端调用 execute_deploy_step 必须正确执行

### Requirement: 性能基准测试

重构后 SHALL 通过性能基准测试，确保无性能回退。

#### Scenario: 首屏渲染时间
- **WHEN** 测量首屏渲染时间
- **THEN** 时间不得超过重构前基线的 110%

#### Scenario: 工具网格渲染时间
- **WHEN** 测量工具网格渲染时间
- **THEN** 时间不得超过重构前基线的 110%

#### Scenario: Docker 面板刷新时间
- **WHEN** 测量 Docker 面板刷新时间
- **THEN** 时间不得超过重构前基线的 110%

#### Scenario: 内存占用
- **WHEN** 测量应用内存占用
- **THEN** 内存占用波动不得超过 10%

### Requirement: 手动验证关键功能

重构后 SHALL 通过手动验证确保关键功能正常。

#### Scenario: 系统面板显示
- **WHEN** 打开系统面板
- **THEN** 必须正确显示 CPU、内存、磁盘等信息

#### Scenario: 工具页安装流程
- **WHEN** 在工具页执行安装操作
- **THEN** 必须正确显示进度并完成安装

#### Scenario: Docker 页容器管理
- **WHEN** 在 Docker 页管理容器
- **THEN** 必须正确执行启动/停止/删除操作

#### Scenario: 部署流程执行
- **WHEN** 执行部署流程
- **THEN** 必须正确执行 pull_code、stop_old、deploy_new 三步骤

#### Scenario: 页面切换流畅性
- **WHEN** 在不同页面间快速切换
- **THEN** 切换必须流畅且无卡顿或内存泄漏
