## ADDED Requirements

### Requirement: lib.rs 收敛为组合根

lib.rs SHALL 收敛为组合根，仅保留模块声明、run() 入口和少量装配代码，行数必须小于 300 行。

#### Scenario: lib.rs 行数限制
- **WHEN** 重构完成后统计 lib.rs 行数
- **THEN** 行数必须小于 300 行

#### Scenario: 模块声明完整性
- **WHEN** 检查 lib.rs 的模块声明
- **THEN** 必须包含 contracts、runtime、system、tools、docker、deploy、install、command_registry、process_runner 模块

#### Scenario: run() 入口保持
- **WHEN** 检查 lib.rs 的公开 API
- **THEN** 必须导出 `pub fn run()` 函数

### Requirement: 业务逻辑按域拆分

业务逻辑 SHALL 按业务域拆分为独立模块：system、tools、docker、deploy、install、runtime。

#### Scenario: system 模块职责
- **WHEN** 查看 system 模块内容
- **THEN** 必须包含系统采集、实时采样、缓存回退逻辑

#### Scenario: tools 模块职责
- **WHEN** 查看 tools 模块内容
- **THEN** 必须包含工具探测、where 路径解析、timeout fallback 逻辑

#### Scenario: docker 模块职责
- **WHEN** 查看 docker 模块内容
- **THEN** 必须包含 docker action、batch、参数构建逻辑

#### Scenario: deploy 模块职责
- **WHEN** 查看 deploy 模块内容
- **THEN** 必须包含部署步骤编排、参数构建、安全校验逻辑

#### Scenario: install 模块职责
- **WHEN** 查看 install 模块内容
- **THEN** 必须包含安装/卸载计划、目录选择逻辑

#### Scenario: runtime 模块职责
- **WHEN** 查看 runtime 模块内容
- **THEN** 必须包含 AppRuntimeState、缓存、线程启动、时间工具

### Requirement: Tauri 命令注册完整性

所有 Tauri 命令 SHALL 在 run() 的 tauri::generate_handler![] 中注册，命令名必须与前端 invoke 调用一致。

#### Scenario: 命令注册清单完整
- **WHEN** 检查 command_registry.rs 的注册清单
- **THEN** 必须包含 11 个命令：get_system_snapshot、get_system_realtime、detect_dev_tools、run_docker_action、get_docker_overview_batch、list_git_branches、execute_deploy_step、install_market_item、uninstall_market_item、pick_install_directory、pick_project_directory

#### Scenario: 前端调用兼容性
- **WHEN** 前端调用任意已注册命令
- **THEN** 命令必须成功执行并返回 CommandResponse 结构

#### Scenario: 命令名不变
- **WHEN** 对比重构前后的命令名
- **THEN** 所有命令名必须保持不变

### Requirement: JSON 字段 camelCase 兼容

CommandResponse 及对前端可见的结构体 SHALL 保持 camelCase 字段命名，与 src/types.ts 键名一致。

#### Scenario: CommandResponse 字段
- **WHEN** 序列化 CommandResponse 为 JSON
- **THEN** 必须包含 ok、data、error、elapsedMs 字段（camelCase）

#### Scenario: 系统快照字段
- **WHEN** 序列化 SystemSnapshot 为 JSON
- **THEN** 所有字段必须使用 camelCase 命名（如 cpuUsagePercent、memoryUsagePercent）

#### Scenario: 工具状态字段
- **WHEN** 序列化 ToolStatus 为 JSON
- **THEN** 所有字段必须使用 camelCase 命名（如 itemKey、isInstalled）

### Requirement: 模块可见性最小化

模块 SHALL 采用最小可见性原则：模块内部 helper 保持私有，跨模块共享使用 pub(crate)，仅 crate 对外入口使用 pub。

#### Scenario: 私有 helper 不可外部访问
- **WHEN** 尝试从其他模块访问私有 helper
- **THEN** 编译必须失败

#### Scenario: pub(crate) 跨模块访问
- **WHEN** 从同一 crate 的其他模块访问 pub(crate) 符号
- **THEN** 编译必须成功

#### Scenario: pub 入口可外部访问
- **WHEN** 从 main.rs 调用 lib.rs 的 pub fn run()
- **THEN** 编译必须成功

### Requirement: cargo check 和 cargo test 通过

重构后 SHALL 保持 cargo check 通过，cargo test 全绿（包括修复 process_runner 超时测试）。

#### Scenario: cargo check 编译通过
- **WHEN** 运行 cargo check
- **THEN** 必须无编译错误

#### Scenario: cargo test 全部通过
- **WHEN** 运行 cargo test
- **THEN** 所有测试必须通过，包括 process_runner 超时测试

#### Scenario: process_runner 超时语义保持
- **WHEN** process_runner 执行超时
- **THEN** 必须返回 Ok(ProcessCapture { exit_code: TIMEOUT_EXIT_CODE })

### Requirement: 前端 invoke 调用正常工作

重构后 SHALL 保持前端所有 invoke 调用正常工作，无运行时错误。

#### Scenario: 系统快照调用
- **WHEN** 前端调用 invoke("get_system_snapshot")
- **THEN** 必须返回有效的 SystemSnapshot 数据

#### Scenario: 工具探测调用
- **WHEN** 前端调用 invoke("detect_dev_tools")
- **THEN** 必须返回有效的 ToolStatus 数组

#### Scenario: Docker 操作调用
- **WHEN** 前端调用 invoke("run_docker_action", { action, target })
- **THEN** 必须返回有效的 DockerCommandResult

#### Scenario: 部署步骤调用
- **WHEN** 前端调用 invoke("execute_deploy_step", { request })
- **THEN** 必须返回有效的 DeployStepResult

### Requirement: 安全校验逻辑保持

安全校验函数（is_safe_identifier、is_safe_git_ref、is_safe_docker_image_ref）SHALL 保持或增强，防止命令注入。

#### Scenario: 安全标识符校验
- **WHEN** 调用 is_safe_identifier 传入恶意字符串（如 "foo; rm -rf /"）
- **THEN** 必须返回 false

#### Scenario: Git 引用校验
- **WHEN** 调用 is_safe_git_ref 传入恶意字符串（如 "main && rm -rf /"）
- **THEN** 必须返回 false

#### Scenario: Docker 镜像引用校验
- **WHEN** 调用 is_safe_docker_image_ref 传入恶意字符串（如 "nginx; cat /etc/passwd"）
- **THEN** 必须返回 false

### Requirement: 部署步骤枚举稳定

部署步骤字符串 SHALL 保持固定域：pull_code、stop_old、deploy_new，模式字符串保持 compose、run。

#### Scenario: 部署步骤字符串不变
- **WHEN** 检查部署步骤枚举
- **THEN** 必须仅包含 pull_code、stop_old、deploy_new

#### Scenario: 部署模式字符串不变
- **WHEN** 检查部署模式枚举
- **THEN** 必须仅包含 compose、run

#### Scenario: 未知步骤拒绝执行
- **WHEN** 传入未知部署步骤（如 "unknown_step"）
- **THEN** 必须返回错误并拒绝执行
