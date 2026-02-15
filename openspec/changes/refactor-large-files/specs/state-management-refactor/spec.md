## ADDED Requirements

### Requirement: 引入 Redux Toolkit

项目 SHALL 引入 Redux Toolkit 作为状态管理库，版本锁定为 ^2.2.x。

#### Scenario: Redux Toolkit 安装
- **WHEN** 检查 package.json 依赖
- **THEN** 必须包含 @reduxjs/toolkit ^2.2.x

#### Scenario: Redux DevTools 配置
- **WHEN** 在开发环境启动应用
- **THEN** Redux DevTools 必须可用且能查看状态

#### Scenario: 生产环境禁用 DevTools
- **WHEN** 在生产环境构建应用
- **THEN** Redux DevTools 必须被禁用

### Requirement: 状态类作为 Facade

状态类 SHALL 保留为 Facade，内部通过 Redux Store 管理状态，保持单例模式。

#### Scenario: 单例唯一性
- **WHEN** 从不同模块导入 systemState
- **THEN** 必须返回同一个对象实例（Object.is 相等）

#### Scenario: Facade API 兼容
- **WHEN** 访问状态类的属性（如 systemState.snapshotCache）
- **THEN** 必须返回 Store 中的对应状态

#### Scenario: Facade 方法兼容
- **WHEN** 调用状态类的方法（如 systemState.clearAllTimers()）
- **THEN** 必须正确执行并更新 Store

### Requirement: 状态变更通过 action/reducer

所有状态变更 SHALL 通过 dispatch(action) 触发，使用 reducer 模式。

#### Scenario: 直接属性修改被禁止
- **WHEN** 尝试直接修改状态属性（如 state.xxx = yyy）
- **THEN** 在开发环境必须触发警告或错误

#### Scenario: action 触发状态变更
- **WHEN** dispatch 一个 action
- **THEN** 对应的 reducer 必须被调用并更新状态

#### Scenario: action 日志可追踪
- **WHEN** 查看 Redux DevTools 的 action 历史
- **THEN** 必须能看到所有 dispatch 的 action

### Requirement: 状态不可变性保证

状态更新 SHALL 保持不可变性，使用 Immer 进行结构共享。

#### Scenario: 状态更新后引用变化
- **WHEN** dispatch action 更新状态
- **THEN** 受影响的状态分支引用必须变化

#### Scenario: 未变化分支引用稳定
- **WHEN** dispatch action 更新状态
- **THEN** 未受影响的状态分支引用必须保持不变

#### Scenario: 原地修改被阻止
- **WHEN** 在 reducer 中尝试原地修改（如 push/splice）
- **THEN** Immer 必须自动转换为不可变更新

### Requirement: 状态到 UI 同步

状态变更 SHALL 自动触发 UI 更新，无需手动调用 refreshPageView()。

#### Scenario: 状态变更触发订阅
- **WHEN** dispatch action 更新状态
- **THEN** Store 的订阅回调必须被触发

#### Scenario: UI 自动更新
- **WHEN** 状态变更后
- **THEN** 页面必须自动重新渲染以反映最新状态

#### Scenario: 高频更新去抖
- **WHEN** 短时间内多次 dispatch action
- **THEN** UI 更新必须被去抖以避免过度渲染

### Requirement: 定时器集中清理

状态类 SHALL 提供 clearAllTimers() 方法，清理所有定时器。

#### Scenario: timeout 清理
- **WHEN** 调用 clearAllTimers()
- **THEN** 所有 setTimeout 创建的定时器必须被清除

#### Scenario: interval 清理
- **WHEN** 调用 clearAllTimers()
- **THEN** 所有 setInterval 创建的定时器必须被清除

#### Scenario: 页面切换时清理
- **WHEN** 页面切换触发 cleanup()
- **THEN** 对应状态域的 clearAllTimers() 必须被调用

### Requirement: DeployState localStorage 兼容

DeployState SHALL 保持 localStorage 持久化格式兼容，支持旧版本数据加载。

#### Scenario: 旧版本数据加载
- **WHEN** 从 localStorage 加载旧版本 DeployState 数据
- **THEN** 必须成功解析并填充默认值

#### Scenario: 新版本数据保存
- **WHEN** 保存 DeployState 到 localStorage
- **THEN** 格式必须与旧版本兼容

#### Scenario: 缺失字段回填
- **WHEN** 加载的数据缺少某些字段
- **THEN** 必须使用默认值回填

#### Scenario: 非法数据容错
- **WHEN** localStorage 中的数据格式非法
- **THEN** 必须回退到默认状态而不崩溃

### Requirement: 时间旅行调试支持

Redux DevTools SHALL 支持时间旅行调试，可回放 action 序列。

#### Scenario: action 序列回放
- **WHEN** 在 Redux DevTools 中回放 action 序列
- **THEN** 状态必须按序列重新计算

#### Scenario: 回放确定性
- **WHEN** 多次回放相同 action 序列
- **THEN** 最终状态必须完全一致

#### Scenario: 撤销/重做
- **WHEN** 在 Redux DevTools 中执行撤销/重做
- **THEN** 状态必须正确回退/前进

### Requirement: 所有页面和服务正常工作

重构后 SHALL 保持所有页面和服务正常工作。

#### Scenario: SystemPage 状态读取
- **WHEN** SystemPage 读取 systemState
- **THEN** 必须获取到正确的系统快照数据

#### Scenario: ToolsPage 状态更新
- **WHEN** ToolsPage 更新 toolsState
- **THEN** 状态必须正确更新并触发 UI 刷新

#### Scenario: DockerPage 状态同步
- **WHEN** DockerPage 执行 Docker 操作
- **THEN** dockerState 必须正确同步并反映到 UI

#### Scenario: 服务层状态访问
- **WHEN** 服务层（如 dockerService）访问状态
- **THEN** 必须能正确读取和更新状态
