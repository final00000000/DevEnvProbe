# 改进环境安装流程：自动处理 winget 前置条件 + 预加载工具检测

## Goal

解决两个用户体验问题：
1. **环境安装失败问题**：当用户尝试安装 Python 等工具时，如果系统缺少 winget/App Installer，直接报错退出，用户需要手动安装前置条件后重试
2. **仪表盘加载缓慢问题**：首次打开环境市场（Tools 页面）时，需要等待很久才能看到工具列表，因为工具检测是按需触发的

## Requirements

### Requirement 1: 自动处理 winget 前置条件

**Current Behavior**:
- 用户点击安装 Python → 后端检测 winget → 发现不存在 → 返回错误 "未检测到 winget，请先安装 App Installer" → 安装流程中断

**Expected Behavior**:
- 用户点击安装 Python → 后端检测 winget → 发现不存在 → 前端弹出友好提示："检测到系统缺少 App Installer，是否自动安装？" → 用户确认 → 自动下载并安装 App Installer → 安装完成后自动继续 Python 安装流程

**Technical Details**:
- Backend: 添加 `check_winget_prerequisite()` 函数（非阻塞）
- Backend: 添加 `install_app_installer()` 函数（自动下载并安装）
- Frontend: 在安装前调用前置条件检查
- Frontend: 如果缺少 winget，显示确认对话框
- Frontend: 用户确认后，调用自动安装函数
- Frontend: 安装完成后，继续原始安装流程

### Requirement 2: 预加载环境市场工具检测

**Current Behavior**:
- 用户启动应用 → 导航到环境市场页面 → 页面显示 "正在探测本机开发环境..." → 等待 5-10 秒 → 显示工具列表

**Expected Behavior**:
- 用户启动应用 → **后台自动开始工具检测**（不阻塞 UI） → 用户导航到环境市场页面 → **立即显示缓存的工具列表**（如果检测已完成）或显示加载中（如果检测仍在进行）

**Technical Details**:
- Frontend: 在 `main.ts` 应用启动时调用 `toolsService.preloadDetection()`
- Frontend: `preloadDetection()` 在后台异步执行工具检测，不阻塞 UI
- Frontend: 检测结果缓存到 `toolsState.dataCache`
- Frontend: 用户导航到 Tools 页面时，优先使用缓存数据（cache-first pattern）
- Frontend: 如果缓存存在，立即渲染；如果缓存不存在或过期，显示加载中

## Acceptance Criteria

### For Requirement 1 (Winget 前置条件)

- [ ] 用户点击安装工具时，系统自动检测 winget 是否可用
- [ ] 如果 winget 不可用，显示友好的确认对话框（而非直接报错）
- [ ] 对话框内容清晰说明：需要安装 App Installer，询问是否自动安装
- [ ] 用户确认后，自动下载并安装 App Installer
- [ ] App Installer 安装完成后，自动继续原始工具的安装流程
- [ ] 整个流程无需用户手动干预（除了确认对话框）

### For Requirement 2 (预加载工具检测)

- [ ] 应用启动时，后台自动开始工具检测（不阻塞 UI）
- [ ] 工具检测结果缓存到 `toolsState.dataCache`
- [ ] 用户首次导航到环境市场页面时，如果缓存已就绪，立即显示工具列表（无需等待）
- [ ] 如果缓存未就绪，显示加载中状态（与当前行为一致）
- [ ] 预加载不影响应用启动速度（异步执行）
- [ ] 预加载失败不影响应用正常使用（优雅降级）

## Technical Notes

### Architecture

这是一个 **fullstack** 任务，涉及：
- **Backend (Rust)**: 添加 winget 检测和 App Installer 安装逻辑
- **Frontend (TypeScript)**: 添加前置条件检查 UI、预加载逻辑

### Key Files to Modify

**Backend**:
- `src-tauri/src/install/mod.rs` - 添加 winget 检测和 App Installer 安装函数
- `src-tauri/src/lib.rs` - 添加新的 Tauri commands
- `src-tauri/src/contracts/mod.rs` - 添加 `WingetStatus` 结构体

**Frontend**:
- `src/services/tools-service.ts` - 添加 winget 检查和预加载方法
- `src/pages/tools/ToolsCoordinator.ts` - 添加前置条件检查流程
- `src/main.ts` - 添加预加载调用
- `src/modules/shell-ui.ts` - 添加 App Installer 安装对话框
- `src/state/tools-state.ts` - 添加 winget 状态字段

### Design Patterns to Follow

1. **Cache-First Pattern** (已在 SystemPage 和 ToolsCoordinator 中使用)
   - 优先使用缓存数据
   - 后台异步刷新
   - 优雅降级

2. **Non-Blocking Async Operations**
   - 预加载不阻塞 UI
   - 使用 Promise 和 async/await
   - 错误处理不影响主流程

3. **User Confirmation for System Changes**
   - 安装 App Installer 前需要用户确认
   - 清晰说明操作内容和影响
   - 提供取消选项

### Edge Cases to Handle

1. **Winget 检测超时**：如果检测超时，应优雅降级，提示用户手动安装
2. **App Installer 安装失败**：提供清晰的错误信息和手动安装指引
3. **预加载失败**：不影响应用启动，用户导航到 Tools 页面时重新触发检测
4. **并发安装**：如果用户在 App Installer 安装过程中尝试安装其他工具，应排队等待
5. **网络问题**：下载 App Installer 时可能遇到网络问题，需要重试机制

### Security Considerations

1. **下载来源验证**：App Installer 必须从官方 Microsoft Store 或可信源下载
2. **用户确认**：任何系统级安装都需要用户明确确认
3. **权限检查**：安装 App Installer 可能需要管理员权限，需要提前检查并提示

### Performance Considerations

1. **预加载时机**：在应用启动后立即触发，但不阻塞 UI 渲染
2. **缓存策略**：工具检测结果缓存 5 分钟（可配置）
3. **并发控制**：工具检测使用线程池，避免过多并发

## Implementation Strategy

### Phase 1: Backend - Winget Detection & App Installer Installation

1. 在 `src-tauri/src/install/mod.rs` 中添加：
   - `check_winget_available() -> Result<bool, String>` - 非阻塞检测
   - `install_app_installer() -> Result<(), String>` - 自动安装

2. 在 `src-tauri/src/lib.rs` 中添加 Tauri commands：
   - `check_winget_prerequisite` - 前端调用检测
   - `install_app_installer_auto` - 前端调用安装

3. 在 `src-tauri/src/contracts/mod.rs` 中添加：
   - `WingetStatus` 结构体

### Phase 2: Frontend - Prerequisite Checking UI

1. 在 `src/services/tools-service.ts` 中添加：
   - `checkWingetPrerequisite()` - 调用后端检测
   - `installAppInstaller()` - 调用后端安装

2. 在 `src/pages/tools/ToolsCoordinator.ts` 中修改：
   - `executeToolAction()` - 安装前检查 winget
   - 如果缺少 winget，调用对话框

3. 在 `src/modules/shell-ui.ts` 中添加：
   - `showWingetPrerequisiteModal()` - 显示确认对话框

4. 在 `src/state/tools-state.ts` 中添加：
   - `wingetAvailable: boolean | null`
   - `prerequisiteInstalling: boolean`

### Phase 3: Frontend - Preloading

1. 在 `src/services/tools-service.ts` 中添加：
   - `preloadDetection()` - 后台预加载方法

2. 在 `src/main.ts` 中添加：
   - 应用启动后调用 `toolsService.preloadDetection()`

3. 验证 cache-first pattern 正常工作

### Phase 4: Testing & Refinement

1. 测试 winget 缺失场景
2. 测试 App Installer 自动安装
3. 测试预加载性能
4. 测试边缘情况（超时、失败、并发等）

## Success Metrics

1. **用户体验改善**：
   - 安装失败率降低（从 100% → 接近 0%，当 winget 缺失时）
   - 环境市场首次加载时间减少（从 5-10 秒 → 接近 0 秒，如果预加载完成）

2. **技术指标**：
   - 预加载成功率 > 95%
   - App Installer 自动安装成功率 > 90%
   - 预加载不增加应用启动时间（< 100ms 额外开销）

## References

- Research Agent 分析结果：详细的代码库分析和文件定位
- Cross-Layer Thinking Guide：跨层数据流分析指南
- 现有 cache-first pattern：SystemPage.ts:46-54, ToolsCoordinator.ts:65-72
