use crate::contracts::{InstallResult, PathValidationResult, UninstallResult, WingetStatus};
use crate::process_runner::{execute_process_with_timeout, run_command_with_timeout};
use crate::tools::TOOL_DETECT_TIMEOUT_MS;

pub const WINGET_INSTALL_TIMEOUT_MS: u64 = 20 * 60 * 1_000;
pub const APP_INSTALLER_INSTALL_TIMEOUT_MS: u64 = 10 * 60 * 1_000;

pub struct InstallSpec {
    pub key: &'static str,
    pub package_id: &'static str,
}

#[derive(Clone)]
pub struct InstallExecutionPlan {
    pub command: String,
    pub args: Vec<String>,
    pub package_id: String,
}

pub fn install_specs() -> Vec<InstallSpec> {
    vec![
        InstallSpec {
            key: "nodejs-lts",
            package_id: "OpenJS.NodeJS.LTS",
        },
        InstallSpec {
            key: "pnpm",
            package_id: "pnpm.pnpm",
        },
        InstallSpec {
            key: "yarn",
            package_id: "Yarn.Yarn",
        },
        InstallSpec {
            key: "bun",
            package_id: "Oven-sh.Bun",
        },
        InstallSpec {
            key: "deno",
            package_id: "DenoLand.Deno",
        },
        InstallSpec {
            key: "python",
            package_id: "Python.Python.3.12",
        },
        InstallSpec {
            key: "pipx",
            package_id: "pipx.pipx",
        },
        InstallSpec {
            key: "uv",
            package_id: "astral-sh.uv",
        },
        InstallSpec {
            key: "miniconda",
            package_id: "Anaconda.Miniconda3",
        },
        InstallSpec {
            key: "go",
            package_id: "GoLang.Go",
        },
        InstallSpec {
            key: "openjdk",
            package_id: "Microsoft.OpenJDK.21",
        },
        InstallSpec {
            key: "maven",
            package_id: "Apache.Maven",
        },
        InstallSpec {
            key: "gradle",
            package_id: "Gradle.Gradle",
        },
        InstallSpec {
            key: "rustup",
            package_id: "Rustlang.Rustup",
        },
        InstallSpec {
            key: "git",
            package_id: "Git.Git",
        },
        InstallSpec {
            key: "gh",
            package_id: "GitHub.cli",
        },
        InstallSpec {
            key: "docker-desktop",
            package_id: "Docker.DockerDesktop",
        },
        InstallSpec {
            key: "kubectl",
            package_id: "Kubernetes.kubectl",
        },
        InstallSpec {
            key: "helm",
            package_id: "Helm.Helm",
        },
        InstallSpec {
            key: "terraform",
            package_id: "Hashicorp.Terraform",
        },
        InstallSpec {
            key: "dotnet-sdk",
            package_id: "Microsoft.DotNet.SDK.8",
        },
        InstallSpec {
            key: "powershell",
            package_id: "Microsoft.PowerShell",
        },
        InstallSpec {
            key: "vscode",
            package_id: "Microsoft.VisualStudioCode",
        },
        InstallSpec {
            key: "aws-cli",
            package_id: "Amazon.AWSCLI",
        },
        InstallSpec {
            key: "azure-cli",
            package_id: "Microsoft.AzureCLI",
        },
        InstallSpec {
            key: "gcloud-cli",
            package_id: "Google.CloudSDK",
        },
        InstallSpec {
            key: "flutter",
            package_id: "Flutter.Flutter",
        },
        InstallSpec {
            key: "dart",
            package_id: "DartSDK.Dart",
        },
        InstallSpec {
            key: "android-platform-tools",
            package_id: "Google.AndroidPlatformTools",
        },
        InstallSpec {
            key: "android-studio",
            package_id: "Google.AndroidStudio",
        },
        InstallSpec {
            key: "cmake",
            package_id: "Kitware.CMake",
        },
        InstallSpec {
            key: "sqlite",
            package_id: "SQLite.SQLite",
        },
        InstallSpec {
            key: "postgresql",
            package_id: "PostgreSQL.PostgreSQL",
        },
        InstallSpec {
            key: "mysql",
            package_id: "Oracle.MySQL",
        },
        InstallSpec {
            key: "mongodb-shell",
            package_id: "MongoDB.Shell",
        },
        InstallSpec {
            key: "redis",
            package_id: "Redis.Redis",
        },
        InstallSpec {
            key: "claude-code",
            package_id: "@anthropic-ai/claude-code",
        },
        InstallSpec {
            key: "codex-cli",
            package_id: "@openai/codex",
        },
        InstallSpec {
            key: "gemini-cli",
            package_id: "@google/gemini-cli",
        },
    ]
}

pub fn execute_install_item(item_key: &str, install_path: Option<&str>) -> Result<InstallResult, String> {
    let spec = install_specs()
        .into_iter()
        .find(|item| item.key == item_key)
        .ok_or_else(|| format!("未找到可安装项：{}", item_key))?;

    let plan = resolve_install_plan(spec.key, spec.package_id, install_path)?;
    let capture = execute_process_with_timeout(&plan.command, &plan.args, WINGET_INSTALL_TIMEOUT_MS).map_err(|error| {
        if plan.command == "npm" {
            let lowered = error.to_lowercase();
            let maybe_not_found = lowered.contains("not found")
                || lowered.contains("not recognized")
                || error.contains("系统找不到指定的文件")
                || error.contains("找不到文件");

            if maybe_not_found {
                return "未找到 npm 命令。请确认安装的是官方 Node.js（含 npm），并重启应用后重试。".to_string();
            }
        }

        error
    })?;

    Ok(InstallResult {
        item_key: item_key.to_string(),
        package_id: plan.package_id,
        command: format!("{} {}", plan.command, plan.args.join(" ")),
        stdout: capture.stdout,
        stderr: capture.stderr,
        exit_code: capture.exit_code,
    })
}

pub fn resolve_install_plan(
    item_key: &str,
    package_id: &str,
    install_path: Option<&str>,
) -> Result<InstallExecutionPlan, String> {
    let node_package = node_package_name(item_key);
    if let Some(npm_package) = node_package {
        return Ok(build_npm_global_install_plan(npm_package));
    }

    // 使用直接下载方式安装 Python
    if item_key == "python" {
        return Ok(build_python_direct_install_plan(install_path));
    }

    let winget_available = run_command_with_timeout("winget", &["--version"], TOOL_DETECT_TIMEOUT_MS).is_ok();
    if winget_available {
        let mut args = vec![
            "install".to_string(),
            "--id".to_string(),
            package_id.to_string(),
            "--exact".to_string(),
            "--silent".to_string(),
            "--accept-source-agreements".to_string(),
            "--accept-package-agreements".to_string(),
        ];

        if let Some(path) = install_path.map(str::trim).filter(|value| !value.is_empty()) {
            args.push("--location".to_string());
            args.push(path.to_string());
        }

        return Ok(InstallExecutionPlan {
            command: "winget".to_string(),
            args,
            package_id: package_id.to_string(),
        });
    }

    Err("未检测到 winget，请先安装 App Installer".to_string())
}

pub fn node_package_name(item_key: &str) -> Option<&'static str> {
    match item_key {
        "pnpm" => Some("pnpm"),
        "yarn" => Some("yarn"),
        "claude-code" => Some("@anthropic-ai/claude-code"),
        "codex-cli" => Some("@openai/codex"),
        "gemini-cli" => Some("@google/gemini-cli"),
        _ => None,
    }
}

pub fn build_npm_global_install_plan(npm_package: &str) -> InstallExecutionPlan {
    InstallExecutionPlan {
        command: "npm".to_string(),
        args: vec!["install".to_string(), "-g".to_string(), npm_package.to_string()],
        package_id: format!("npm:{}", npm_package),
    }
}

pub fn build_python_direct_install_plan(install_path: Option<&str>) -> InstallExecutionPlan {
    let install_dir = install_path
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .unwrap_or("C:\\Python312");

    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {{
    Write-Output "正在获取 Python 3.12 最新版本..."

    # Python 3.12 最新版本
    $pythonVersion = "3.12.7"
    $downloadUrl = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-amd64.exe"
    $installerPath = "$env:TEMP\python-$pythonVersion-amd64.exe"

    Write-Output "正在下载 Python $pythonVersion..."
    Write-Output "下载地址: $downloadUrl"

    Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath -UseBasicParsing

    Write-Output "下载完成，开始安装..."
    Write-Output "安装目录: {}"

    # 静默安装 Python
    $installArgs = @(
        "/quiet",
        "InstallAllUsers=1",
        "PrependPath=1",
        "Include_test=0",
        "TargetDir={}"
    )

    $process = Start-Process -FilePath $installerPath -ArgumentList $installArgs -Wait -PassThru -NoNewWindow

    # 清理安装文件
    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue

    if ($process.ExitCode -eq 0) {{
        Write-Output "Python 安装成功"
        exit 0
    }} else {{
        Write-Output "Python 安装失败，退出码: $($process.ExitCode)"
        exit $process.ExitCode
    }}
}} catch {{
    Write-Output "安装过程出错: $_"
    exit 1
}}
"#,
        install_dir, install_dir
    );

    InstallExecutionPlan {
        command: "powershell".to_string(),
        args: vec![
            "-NoProfile".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-WindowStyle".to_string(),
            "Hidden".to_string(),
            "-Command".to_string(),
            script,
        ],
        package_id: "Python.Python.3.12".to_string(),
    }
}

pub fn execute_uninstall_item(item_key: &str) -> Result<UninstallResult, String> {
    let spec = install_specs()
        .into_iter()
        .find(|item| item.key == item_key)
        .ok_or_else(|| format!("未找到可卸载项：{}", item_key))?;

    let plan = resolve_uninstall_plan(spec.key, spec.package_id)?;
    let capture = execute_process_with_timeout(&plan.command, &plan.args, WINGET_INSTALL_TIMEOUT_MS)?;

    Ok(UninstallResult {
        item_key: item_key.to_string(),
        package_id: plan.package_id,
        command: format!("{} {}", plan.command, plan.args.join(" ")),
        stdout: capture.stdout,
        stderr: capture.stderr,
        exit_code: capture.exit_code,
    })
}

pub fn resolve_uninstall_plan(
    item_key: &str,
    package_id: &str,
) -> Result<InstallExecutionPlan, String> {
    if let Some(npm_package) = node_package_name(item_key) {
        return Ok(InstallExecutionPlan {
            command: "npm".to_string(),
            args: vec!["uninstall".to_string(), "-g".to_string(), npm_package.to_string()],
            package_id: format!("npm:{}", npm_package),
        });
    }

    let winget_available = run_command_with_timeout("winget", &["--version"], TOOL_DETECT_TIMEOUT_MS).is_ok();
    if winget_available {
        return Ok(InstallExecutionPlan {
            command: "winget".to_string(),
            args: vec![
                "uninstall".to_string(),
                "--id".to_string(),
                package_id.to_string(),
                "--exact".to_string(),
                "--silent".to_string(),
                "--purge".to_string(),
            ],
            package_id: package_id.to_string(),
        });
    }

    Err("未检测到 winget，请先安装 App Installer".to_string())
}

pub fn select_install_directory() -> Result<Option<String>, String> {
    select_directory_with_prompt("选择安装目录")
}

pub fn select_project_directory() -> Result<Option<String>, String> {
    select_directory_with_prompt("选择项目目录")
}

pub fn select_directory_with_prompt(prompt: &str) -> Result<Option<String>, String> {
    if !cfg!(target_os = "windows") {
        return Ok(None);
    }

    let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "{}"
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {{
  $dialog.SelectedPath
}}
"#,
        prompt
    );

    let picked = run_command_with_timeout(
        "powershell",
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-Command", &script],
        WINGET_INSTALL_TIMEOUT_MS,
    )
    .unwrap_or_default();

    let normalized = picked.trim().to_string();
    if normalized.is_empty() {
        Ok(None)
    } else {
        Ok(Some(normalized))
    }
}

pub fn validate_install_path(path: &str) -> Result<PathValidationResult, String> {
    // 检查路径是否为空
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(PathValidationResult {
            valid: false,
            exists: false,
            writable: false,
            available_space_gb: None,
            error: Some("路径不能为空".to_string()),
        });
    }

    // 检查路径是否存在
    let path_obj = std::path::Path::new(trimmed);
    let exists = path_obj.exists();

    if !exists {
        return Ok(PathValidationResult {
            valid: false,
            exists: false,
            writable: false,
            available_space_gb: None,
            error: Some("路径不存在".to_string()),
        });
    }

    // 检查是否为目录
    if !path_obj.is_dir() {
        return Ok(PathValidationResult {
            valid: false,
            exists: true,
            writable: false,
            available_space_gb: None,
            error: Some("路径必须是目录".to_string()),
        });
    }

    // 检查可写性
    let writable = check_path_writable(path_obj);

    if !writable {
        return Ok(PathValidationResult {
            valid: false,
            exists: true,
            writable: false,
            available_space_gb: None,
            error: Some("目录不可写，请检查权限".to_string()),
        });
    }

    // 检查磁盘空间（暂时返回None，后续可以实现）
    let available_space_gb = None;

    Ok(PathValidationResult {
        valid: true,
        exists: true,
        writable: true,
        available_space_gb,
        error: None,
    })
}

fn check_path_writable(path: &std::path::Path) -> bool {
    use std::fs::File;
    use std::io::Write;

    let test_file = path.join(".devenvprobe_write_test");

    // 尝试创建并写入临时文件
    let result = File::create(&test_file)
        .and_then(|mut f| f.write_all(b"test"))
        .and_then(|_| std::fs::remove_file(&test_file));

    result.is_ok()
}

/// 检查 winget 是否可用
pub fn check_winget_available() -> Result<WingetStatus, String> {
    match run_command_with_timeout("winget", &["--version"], TOOL_DETECT_TIMEOUT_MS) {
        Ok(version_output) => {
            let version = version_output.trim().to_string();
            Ok(WingetStatus {
                available: true,
                version: Some(version),
                error: None,
            })
        }
        Err(error) => {
            Ok(WingetStatus {
                available: false,
                version: None,
                error: Some(error),
            })
        }
    }
}

/// 自动安装 App Installer (winget)
pub fn install_app_installer() -> Result<InstallResult, String> {
    if !cfg!(target_os = "windows") {
        return Err("App Installer 仅支持 Windows 系统".to_string());
    }

    // 使用 PowerShell 从 GitHub 直接下载并安装 App Installer
    let script = r#"
# 检查是否有管理员权限
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Output "检测到需要管理员权限，正在请求 UAC 提升..."

    # 构建完整的脚本内容（从 GitHub 下载部分开始）
    $elevatedScript = @'
# 从 GitHub 下载并安装
try {
    Write-Output "正在从 GitHub 获取最新版本信息..."
    $progressPreference = 'SilentlyContinue'

    # 使用 GitHub API 获取最新版本
    $apiUrl = "https://api.github.com/repos/microsoft/winget-cli/releases/latest"
    $release = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing

    # 找到 .msixbundle 文件
    $asset = $release.assets | Where-Object { $_.name -like "*.msixbundle" } | Select-Object -First 1

    if (-not $asset) {
        Write-Output "未找到 .msixbundle 文件"
        exit 1
    }

    $downloadUrl = $asset.browser_download_url
    $fileName = $asset.name
    $tempPath = "$env:TEMP\$fileName"

    Write-Output "正在下载 App Installer: $fileName"
    Write-Output "下载地址: $downloadUrl"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempPath -UseBasicParsing

    # 检查并安装 VCLibs 依赖
    Write-Output "检查 VCLibs 依赖..."
    $vcLibsInstalled = Get-AppxPackage -Name "Microsoft.VCLibs.140.00.UWPDesktop" -ErrorAction SilentlyContinue

    if (-not $vcLibsInstalled) {
        Write-Output "VCLibs 未安装，正在下载..."
        $vcLibsUrl = "https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx"
        $vcLibsPath = "$env:TEMP\Microsoft.VCLibs.x64.14.00.Desktop.appx"

        try {
            Invoke-WebRequest -Uri $vcLibsUrl -OutFile $vcLibsPath -UseBasicParsing
            Write-Output "正在安装 VCLibs..."
            Add-AppxPackage -Path $vcLibsPath
            Remove-Item $vcLibsPath -Force -ErrorAction SilentlyContinue
            Write-Output "VCLibs 安装成功"
        } catch {
            Write-Output "VCLibs 安装失败，但继续尝试安装 App Installer: $_"
        }
    } else {
        Write-Output "VCLibs 已安装"
    }

    # 安装 App Installer
    Write-Output "正在安装 App Installer..."
    Add-AppxPackage -Path $tempPath

    # 清理临时文件
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue

    Write-Output "App Installer 安装成功"
    exit 0
} catch {
    Write-Output "安装失败: $_"
    exit 1
}
'@

    try {
        # 使用 UAC 提升权限运行脚本（隐藏窗口）
        $encodedScript = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($elevatedScript))
        $process = Start-Process powershell.exe -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-EncodedCommand",$encodedScript -Verb RunAs -Wait -PassThru -WindowStyle Hidden
        exit $process.ExitCode
    } catch {
        Write-Output "UAC 提升失败或被用户取消: $_"
        Write-Output "请以管理员身份运行应用，或手动从 Microsoft Store 安装 App Installer"
        exit 1
    }
}

# 尝试通过 winget 自举安装（如果 winget 部分可用）
try {
    $wingetPath = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetPath) {
        Write-Output "检测到 winget，尝试更新 App Installer..."
        winget install --id Microsoft.AppInstaller --exact --silent --accept-source-agreements --accept-package-agreements
        exit $LASTEXITCODE
    }
} catch {
    Write-Output "winget 不可用，尝试从 GitHub 下载..."
}

# 从 GitHub 下载并安装
try {
    Write-Output "正在从 GitHub 获取最新版本信息..."
    $progressPreference = 'SilentlyContinue'

    # 使用 GitHub API 获取最新版本
    $apiUrl = "https://api.github.com/repos/microsoft/winget-cli/releases/latest"
    $release = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing

    # 找到 .msixbundle 文件
    $asset = $release.assets | Where-Object { $_.name -like "*.msixbundle" } | Select-Object -First 1

    if (-not $asset) {
        Write-Output "未找到 .msixbundle 文件"
        exit 1
    }

    $downloadUrl = $asset.browser_download_url
    $fileName = $asset.name
    $tempPath = "$env:TEMP\$fileName"

    Write-Output "正在下载 App Installer: $fileName"
    Write-Output "下载地址: $downloadUrl"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempPath -UseBasicParsing

    # 检查并安装 VCLibs 依赖
    Write-Output "检查 VCLibs 依赖..."
    $vcLibsInstalled = Get-AppxPackage -Name "Microsoft.VCLibs.140.00.UWPDesktop" -ErrorAction SilentlyContinue

    if (-not $vcLibsInstalled) {
        Write-Output "VCLibs 未安装，正在下载..."
        $vcLibsUrl = "https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx"
        $vcLibsPath = "$env:TEMP\Microsoft.VCLibs.x64.14.00.Desktop.appx"

        try {
            Invoke-WebRequest -Uri $vcLibsUrl -OutFile $vcLibsPath -UseBasicParsing
            Write-Output "正在安装 VCLibs..."
            Add-AppxPackage -Path $vcLibsPath
            Remove-Item $vcLibsPath -Force -ErrorAction SilentlyContinue
            Write-Output "VCLibs 安装成功"
        } catch {
            Write-Output "VCLibs 安装失败，但继续尝试安装 App Installer: $_"
        }
    } else {
        Write-Output "VCLibs 已安装"
    }

    # 安装 App Installer
    Write-Output "正在安装 App Installer..."
    Add-AppxPackage -Path $tempPath

    # 清理临时文件
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue

    Write-Output "App Installer 安装成功"
    exit 0
} catch {
    Write-Output "安装失败: $_"
    exit 1
}
"#;

    let args = vec![
        "-NoProfile".to_string(),
        "-ExecutionPolicy".to_string(),
        "Bypass".to_string(),
        "-Command".to_string(),
        script.to_string(),
    ];

    let capture = execute_process_with_timeout("powershell", &args, APP_INSTALLER_INSTALL_TIMEOUT_MS)?;

    Ok(InstallResult {
        item_key: "app-installer".to_string(),
        package_id: "Microsoft.DesktopAppInstaller".to_string(),
        command: "powershell -NoProfile -ExecutionPolicy Bypass -Command <script>".to_string(),
        stdout: capture.stdout,
        stderr: capture.stderr,
        exit_code: capture.exit_code,
    })
}
