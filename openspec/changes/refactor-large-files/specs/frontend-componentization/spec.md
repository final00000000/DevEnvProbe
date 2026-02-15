## ADDED Requirements

### Requirement: ToolsPage 拆分为三段式结构

ToolsPage SHALL 拆分为 ToolsRenderer、ToolsController、ToolsCoordinator 三段式结构，主文件行数必须小于 300 行。

#### Scenario: ToolsPage.ts 行数限制
- **WHEN** 重构完成后统计 ToolsPage.ts 行数
- **THEN** 行数必须小于 300 行

#### Scenario: ToolsRenderer 职责
- **WHEN** 查看 ToolsRenderer.ts 内容
- **THEN** 必须仅包含 HTML 模板生成逻辑，无状态和事件绑定

#### Scenario: ToolsController 职责
- **WHEN** 查看 ToolsController.ts 内容
- **THEN** 必须包含事件绑定与交互控制逻辑

#### Scenario: ToolsCoordinator 职责
- **WHEN** 查看 ToolsCoordinator.ts 内容
- **THEN** 必须包含业务协调与状态同步逻辑

### Requirement: DockerPage 补全缺失文件

DockerPage SHALL 补全缺失的 DockerRenderer、DockerController、DockerCoordinator 文件。

#### Scenario: DockerRenderer 文件存在
- **WHEN** 检查 src/pages/docker/DockerRenderer.ts
- **THEN** 文件必须存在且包含 HTML 模板生成逻辑

#### Scenario: DockerController 文件存在
- **WHEN** 检查 src/pages/docker/DockerController.ts
- **THEN** 文件必须存在且包含事件绑定逻辑

#### Scenario: DockerCoordinator 文件存在
- **WHEN** 检查 src/pages/docker/DockerCoordinator.ts
- **THEN** 文件必须存在且包含业务协调逻辑

#### Scenario: DockerPage 导入正确
- **WHEN** 检查 DockerPage.ts 的导入语句
- **THEN** 必须正确导入 DockerRenderer、DockerController、DockerCoordinator

### Requirement: 页面生命周期接口保持

页面 SHALL 保留 render(container, epoch) 方法签名和 cleanup() 方法。

#### Scenario: render 方法签名
- **WHEN** 检查页面类的 render 方法
- **THEN** 签名必须为 async render(container: HTMLElement, renderEpoch?: number): Promise<void>

#### Scenario: cleanup 方法存在
- **WHEN** 检查页面类的 cleanup 方法
- **THEN** 方法必须存在且清理所有事件监听器和定时器

#### Scenario: 路由层调用兼容
- **WHEN** 路由层调用页面的 render 方法
- **THEN** 调用必须成功且页面正常渲染

### Requirement: renderEpoch 竞态保护

页面 SHALL 使用 renderEpoch 和 appState.isRenderStale 防止竞态条件。

#### Scenario: 过期渲染被阻止
- **WHEN** 异步回调返回时 renderEpoch 已过期
- **THEN** 回调必须检测到 isRenderStale 并跳过 DOM 更新

#### Scenario: 最新渲染正常执行
- **WHEN** 异步回调返回时 renderEpoch 仍有效
- **THEN** 回调必须正常执行 DOM 更新

#### Scenario: 页面切换取消渲染
- **WHEN** 页面切换导致 renderEpoch 递增
- **THEN** 旧页面的异步回调必须被阻止

### Requirement: 事件委托绑定完整性

Controller SHALL 依赖的 ID 选择器和 data-* 属性在 Renderer 模板中必须稳定存在。

#### Scenario: ID 选择器存在
- **WHEN** Controller 绑定事件到特定 ID
- **THEN** Renderer 生成的 HTML 必须包含该 ID

#### Scenario: data 属性存在
- **WHEN** Controller 通过 data-* 属性识别元素
- **THEN** Renderer 生成的 HTML 必须包含该 data 属性

#### Scenario: 事件冒泡正常
- **WHEN** 用户点击动态列表项
- **THEN** 事件必须正确冒泡到 Controller 的委托处理器

### Requirement: RAF 分批渲染保持

ToolsPage SHALL 保留 requestAnimationFrame 分批渲染优化，单帧处理量不超过设定批次上限。

#### Scenario: 分批渲染语义等价
- **WHEN** 对比分批渲染和一次性渲染的 DOM 结果
- **THEN** 两者必须在语义上等价

#### Scenario: 单帧处理量限制
- **WHEN** 统计每帧处理的节点数量
- **THEN** 必须不超过设定的批次上限

#### Scenario: gridRenderToken 取消机制
- **WHEN** 新的渲染请求到来时
- **THEN** 旧的分批渲染必须被 gridRenderToken 取消

### Requirement: cleanup 资源释放完整

页面 cleanup() SHALL 释放所有事件监听器和定时器，调用多次不抛异常。

#### Scenario: 事件监听器清理
- **WHEN** 调用 cleanup() 后
- **THEN** 所有 pageListeners 中的监听器必须被移除

#### Scenario: 定时器清理
- **WHEN** 调用 cleanup() 后
- **THEN** 所有定时器（timeout/interval）必须被清除

#### Scenario: 幂等性
- **WHEN** 连续调用 cleanup() 多次
- **THEN** 不得抛出异常

#### Scenario: 内存泄漏检测
- **WHEN** 反复切换页面 100 次
- **THEN** 定时器数量和事件句柄数量不得持续增长

### Requirement: 异步任务销毁后静默

页面销毁后 SHALL 确保所有未完成异步任务不再更新 DOM，也不产生未捕获异常。

#### Scenario: 销毁后 DOM 不更新
- **WHEN** 页面销毁后异步任务完成
- **THEN** 任务不得修改 DOM

#### Scenario: 销毁后无未捕获异常
- **WHEN** 页面销毁后异步任务失败
- **THEN** 不得产生 unhandledrejection 事件

#### Scenario: finally 块检查页面活跃态
- **WHEN** 异步任务在 finally 块中执行清理
- **THEN** 必须先检查页面是否仍活跃

### Requirement: 所有功能正常工作

重构后 SHALL 保持所有页面功能正常工作且无回归。

#### Scenario: ToolsPage 工具探测
- **WHEN** 打开 ToolsPage
- **THEN** 必须正常显示工具列表和安装状态

#### Scenario: ToolsPage 工具安装
- **WHEN** 点击安装按钮
- **THEN** 必须正常执行安装流程并更新状态

#### Scenario: DockerPage 容器列表
- **WHEN** 打开 DockerPage
- **THEN** 必须正常显示容器列表和状态

#### Scenario: DockerPage 容器操作
- **WHEN** 执行容器操作（启动/停止/删除）
- **THEN** 必须正常执行并更新状态

#### Scenario: 页面切换流畅
- **WHEN** 在不同页面间切换
- **THEN** 切换必须流畅且无卡顿
