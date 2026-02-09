use encoding_rs::GBK;
use serde::{Deserialize, Serialize};
use std::fmt::Display;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Instant;
use tauri::{LogicalSize, Manager, Size};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResponse<T>
where
    T: Serialize,
{
    ok: bool,
    data: Option<T>,
    error: Option<String>,
    elapsed_ms: u128,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskSnapshot {
    name: String,
    mount_point: String,
    total_gb: f64,
    used_gb: f64,
    usage_percent: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemSnapshot {
    host_name: String,
    os_name: String,
    os_version: String,
    build_number: String,
    architecture: String,
    uptime_seconds: u64,
    cpu_model: String,
    cpu_cores: u32,
    cpu_logical_cores: u32,
    cpu_usage_percent: f64,
    total_memory_gb: f64,
    used_memory_gb: f64,
    memory_usage_percent: f64,
    disks: Vec<DiskSnapshot>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemRealtimeSnapshot {
    uptime_seconds: u64,
    cpu_usage_percent: f64,
    total_memory_gb: f64,
    used_memory_gb: f64,
    memory_usage_percent: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolStatus {
    name: String,
    command: String,
    category: String,
    installed: bool,
    version: Option<String>,
    details: Option<String>,
    install_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DockerCommandResult {
    action: String,
    command: String,
    stdout: String,
    stderr: String,
    exit_code: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallResult {
    item_key: String,
    package_id: String,
    command: String,
    stdout: String,
    stderr: String,
    exit_code: i32,
}

struct ToolSpec {
    name: &'static str,
    command: &'static str,
    args: &'static [&'static str],
    category: &'static str,
    install_key: Option<&'static str>,
}

struct InstallSpec {
    key: &'static str,
    package_id: &'static str,
}

struct ProcessCapture {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

#[tauri::command]
fn get_system_snapshot() -> CommandResponse<SystemSnapshot> {
    with_timing(query_system_snapshot)
}

#[tauri::command]
fn get_system_realtime() -> CommandResponse<SystemRealtimeSnapshot> {
    with_timing(query_system_realtime)
}

#[tauri::command]
fn detect_dev_tools() -> CommandResponse<Vec<ToolStatus>> {
    with_timing(|| Ok(default_tool_specs().iter().map(detect_tool).collect()))
}

#[tauri::command]
fn run_docker_action(action: String, target: Option<String>) -> CommandResponse<DockerCommandResult> {
    with_timing(|| execute_docker_action(&action, target.as_deref()))
}

#[tauri::command]
fn install_market_item(item_key: String, install_path: Option<String>) -> CommandResponse<InstallResult> {
    with_timing(|| execute_install_item(&item_key, install_path.as_deref()))
}

#[tauri::command]
fn pick_install_directory() -> CommandResponse<Option<String>> {
    with_timing(select_install_directory)
}

fn with_timing<T, F>(operation: F) -> CommandResponse<T>
where
    T: Serialize,
    F: FnOnce() -> Result<T, String>,
{
    let start = Instant::now();
    match operation() {
        Ok(data) => CommandResponse {
            ok: true,
            data: Some(data),
            error: None,
            elapsed_ms: start.elapsed().as_millis(),
        },
        Err(error) => CommandResponse {
            ok: false,
            data: None,
            error: Some(error),
            elapsed_ms: start.elapsed().as_millis(),
        },
    }
}

fn query_system_snapshot() -> Result<SystemSnapshot, String> {
    if !cfg!(target_os = "windows") {
        return Err("当前版本仅实现 Windows 系统信息采集".to_string());
    }

    let script = r#"
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$cs = Get-CimInstance Win32_ComputerSystem

# 使用连续采样方法，确保准确性（专家推荐方案）
try {
  # 方法1：尝试使用 Processor Utility（Windows 11新计数器）
  $samples = Get-Counter '\Processor Information(_Total)\% Processor Utility' -SampleInterval 1 -MaxSamples 2 -ErrorAction Stop
  $cpuUsage = $samples[-1].CounterSamples[0].CookedValue
} catch {
  try {
    # 方法2：回退到传统 Processor Time，使用连续采样
    $samples = Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 2 -ErrorAction Stop
    $cpuUsage = $samples[-1].CounterSamples[0].CookedValue
  } catch {
    # 方法3：最终回退到WMI
    $cpuPerfRaw = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object { $_.Name -eq '_Total' } | Select-Object -ExpandProperty PercentProcessorTime
    $cpuUsage = if ($null -eq $cpuPerfRaw) { 0 } else { [double]$cpuPerfRaw }
  }
}
$cpuUsage = [math]::Min(100, [math]::Max(0, [math]::Round($cpuUsage, 1)))

$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType = 3" | ForEach-Object {
  $total = [double]$_.Size / 1GB
  $free = [double]$_.FreeSpace / 1GB
  $used = $total - $free

  [pscustomobject]@{
    name = $_.DeviceID
    mountPoint = $_.DeviceID
    totalGb = [math]::Round($total, 2)
    usedGb = [math]::Round($used, 2)
    usagePercent = if ($total -gt 0) { [math]::Round(($used / $total) * 100, 1) } else { 0 }
  }
}

$totalMemoryGb = [double]$cs.TotalPhysicalMemory / 1GB
$freeMemoryGb = [double]$os.FreePhysicalMemory / 1048576
$usedMemoryGb = $totalMemoryGb - $freeMemoryGb
$uptimeSeconds = [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds

[pscustomobject]@{
  hostName = $env:COMPUTERNAME
  osName = $os.Caption
  osVersion = $os.Version
  buildNumber = $os.BuildNumber
  architecture = $os.OSArchitecture
  uptimeSeconds = $uptimeSeconds
  cpuModel = $cpu.Name
  cpuCores = [int]$cpu.NumberOfCores
  cpuLogicalCores = [int]$cpu.NumberOfLogicalProcessors
  cpuUsagePercent = [math]::Round($cpuUsage, 1)
  totalMemoryGb = [math]::Round($totalMemoryGb, 2)
  usedMemoryGb = [math]::Round($usedMemoryGb, 2)
  memoryUsagePercent = if ($totalMemoryGb -gt 0) { [math]::Round([math]::Min(100, [math]::Max(0, ($usedMemoryGb / $totalMemoryGb) * 100)), 1) } else { 0 }
  disks = @($disks)
} | ConvertTo-Json -Depth 6 -Compress
"#;

    let raw = run_command(
        "powershell",
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    )?;

    serde_json::from_str(&raw).map_err(|error| {
        format!(
            "系统信息解析失败: {}。原始输出: {}",
            display_error(error),
            raw
        )
    })
}


fn query_system_realtime() -> Result<SystemRealtimeSnapshot, String> {
    if !cfg!(target_os = "windows") {
        return Err("当前版本仅实现 Windows 系统信息采集".to_string());
    }

    let script = r#"
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$os = Get-CimInstance Win32_OperatingSystem
$cpuUsageRaw = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name = '_Total'" | Select-Object -ExpandProperty PercentProcessorTime
$cpuUtilityRaw = (Get-Counter '\Processor Information(_Total)\% Processor Utility' -ErrorAction SilentlyContinue).CounterSamples | Select-Object -First 1 -ExpandProperty CookedValue
if ($null -eq $cpuUtilityRaw) {
  $cpuUtilityRaw = (Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction SilentlyContinue).CounterSamples | Select-Object -First 1 -ExpandProperty CookedValue
}

$totalMemoryGb = [double]$os.TotalVisibleMemorySize / 1MB
$freeMemoryGb = [double]$os.FreePhysicalMemory / 1MB
$usedMemoryGb = $totalMemoryGb - $freeMemoryGb
$uptimeSeconds = [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds
$cpuUsage = if ($null -eq $cpuUtilityRaw) {
  if ($null -eq $cpuUsageRaw) { 0 } else { [double]$cpuUsageRaw }
} else {
  [double]$cpuUtilityRaw
}
$cpuUsage = [math]::Min(100, [math]::Max(0, [double]$cpuUsage))

[pscustomobject]@{
  uptimeSeconds = $uptimeSeconds
  cpuUsagePercent = [math]::Round($cpuUsage, 1)
  totalMemoryGb = [math]::Round($totalMemoryGb, 2)
  usedMemoryGb = [math]::Round($usedMemoryGb, 2)
  memoryUsagePercent = if ($totalMemoryGb -gt 0) { [math]::Round([math]::Min(100, [math]::Max(0, ($usedMemoryGb / $totalMemoryGb) * 100)), 1) } else { 0 }
} | ConvertTo-Json -Depth 4 -Compress
"#;

    let raw = run_command(
        "powershell",
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    )?;

    serde_json::from_str(&raw).map_err(|error| {
        format!(
            "实时系统信息解析失败: {}。原始输出: {}",
            display_error(error),
            raw
        )
    })
}
fn default_tool_specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "Node.js",
            command: "node",
            args: &["-v"],
            category: "Runtime",
            install_key: Some("nodejs-lts"),
        },
        ToolSpec {
            name: "npm",
            command: "npm",
            args: &["-v"],
            category: "Package",
            install_key: Some("nodejs-lts"),
        },
        ToolSpec {
            name: "pnpm",
            command: "pnpm",
            args: &["-v"],
            category: "Package",
            install_key: Some("pnpm"),
        },
        ToolSpec {
            name: "Yarn",
            command: "yarn",
            args: &["-v"],
            category: "Package",
            install_key: Some("yarn"),
        },
        ToolSpec {
            name: "Bun",
            command: "bun",
            args: &["--version"],
            category: "Runtime",
            install_key: Some("bun"),
        },
        ToolSpec {
            name: "Deno",
            command: "deno",
            args: &["--version"],
            category: "Runtime",
            install_key: Some("deno"),
        },
        ToolSpec {
            name: "Python",
            command: "python",
            args: &["--version"],
            category: "Runtime",
            install_key: Some("python"),
        },
        ToolSpec {
            name: "pip",
            command: "pip",
            args: &["--version"],
            category: "Package",
            install_key: Some("python"),
        },
        ToolSpec {
            name: "pipx",
            command: "pipx",
            args: &["--version"],
            category: "Package",
            install_key: Some("pipx"),
        },
        ToolSpec {
            name: "uv",
            command: "uv",
            args: &["--version"],
            category: "Package",
            install_key: Some("uv"),
        },
        ToolSpec {
            name: "Conda",
            command: "conda",
            args: &["--version"],
            category: "Runtime",
            install_key: Some("miniconda"),
        },
        ToolSpec {
            name: "Go",
            command: "go",
            args: &["version"],
            category: "Language",
            install_key: Some("go"),
        },
        ToolSpec {
            name: "Java",
            command: "java",
            args: &["-version"],
            category: "Language",
            install_key: Some("openjdk"),
        },
        ToolSpec {
            name: "Javac",
            command: "javac",
            args: &["-version"],
            category: "Language",
            install_key: Some("openjdk"),
        },
        ToolSpec {
            name: "Maven",
            command: "mvn",
            args: &["-version"],
            category: "Build",
            install_key: Some("maven"),
        },
        ToolSpec {
            name: "Gradle",
            command: "gradle",
            args: &["-v"],
            category: "Build",
            install_key: Some("gradle"),
        },
        ToolSpec {
            name: "Rust",
            command: "rustc",
            args: &["--version"],
            category: "Language",
            install_key: Some("rustup"),
        },
        ToolSpec {
            name: "Cargo",
            command: "cargo",
            args: &["--version"],
            category: "Build",
            install_key: Some("rustup"),
        },
        ToolSpec {
            name: "Git",
            command: "git",
            args: &["--version"],
            category: "SCM",
            install_key: Some("git"),
        },
        ToolSpec {
            name: "GitHub CLI",
            command: "gh",
            args: &["--version"],
            category: "SCM",
            install_key: Some("gh"),
        },
        ToolSpec {
            name: "Docker",
            command: "docker",
            args: &["--version"],
            category: "Container",
            install_key: Some("docker-desktop"),
        },
        ToolSpec {
            name: "Docker Compose",
            command: "docker",
            args: &["compose", "version"],
            category: "Container",
            install_key: Some("docker-desktop"),
        },
        ToolSpec {
            name: "kubectl",
            command: "kubectl",
            args: &["version", "--client"],
            category: "Container",
            install_key: Some("kubectl"),
        },
        ToolSpec {
            name: "Helm",
            command: "helm",
            args: &["version"],
            category: "Container",
            install_key: Some("helm"),
        },
        ToolSpec {
            name: "Terraform",
            command: "terraform",
            args: &["-version"],
            category: "IaC",
            install_key: Some("terraform"),
        },
        ToolSpec {
            name: ".NET SDK",
            command: "dotnet",
            args: &["--version"],
            category: "Language",
            install_key: Some("dotnet-sdk"),
        },
        ToolSpec {
            name: "PowerShell",
            command: "pwsh",
            args: &["--version"],
            category: "Shell",
            install_key: Some("powershell"),
        },
        ToolSpec {
            name: "VS Code",
            command: "code",
            args: &["--version"],
            category: "IDE",
            install_key: Some("vscode"),
        },
        ToolSpec {
            name: "AWS CLI",
            command: "aws",
            args: &["--version"],
            category: "Cloud",
            install_key: Some("aws-cli"),
        },
        ToolSpec {
            name: "Azure CLI",
            command: "az",
            args: &["--version"],
            category: "Cloud",
            install_key: Some("azure-cli"),
        },
        ToolSpec {
            name: "Google Cloud CLI",
            command: "gcloud",
            args: &["--version"],
            category: "Cloud",
            install_key: Some("gcloud-cli"),
        },
        ToolSpec {
            name: "Flutter",
            command: "flutter",
            args: &["--version"],
            category: "Mobile",
            install_key: Some("flutter"),
        },
        ToolSpec {
            name: "Dart",
            command: "dart",
            args: &["--version"],
            category: "Language",
            install_key: Some("dart"),
        },
        ToolSpec {
            name: "ADB",
            command: "adb",
            args: &["version"],
            category: "Mobile",
            install_key: Some("android-platform-tools"),
        },
        ToolSpec {
            name: "CMake",
            command: "cmake",
            args: &["--version"],
            category: "Build",
            install_key: Some("cmake"),
        },
        ToolSpec {
            name: "SQLite CLI",
            command: "sqlite3",
            args: &["--version"],
            category: "Database",
            install_key: Some("sqlite"),
        },
        ToolSpec {
            name: "PostgreSQL CLI",
            command: "psql",
            args: &["--version"],
            category: "Database",
            install_key: Some("postgresql"),
        },
        ToolSpec {
            name: "MySQL CLI",
            command: "mysql",
            args: &["--version"],
            category: "Database",
            install_key: Some("mysql"),
        },
        ToolSpec {
            name: "MongoDB Shell",
            command: "mongosh",
            args: &["--version"],
            category: "Database",
            install_key: Some("mongodb-shell"),
        },
        ToolSpec {
            name: "Redis CLI",
            command: "redis-cli",
            args: &["--version"],
            category: "Database",
            install_key: Some("redis"),
        },
    ]
}

fn install_specs() -> Vec<InstallSpec> {
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
    ]
}

fn detect_tool(spec: &ToolSpec) -> ToolStatus {
    let result = create_command(spec.command).args(spec.args).output();

    match result {
        Ok(output) => {
            let stdout = decode_bytes(&output.stdout);
            let stderr = decode_bytes(&output.stderr);
            let raw = if !stdout.is_empty() {
                stdout.clone()
            } else {
                stderr.clone()
            };

            ToolStatus {
                name: spec.name.to_string(),
                command: spec.command.to_string(),
                category: spec.category.to_string(),
                installed: true,
                version: first_line(&raw),
                details: if output.status.success() {
                    None
                } else {
                    Some(format!(
                        "返回码 {:?}，{}",
                        output.status.code(),
                        if stderr.is_empty() { "无错误输出" } else { &stderr }
                    ))
                },
                install_key: spec.install_key.map(ToString::to_string),
            }
        }
        Err(error) => detect_tool_with_fallback(spec, display_error(error)),
    }
}

fn detect_tool_with_fallback(spec: &ToolSpec, detect_error: String) -> ToolStatus {
    let install_key = spec.install_key.unwrap_or_default();

    if install_key == "cmake" {
        if let Some(path) = detect_windows_executable_path(
            "cmake.exe",
            &[
                r"CMake\bin\cmake.exe",
                r"Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
                r"Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
                r"Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
                r"Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
            ],
        ) {
            let version = detect_tool_version_from_path(&path, spec.args)
                .or_else(|| Some("通过路径检测到已安装".to_string()));

            return ToolStatus {
                name: spec.name.to_string(),
                command: spec.command.to_string(),
                category: spec.category.to_string(),
                installed: true,
                version,
                details: Some(format!("检测路径：{}", path)),
                install_key: spec.install_key.map(ToString::to_string),
            };
        }
    }

    if install_key == "mysql" {
        if let Some(service) = detect_windows_service_by_pattern("*mysql*") {
            return ToolStatus {
                name: spec.name.to_string(),
                command: spec.command.to_string(),
                category: spec.category.to_string(),
                installed: true,
                version: Some("通过服务检测到已安装".to_string()),
                details: Some(format!("检测到服务：{}", service)),
                install_key: spec.install_key.map(ToString::to_string),
            };
        }
    }

    if install_key == "postgresql" {
        if let Some(service) = detect_windows_service_by_pattern("*postgres*") {
            return ToolStatus {
                name: spec.name.to_string(),
                command: spec.command.to_string(),
                category: spec.category.to_string(),
                installed: true,
                version: Some("通过服务检测到已安装".to_string()),
                details: Some(format!("检测到服务：{}", service)),
                install_key: spec.install_key.map(ToString::to_string),
            };
        }
    }

    ToolStatus {
        name: spec.name.to_string(),
        command: spec.command.to_string(),
        category: spec.category.to_string(),
        installed: false,
        version: None,
        details: Some(detect_error),
        install_key: spec.install_key.map(ToString::to_string),
    }
}

fn detect_windows_service_by_pattern(pattern: &str) -> Option<String> {
    if !cfg!(target_os = "windows") {
        return None;
    }

    let script = format!(
        "$service = Get-Service -Name '{}' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($service) {{ \"$($service.Name) ($($service.Status))\" }}",
        pattern
    );

    match run_command(
        "powershell",
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script.as_str()],
    ) {
        Ok(output) => {
            let value = output.trim().to_string();
            if value.is_empty() {
                None
            } else {
                Some(value)
            }
        }
        Err(_) => None,
    }
}

fn detect_windows_executable_path(executable: &str, fallback_sub_paths: &[&str]) -> Option<String> {
    if !cfg!(target_os = "windows") {
        return None;
    }

    if let Ok(where_output) = run_command("where", &[executable]) {
        if let Some(path) = first_line(&where_output) {
            return Some(path);
        }
    }

    for root_key in ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"] {
        if let Ok(root) = std::env::var(root_key) {
            for sub_path in fallback_sub_paths {
                let candidate = Path::new(&root).join(sub_path);
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
    }

    None
}

fn detect_tool_version_from_path(path: &str, args: &[&str]) -> Option<String> {
    let output = create_command(path).args(args).output().ok()?;
    let stdout = decode_bytes(&output.stdout);
    let stderr = decode_bytes(&output.stderr);
    let raw = if stdout.is_empty() { stderr } else { stdout };
    first_line(&raw)
}

fn execute_docker_action(action: &str, target: Option<&str>) -> Result<DockerCommandResult, String> {
    let args = build_docker_args(action, target)?;
    let capture = execute_process("docker", &args)?;

    Ok(DockerCommandResult {
        action: action.to_string(),
        command: format!("docker {}", args.join(" ")),
        stdout: capture.stdout,
        stderr: capture.stderr,
        exit_code: capture.exit_code,
    })
}

fn execute_install_item(item_key: &str, install_path: Option<&str>) -> Result<InstallResult, String> {
    let spec = install_specs()
        .into_iter()
        .find(|item| item.key == item_key)
        .ok_or_else(|| format!("未找到可安装项：{}", item_key))?;

    let _ = run_command("winget", &["--version"])
        .map_err(|_| "未检测到 winget，请先安装 App Installer".to_string())?;

    let mut args = vec![
        "install".to_string(),
        "--id".to_string(),
        spec.package_id.to_string(),
        "--exact".to_string(),
        "--silent".to_string(),
        "--accept-source-agreements".to_string(),
        "--accept-package-agreements".to_string(),
    ];

    if let Some(path) = install_path.map(str::trim).filter(|value| !value.is_empty()) {
        args.push("--location".to_string());
        args.push(path.to_string());
    }

    let capture = execute_process("winget", &args)?;

    Ok(InstallResult {
        item_key: item_key.to_string(),
        package_id: spec.package_id.to_string(),
        command: format!("winget {}", args.join(" ")),
        stdout: capture.stdout,
        stderr: capture.stderr,
        exit_code: capture.exit_code,
    })
}

fn select_install_directory() -> Result<Option<String>, String> {
    if !cfg!(target_os = "windows") {
        return Ok(None);
    }

    let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "选择安装目录"
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  $dialog.SelectedPath
}
"#;

    let picked = run_command(
        "powershell",
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-Command", script],
    )
    .unwrap_or_default();

    let normalized = picked.trim().to_string();
    if normalized.is_empty() {
        Ok(None)
    } else {
        Ok(Some(normalized))
    }
}

fn build_docker_args(action: &str, target: Option<&str>) -> Result<Vec<String>, String> {
    match action {
        "version" => Ok(vec!["--version".to_string()]),
        "info" => Ok(vec!["info".to_string()]),
        "ps" => Ok(vec![
            "ps".to_string(),
            "--format".to_string(),
            "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}".to_string(),
        ]),
        "images" => Ok(vec![
            "images".to_string(),
            "--format".to_string(),
            "table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}".to_string(),
        ]),
        "stats" => Ok(vec![
            "stats".to_string(),
            "--no-stream".to_string(),
            "--format".to_string(),
            "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}".to_string(),
        ]),
        "system_df" => Ok(vec!["system".to_string(), "df".to_string()]),
        "compose_ls" => Ok(vec!["compose".to_string(), "ls".to_string()]),
        "start" | "stop" | "restart" | "logs" => {
            let target = target.ok_or_else(|| format!("动作 {} 需要提供容器名称或 ID", action))?;
            if !is_safe_identifier(target) {
                return Err("容器标识不合法，仅允许字母、数字、点、下划线、中划线".to_string());
            }

            match action {
                "start" => Ok(vec!["start".to_string(), target.to_string()]),
                "stop" => Ok(vec!["stop".to_string(), target.to_string()]),
                "restart" => Ok(vec!["restart".to_string(), target.to_string()]),
                "logs" => Ok(vec![
                    "logs".to_string(),
                    "--tail".to_string(),
                    "200".to_string(),
                    target.to_string(),
                ]),
                _ => Err("未支持的 Docker 动作".to_string()),
            }
        }
        _ => Err(format!("未支持的 Docker 动作: {}", action)),
    }
}

fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}

fn create_command(command: &str) -> Command {
    let mut process = Command::new(command);

    #[cfg(target_os = "windows")]
    {
        process.creation_flags(CREATE_NO_WINDOW);
    }

    process
}

#[cfg(target_os = "windows")]
fn terminate_process(pid: u32) {
    let pid_str = pid.to_string();
    let _ = create_command("taskkill")
        .args(["/PID", &pid_str, "/T", "/F"])
        .output();
}

#[cfg(not(target_os = "windows"))]
fn terminate_process(_pid: u32) {}

fn execute_process(command: &str, args: &[String]) -> Result<ProcessCapture, String> {
    let output = create_command(command)
        .args(args)
        .output()
        .map_err(display_error)?;

    Ok(ProcessCapture {
        stdout: decode_bytes(&output.stdout),
        stderr: decode_bytes(&output.stderr),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

fn run_command(command: &str, args: &[&str]) -> Result<String, String> {
    let output = create_command(command)
        .args(args)
        .output()
        .map_err(display_error)?;

    let stdout = decode_bytes(&output.stdout);
    let stderr = decode_bytes(&output.stderr);

    if output.status.success() {
        if stdout.is_empty() {
            Ok(stderr)
        } else {
            Ok(stdout)
        }
    } else {
        Err(format!(
            "执行命令失败（返回码 {:?}）：{}",
            output.status.code(),
            if stderr.is_empty() { stdout } else { stderr }
        ))
    }
}

fn decode_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    if let Ok(decoded) = std::str::from_utf8(bytes) {
        return decoded.trim().to_string();
    }

    let (gbk_decoded, _, had_errors) = GBK.decode(bytes);
    if !had_errors {
        return gbk_decoded.trim().to_string();
    }

    String::from_utf8_lossy(bytes).trim().to_string()
}

fn first_line(raw: &str) -> Option<String> {
    raw.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn display_error<E: Display>(error: E) -> String {
    error.to_string()
}

fn adapt_main_window_for_monitor(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let size = monitor.size();
            let target_width = ((size.width as f64) * 0.78).clamp(980.0, 1800.0);
            let target_height = ((size.height as f64) * 0.82).clamp(680.0, 1260.0);

            let _ = window.set_size(Size::Logical(LogicalSize::new(target_width, target_height)));
            let _ = window.center();
            return;
        }

        let _ = window.center();
    }
}

fn ensure_single_instance(app: &tauri::AppHandle) {
    let current_pid = std::process::id();
    let app_dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(_) => return,
    };
    let lock_path = app_dir.join("instance.lock");

    if let Ok(contents) = fs::read_to_string(&lock_path) {
        if let Ok(previous_pid) = contents.trim().parse::<u32>() {
            if previous_pid != current_pid {
                terminate_process(previous_pid);
            }
        }
    }

    if let Some(parent) = lock_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&lock_path, current_pid.to_string());
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            ensure_single_instance(&app.handle());
            adapt_main_window_for_monitor(&app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_snapshot,
            get_system_realtime,
            detect_dev_tools,
            run_docker_action,
            install_market_item,
            pick_install_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}










