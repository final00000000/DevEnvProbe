# 修复 App Installer 安装流程：应用内完成 + 进度跟踪

## Goal

修复 App Installer 自动安装功能，实现真正的应用内安装流程，包括：
1. 从 GitHub 直接下载 .msixbundle 文件（不跳转到 Microsoft Store）
2. 显示详细的下载和安装进度（使用现有的进度跟踪系统）
3. 在应用内完成整套流程，无需用户手动干预

## Current Problems

### Problem 1: 跳转到 Microsoft Store
**Location**: `src-tauri/src/install/mod.rs:481`
```rust
winget install --id Microsoft.AppInstaller --source msstore
```
这个命令会打开 Microsoft Store 应用，而不是静默安装。

### Problem 2: 下载链接重定向
**Location**: `src-tauri/src/install/mod.rs:494`
```rust
$appInstallerUrl = "https://aka.ms/getwinget"
```
这个 URL 会重定向到 Microsoft Store，不是直接下载链接。

### Problem 3: 没有进度反馈
**Location**: `src/pages/tools/ToolsCoordinator.ts:257`
```typescript
showGlobalNotice("正在安装 App Installer", "请稍候，这可能需要几分钟...", "info", 2000);
```
只显示一个简单的静态通知，没有使用现有的进度跟踪系统。

## Requirements

### Requirement 1: 使用 GitHub API 获取直接下载链接

**Implementation**:
- 使用 GitHub API: `https://api.github.com/repos/microsoft/winget-cli/releases/latest`
- 解析 JSON 响应，找到 `.msixbundle` 文件的下载链接
- 使用 reqwest 库（已存在于代码库中）进行 HTTP 请求

**Reference**:
- [GitHub Releases](https://github.com/microsoft/winget-cli/releases)
- [Stack Overflow: Install winget by command line](https://stackoverflow.com/questions/74166150/install-winget-by-the-command-line-powershell)

### Requirement 2: 应用现有的进度跟踪系统

**Existing Pattern** (found by Research Agent):
- `src/pages/tools/ToolsCoordinator.ts:455-482` - `startProgressLoop()` 函数
- `src/pages/tools/ToolsCoordinator.ts:427-453` - `updateActiveProgressDom()` 函数
- `src/state/tools-state.ts:24-52` - 进度状态字段

**Implementation**:
- 在 App Installer 安装前设置 `toolsState.prerequisiteInstalling = true`
- 调用 `startProgressLoop()` 开始进度动画
- 更新 `installProgress`、`installMessage` 等状态字段
- 安装完成后清理状态

### Requirement 3: 改进 PowerShell 脚本

**Current Script Issues**:
- 使用重定向 URL
- 没有错误处理
- 没有依赖检查（VCLibs）

**Improved Script**:
- 从 GitHub API 获取最新版本的直接下载链接
- 检查并安装 VCLibs 依赖（如果需要）
- 详细的错误处理和日志输出
- 使用 `Add-AppxPackage` 静默安装

## Acceptance Criteria

### For Requirement 1 (GitHub API 下载)

- [ ] 使用 GitHub API 获取最新 release 信息
- [ ] 解析 JSON 响应，提取 .msixbundle 下载链接
- [ ] 使用 reqwest 下载文件到临时目录
- [ ] 下载失败时有清晰的错误信息
- [ ] 不打开 Microsoft Store

### For Requirement 2 (进度跟踪)

- [ ] 安装前设置 `prerequisiteInstalling = true`
- [ ] 调用 `startProgressLoop()` 显示进度动画
- [ ] 进度条从 8% 逐渐增加到 96%
- [ ] 显示动态状态消息（"正在下载..."、"正在安装..."等）
- [ ] 安装完成后进度达到 100%
- [ ] 安装失败时显示错误状态

### For Requirement 3 (改进脚本)

- [ ] PowerShell 脚本使用 GitHub API 获取下载链接
- [ ] 检查并安装 VCLibs 依赖（如果需要）
- [ ] 详细的日志输出（每个步骤）
- [ ] 错误处理覆盖所有可能的失败点
- [ ] 使用 `Add-AppxPackage` 静默安装

## Technical Notes

### Architecture

这是一个 **fullstack** 任务，涉及：
- **Backend (Rust)**: 修改 `install_app_installer()` 函数，使用 GitHub API
- **Frontend (TypeScript)**: 应用现有的进度跟踪系统

### Key Files to Modify

**Backend**:
- `src-tauri/src/install/mod.rs` (lines 461-533) - 修改 `install_app_installer()` 函数

**Frontend**:
- `src/pages/tools/ToolsCoordinator.ts` (lines 238-274) - 添加进度跟踪
- `src/state/tools-state.ts` - 确保 `prerequisiteInstalling` 字段存在

### GitHub API Response Format

```json
{
  "tag_name": "v1.7.10861",
  "assets": [
    {
      "name": "Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle",
      "browser_download_url": "https://github.com/microsoft/winget-cli/releases/download/v1.7.10861/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle"
    }
  ]
}
```

### PowerShell Script Structure

```powershell
# 1. 获取最新版本信息
$apiUrl = "https://api.github.com/repos/microsoft/winget-cli/releases/latest"
$release = Invoke-RestMethod -Uri $apiUrl

# 2. 找到 .msixbundle 文件
$asset = $release.assets | Where-Object { $_.name -like "*.msixbundle" } | Select-Object -First 1
$downloadUrl = $asset.browser_download_url

# 3. 下载文件
$tempPath = "$env:TEMP\$($asset.name)"
Invoke-WebRequest -Uri $downloadUrl -OutFile $tempPath

# 4. 检查并安装 VCLibs 依赖
# (如果需要)

# 5. 安装 App Installer
Add-AppxPackage -Path $tempPath

# 6. 清理临时文件
Remove-Item $tempPath -Force
```

### Existing Progress Tracking Pattern

**From Research Agent findings**:

```typescript
// 设置进度状态
toolsState.prerequisiteInstalling = true;
toolsState.installProgress = PROGRESS.START; // 8
toolsState.installMessage = "正在准备下载 App Installer...";
toolsState.installFeedbackLevel = "running";

// 开始进度动画
this.startProgressLoop();

// 调用后端安装
const installResult = await toolsService.installAppInstaller();

// 更新进度
toolsState.installProgress = PROGRESS.DONE; // 100
toolsState.installMessage = "安装完成";
toolsState.installFeedbackLevel = "success";

// 清理状态
toolsState.prerequisiteInstalling = false;
this.clearProgressTimer();
```

### Edge Cases to Handle

1. **GitHub API 限流**：如果请求过多，API 可能返回 403
   - 解决方案：添加重试逻辑，或使用缓存的下载链接

2. **网络问题**：下载可能失败
   - 解决方案：重试机制，清晰的错误信息

3. **VCLibs 依赖缺失**：某些 Windows 版本（LTSC、Server）需要先安装 VCLibs
   - 解决方案：检查并自动安装 VCLibs

4. **管理员权限**：安装需要管理员权限
   - 解决方案：检查权限，提示用户以管理员身份运行

5. **并发安装**：用户可能在 App Installer 安装过程中尝试安装其他工具
   - 解决方案：使用 `prerequisiteInstalling` 标志阻止并发操作

### Security Considerations

1. **下载来源验证**：只从 GitHub 官方仓库下载
2. **HTTPS 验证**：确保使用 HTTPS 连接
3. **文件完整性**：下载后验证文件大小（可选）
4. **临时文件清理**：安装后删除临时文件

### Performance Considerations

1. **下载速度**：.msixbundle 文件约 50-100 MB，下载可能需要几分钟
2. **进度更新频率**：使用现有的 280ms-1200ms 间隔
3. **超时设置**：保持现有的 10 分钟超时（`APP_INSTALLER_INSTALL_TIMEOUT_MS`）

## Implementation Strategy

### Phase 1: 修改后端 PowerShell 脚本

1. 修改 `src-tauri/src/install/mod.rs:467-513` 中的 PowerShell 脚本
2. 使用 GitHub API 获取最新版本
3. 下载 .msixbundle 文件
4. 检查并安装 VCLibs 依赖
5. 使用 `Add-AppxPackage` 静默安装

### Phase 2: 应用前端进度跟踪

1. 修改 `src/pages/tools/ToolsCoordinator.ts:238-274`
2. 在安装前设置进度状态
3. 调用 `startProgressLoop()`
4. 安装完成后更新状态

### Phase 3: 测试

1. 在没有 winget 的环境中测试
2. 验证不会打开 Microsoft Store
3. 验证进度条正常显示
4. 验证安装成功

## Success Metrics

1. **用户体验改善**：
   - 不再跳转到 Microsoft Store（100% 改善）
   - 显示详细的进度反馈（从无到有）
   - 安装成功率提高（从可能失败到稳定成功）

2. **技术指标**：
   - GitHub API 调用成功率 > 95%
   - 下载成功率 > 90%
   - 安装成功率 > 90%
   - 进度更新流畅（无卡顿）

## References

- [GitHub Releases - microsoft/winget-cli](https://github.com/microsoft/winget-cli/releases)
- [Stack Overflow: Install winget by command line](https://stackoverflow.com/questions/74166150/install-winget-by-the-command-line-powershell)
- [GitHub Discussion: Installation Guide for LTSC](https://github.com/microsoft/winget-cli/discussions/1956)
- Research Agent 分析结果：详细的代码库分析和现有模式
