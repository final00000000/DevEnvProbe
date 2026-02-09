use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, LogicalSize, Manager, Size};

mod process_runner;

use process_runner::{execute_process_with_timeout, run_command_with_timeout};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskSnapshot {
    name: String,
    mount_point: String,
    total_gb: f64,
    used_gb: f64,
    usage_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    sample_mode: Option<String>,
    sampled_at_ms: Option<u64>,
    is_stale: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemRealtimeSnapshot {
    uptime_seconds: u64,
    cpu_usage_percent: f64,
    total_memory_gb: f64,
    used_memory_gb: f64,
    memory_usage_percent: f64,
    sample_mode: Option<String>,
    sampled_at_ms: Option<u64>,
    is_stale: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
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

#[derive(Clone, Copy)]
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

const SYSTEM_QUICK_TIMEOUT_MS: u64 = 1_200;
const SYSTEM_PRECISE_TIMEOUT_MS: u64 = 4_000;
const TOOL_DETECT_TIMEOUT_MS: u64 = 1_000;
const DOCKER_ACTION_TIMEOUT_MS: u64 = 10_000;
const DOCKER_BATCH_TIMEOUT_MS: u64 = 25_000;
const WINGET_INSTALL_TIMEOUT_MS: u64 = 20 * 60 * 1_000;

#[derive(Debug, Default)]
struct RuntimeSampleCache {
    snapshot: Option<SystemSnapshot>,
    realtime: Option<SystemRealtimeSnapshot>,
    last_sample_mode: Option<String>,
    last_sampled_at_ms: u64,
}

#[derive(Clone, Default)]
struct AppRuntimeState {
    inner: Arc<RwLock<RuntimeSampleCache>>,
}

impl AppRuntimeState {
    fn get_snapshot(&self) -> Option<SystemSnapshot> {
        self.inner.read().ok().and_then(|cache| cache.snapshot.clone())
    }

    fn get_realtime(&self) -> Option<SystemRealtimeSnapshot> {
        self.inner.read().ok().and_then(|cache| cache.realtime.clone())
    }

    fn update_snapshot(&self, mut snapshot: SystemSnapshot, sample_mode: &str, is_stale: bool) {
        snapshot.sample_mode = Some(sample_mode.to_string());
        snapshot.sampled_at_ms = Some(current_timestamp_ms());
        snapshot.is_stale = Some(is_stale);

        let mut realtime = SystemRealtimeSnapshot {
            uptime_seconds: snapshot.uptime_seconds,
            cpu_usage_percent: snapshot.cpu_usage_percent,
            total_memory_gb: snapshot.total_memory_gb,
            used_memory_gb: snapshot.used_memory_gb,
            memory_usage_percent: snapshot.memory_usage_percent,
            sample_mode: snapshot.sample_mode.clone(),
            sampled_at_ms: snapshot.sampled_at_ms,
            is_stale: snapshot.is_stale,
        };

        if let Ok(mut cache) = self.inner.write() {
            cache.last_sample_mode = Some(sample_mode.to_string());
            cache.last_sampled_at_ms = snapshot.sampled_at_ms.unwrap_or_default();
            cache.snapshot = Some(snapshot);
            realtime.sampled_at_ms = Some(cache.last_sampled_at_ms);
            cache.realtime = Some(realtime);
        }
    }

    fn update_realtime(&self, mut realtime: SystemRealtimeSnapshot, sample_mode: &str, is_stale: bool) {
        realtime.sample_mode = Some(sample_mode.to_string());
        realtime.sampled_at_ms = Some(current_timestamp_ms());
        realtime.is_stale = Some(is_stale);

        if let Ok(mut cache) = self.inner.write() {
            cache.last_sample_mode = Some(sample_mode.to_string());
            cache.last_sampled_at_ms = realtime.sampled_at_ms.unwrap_or_default();

            if let Some(snapshot) = cache.snapshot.as_mut() {
                snapshot.cpu_usage_percent = realtime.cpu_usage_percent;
                snapshot.total_memory_gb = realtime.total_memory_gb;
                snapshot.used_memory_gb = realtime.used_memory_gb;
                snapshot.memory_usage_percent = realtime.memory_usage_percent;
                snapshot.uptime_seconds = realtime.uptime_seconds;
                snapshot.sample_mode = realtime.sample_mode.clone();
                snapshot.sampled_at_ms = realtime.sampled_at_ms;
                snapshot.is_stale = realtime.is_stale;
            }

            cache.realtime = Some(realtime);
        }
    }
}

#[tauri::command]
async fn get_system_snapshot(app: AppHandle) -> CommandResponse<SystemSnapshot> {
    let runtime_state = app.state::<AppRuntimeState>().inner().clone();

    with_timing_async(async move {
        if let Some(snapshot) = runtime_state.get_snapshot() {
            return Ok(snapshot);
        }

        match run_blocking(query_system_snapshot_quick).await {
            Ok(snapshot) => {
                runtime_state.update_snapshot(snapshot.clone(), "quick", false);
                Ok(snapshot)
            }
            Err(error) => {
                if let Some(mut snapshot) = runtime_state.get_snapshot() {
                    snapshot.is_stale = Some(true);
                    return Ok(snapshot);
                }

                let mut snapshot = build_placeholder_snapshot();
                snapshot.is_stale = Some(true);
                snapshot.sample_mode = Some("quick".to_string());
                snapshot.sampled_at_ms = Some(current_timestamp_ms());
                let _ = error;
                Ok(snapshot)
            }
        }
    })
    .await
}

#[tauri::command]
async fn get_system_realtime(app: AppHandle) -> CommandResponse<SystemRealtimeSnapshot> {
    let runtime_state = app.state::<AppRuntimeState>().inner().clone();

    with_timing_async(async move {
        if let Some(realtime) = runtime_state.get_realtime() {
            return Ok(realtime);
        }

        match run_blocking(query_system_realtime_quick).await {
            Ok(realtime) => {
                runtime_state.update_realtime(realtime.clone(), "quick", false);
                Ok(realtime)
            }
            Err(error) => {
                if let Some(mut realtime) = runtime_state.get_realtime() {
                    realtime.is_stale = Some(true);
                    return Ok(realtime);
                }

                let mut realtime = build_placeholder_realtime();
                realtime.is_stale = Some(true);
                realtime.sample_mode = Some("quick".to_string());
                realtime.sampled_at_ms = Some(current_timestamp_ms());
                let _ = error;
                Ok(realtime)
            }
        }
    })
    .await
}

#[tauri::command]
async fn detect_dev_tools() -> CommandResponse<Vec<ToolStatus>> {
    with_timing_async(async {
        let tools = run_blocking(detect_dev_tools_parallel).await?;
        Ok(tools)
    })
    .await
}

fn detect_dev_tools_parallel() -> Result<Vec<ToolStatus>, String> {
    let max_workers = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4)
        .min(8);

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(max_workers)
        .build()
        .map_err(|error| format!("初始化工具探测线程池失败: {}", error))?;

    let tools = pool.install(|| default_tool_specs().par_iter().map(detect_tool).collect::<Vec<_>>());
    Ok(tools)
}

#[tauri::command]
async fn run_docker_action(action: String, target: Option<String>) -> CommandResponse<DockerCommandResult> {
    with_timing_async(async move {
        run_blocking(move || execute_docker_action(&action, target.as_deref(), DOCKER_ACTION_TIMEOUT_MS)).await
    })
    .await
}

#[tauri::command]
async fn get_docker_overview_batch(mode: String) -> CommandResponse<Vec<DockerCommandResult>> {
    with_timing_async(async move { run_blocking(move || execute_docker_overview_batch(&mode)).await }).await
}

#[tauri::command]
async fn install_market_item(item_key: String, install_path: Option<String>) -> CommandResponse<InstallResult> {
    with_timing_async(async move {
        run_blocking(move || execute_install_item(&item_key, install_path.as_deref())).await
    })
    .await
}

#[tauri::command]
async fn pick_install_directory() -> CommandResponse<Option<String>> {
    with_timing_async(async { run_blocking(select_install_directory).await }).await
}

async fn with_timing_async<T, Fut>(operation: Fut) -> CommandResponse<T>
where
    T: Serialize,
    Fut: Future<Output = Result<T, String>>,
{
    let start = Instant::now();
    match operation.await {
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

async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("后台任务执行失败: {}", error))?
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

fn build_placeholder_snapshot() -> SystemSnapshot {
    let logical_cores = std::thread::available_parallelism()
        .map(|count| count.get() as u32)
        .unwrap_or(0);

    SystemSnapshot {
        host_name: std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Unknown".to_string()),
        os_name: "Windows".to_string(),
        os_version: "未知".to_string(),
        build_number: "未知".to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        uptime_seconds: 0,
        cpu_model: "采集中".to_string(),
        cpu_cores: logical_cores,
        cpu_logical_cores: logical_cores,
        cpu_usage_percent: 0.0,
        total_memory_gb: 0.0,
        used_memory_gb: 0.0,
        memory_usage_percent: 0.0,
        disks: Vec::new(),
        sample_mode: Some("quick".to_string()),
        sampled_at_ms: Some(current_timestamp_ms()),
        is_stale: Some(true),
    }
}

fn build_placeholder_realtime() -> SystemRealtimeSnapshot {
    SystemRealtimeSnapshot {
        uptime_seconds: 0,
        cpu_usage_percent: 0.0,
        total_memory_gb: 0.0,
        used_memory_gb: 0.0,
        memory_usage_percent: 0.0,
        sample_mode: Some("quick".to_string()),
        sampled_at_ms: Some(current_timestamp_ms()),
        is_stale: Some(true),
    }
}

fn query_system_snapshot_precise() -> Result<SystemSnapshot, String> {
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

    let raw = run_command_with_timeout(
        "powershell",
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        SYSTEM_PRECISE_TIMEOUT_MS,
    )?;

    let mut snapshot: SystemSnapshot = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "系统信息解析失败: {}。原始输出: {}",
            error,
            raw
        )
    })?;

    snapshot.sample_mode = Some("precise".to_string());
    snapshot.sampled_at_ms = Some(current_timestamp_ms());
    snapshot.is_stale = Some(false);
    Ok(snapshot)
}

fn query_system_snapshot_quick() -> Result<SystemSnapshot, String> {
    if !cfg!(target_os = "windows") {
        return Err("当前版本仅实现 Windows 系统信息采集".to_string());
    }

    let script = r#"
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$cs = Get-CimInstance Win32_ComputerSystem
$cpuPerfRaw = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name = '_Total'" | Select-Object -ExpandProperty PercentProcessorTime
$cpuUsage = if ($null -eq $cpuPerfRaw) { 0 } else { [double]$cpuPerfRaw }
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

    let raw = run_command_with_timeout(
        "powershell",
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        SYSTEM_QUICK_TIMEOUT_MS,
    )?;

    let mut snapshot: SystemSnapshot = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "快速系统信息解析失败: {}。原始输出: {}",
            error,
            raw
        )
    })?;

    snapshot.sample_mode = Some("quick".to_string());
    snapshot.sampled_at_ms = Some(current_timestamp_ms());
    snapshot.is_stale = Some(false);
    Ok(snapshot)
}

fn query_system_realtime_quick() -> Result<SystemRealtimeSnapshot, String> {
    if !cfg!(target_os = "windows") {
        return Err("当前版本仅实现 Windows 系统信息采集".to_string());
    }

    let script = r#"
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$os = Get-CimInstance Win32_OperatingSystem
    $cpuUsageRaw = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name = '_Total'" | Select-Object -ExpandProperty PercentProcessorTime

$totalMemoryGb = [double]$os.TotalVisibleMemorySize / 1MB
$freeMemoryGb = [double]$os.FreePhysicalMemory / 1MB
$usedMemoryGb = $totalMemoryGb - $freeMemoryGb
$uptimeSeconds = [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds
    $cpuUsage = if ($null -eq $cpuUsageRaw) { 0 } else { [double]$cpuUsageRaw }
$cpuUsage = [math]::Min(100, [math]::Max(0, [double]$cpuUsage))

[pscustomobject]@{
  uptimeSeconds = $uptimeSeconds
  cpuUsagePercent = [math]::Round($cpuUsage, 1)
  totalMemoryGb = [math]::Round($totalMemoryGb, 2)
  usedMemoryGb = [math]::Round($usedMemoryGb, 2)
  memoryUsagePercent = if ($totalMemoryGb -gt 0) { [math]::Round([math]::Min(100, [math]::Max(0, ($usedMemoryGb / $totalMemoryGb) * 100)), 1) } else { 0 }
} | ConvertTo-Json -Depth 4 -Compress
"#;

    let raw = run_command_with_timeout(
        "powershell",
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        SYSTEM_QUICK_TIMEOUT_MS,
    )?;

    let mut realtime: SystemRealtimeSnapshot = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "快速实时系统信息解析失败: {}。原始输出: {}",
            error,
            raw
        )
    })?;

    realtime.sample_mode = Some("quick".to_string());
    realtime.sampled_at_ms = Some(current_timestamp_ms());
    realtime.is_stale = Some(false);
    Ok(realtime)
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
    let args: Vec<String> = spec.args.iter().map(|arg| (*arg).to_string()).collect();
    let result = execute_process_with_timeout(spec.command, &args, TOOL_DETECT_TIMEOUT_MS);

    match result {
        Ok(output) => {
            let stdout = output.stdout;
            let stderr = output.stderr;
            let raw = if !stdout.is_empty() {
                stdout.clone()
            } else {
                stderr.clone()
            };

            ToolStatus {
                name: spec.name.to_string(),
                command: spec.command.to_string(),
                category: spec.category.to_string(),
                installed: output.exit_code == 0,
                version: first_line(&raw),
                details: if output.exit_code == 0 {
                    None
                } else {
                    Some(format!(
                        "返回码 {}，{}",
                        output.exit_code,
                        if stderr.is_empty() { "无错误输出" } else { &stderr }
                    ))
                },
                install_key: spec.install_key.map(ToString::to_string),
            }
        }
        Err(error) => detect_tool_with_fallback(spec, error),
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

    match run_command_with_timeout(
        "powershell",
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script.as_str()],
        TOOL_DETECT_TIMEOUT_MS,
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

    if let Ok(where_output) = run_command_with_timeout("where", &[executable], TOOL_DETECT_TIMEOUT_MS) {
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
    let normalized_args: Vec<String> = args.iter().map(|item| (*item).to_string()).collect();
    let output = execute_process_with_timeout(path, &normalized_args, TOOL_DETECT_TIMEOUT_MS).ok()?;
    let raw = if output.stdout.is_empty() {
        output.stderr
    } else {
        output.stdout
    };
    first_line(&raw)
}

fn execute_docker_action(
    action: &str,
    target: Option<&str>,
    timeout_ms: u64,
) -> Result<DockerCommandResult, String> {
    let args = build_docker_args(action, target)?;
    let capture = execute_process_with_timeout("docker", &args, timeout_ms)?;

    Ok(DockerCommandResult {
        action: action.to_string(),
        command: format!("docker {}", args.join(" ")),
        stdout: capture.stdout,
        stderr: capture.stderr,
        exit_code: capture.exit_code,
    })
}

fn execute_docker_overview_batch(mode: &str) -> Result<Vec<DockerCommandResult>, String> {
    let actions: Vec<&str> = match mode {
        "full" => vec!["version", "info", "ps", "images", "stats", "compose_ls", "system_df"],
        _ => vec!["version", "ps", "images", "compose_ls"],
    };

    let started_at = Instant::now();
    let mut results = Vec::with_capacity(actions.len());

    for action in actions {
        let elapsed_ms = started_at.elapsed().as_millis() as u64;
        if elapsed_ms >= DOCKER_BATCH_TIMEOUT_MS {
            results.push(DockerCommandResult {
                action: action.to_string(),
                command: format!("docker {}", action),
                stdout: String::new(),
                stderr: format!("批量刷新超时（{}ms）", DOCKER_BATCH_TIMEOUT_MS),
                exit_code: -1,
            });
            continue;
        }

        let remain_timeout = (DOCKER_BATCH_TIMEOUT_MS - elapsed_ms).min(DOCKER_ACTION_TIMEOUT_MS);
        match execute_docker_action(action, None, remain_timeout) {
            Ok(result) => results.push(result),
            Err(error) => {
                results.push(DockerCommandResult {
                    action: action.to_string(),
                    command: format!("docker {}", action),
                    stdout: String::new(),
                    stderr: error,
                    exit_code: -1,
                });
            }
        }
    }

    Ok(results)
}

fn execute_install_item(item_key: &str, install_path: Option<&str>) -> Result<InstallResult, String> {
    let spec = install_specs()
        .into_iter()
        .find(|item| item.key == item_key)
        .ok_or_else(|| format!("未找到可安装项：{}", item_key))?;

    let _ = run_command_with_timeout("winget", &["--version"], TOOL_DETECT_TIMEOUT_MS)
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

    let capture = execute_process_with_timeout("winget", &args, WINGET_INSTALL_TIMEOUT_MS)?;

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

    let picked = run_command_with_timeout(
        "powershell",
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-Command", script],
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

fn first_line(raw: &str) -> Option<String> {
    raw.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn spawn_system_sampling_workers(runtime_state: AppRuntimeState) {
    let quick_state = runtime_state.clone();
    thread::spawn(move || loop {
        match query_system_realtime_quick() {
            Ok(realtime) => quick_state.update_realtime(realtime, "quick", false),
            Err(_) => {
                if let Some(mut stale) = quick_state.get_realtime() {
                    stale.is_stale = Some(true);
                    quick_state.update_realtime(stale, "quick", true);
                }
            }
        }

        thread::sleep(Duration::from_secs(1));
    });

    let precise_state = runtime_state.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(500));
        loop {
            if let Ok(snapshot) = query_system_snapshot_precise() {
                precise_state.update_snapshot(snapshot, "precise", false);
            }

            thread::sleep(Duration::from_secs(10));
        }
    });
}

fn adapt_main_window_for_monitor(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(AppRuntimeState::default())
        .setup(|app| {
            adapt_main_window_for_monitor(&app.handle());

            let runtime_state = app.state::<AppRuntimeState>().inner().clone();
            spawn_system_sampling_workers(runtime_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_snapshot,
            get_system_realtime,
            detect_dev_tools,
            run_docker_action,
            get_docker_overview_batch,
            install_market_item,
            pick_install_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_identifier_validation_should_work() {
        assert!(is_safe_identifier("redis-dev_01"));
        assert!(is_safe_identifier("container.name-1"));
        assert!(!is_safe_identifier(""));
        assert!(!is_safe_identifier("../../etc/passwd"));
        assert!(!is_safe_identifier("redis dev"));
    }

    #[test]
    fn build_docker_args_should_validate_target() {
        let logs = build_docker_args("logs", Some("redis-dev")).expect("logs args should build");
        assert_eq!(logs[0], "logs");
        assert!(build_docker_args("logs", Some("redis dev")).is_err());
        assert!(build_docker_args("start", None).is_err());
    }

    #[test]
    fn runtime_state_should_keep_latest_snapshot_and_realtime() {
        let state = AppRuntimeState::default();
        let snapshot = SystemSnapshot {
            host_name: "host".to_string(),
            os_name: "Windows".to_string(),
            os_version: "10".to_string(),
            build_number: "19045".to_string(),
            architecture: "x64".to_string(),
            uptime_seconds: 100,
            cpu_model: "cpu".to_string(),
            cpu_cores: 4,
            cpu_logical_cores: 8,
            cpu_usage_percent: 12.5,
            total_memory_gb: 16.0,
            used_memory_gb: 6.0,
            memory_usage_percent: 37.5,
            disks: Vec::new(),
            sample_mode: None,
            sampled_at_ms: None,
            is_stale: None,
        };

        state.update_snapshot(snapshot, "quick", false);

        let realtime = state.get_realtime().expect("realtime should exist");
        assert_eq!(realtime.uptime_seconds, 100);
        assert_eq!(realtime.sample_mode.as_deref(), Some("quick"));

        let latest_snapshot = state.get_snapshot().expect("snapshot should exist");
        assert_eq!(latest_snapshot.sample_mode.as_deref(), Some("quick"));
        assert_eq!(latest_snapshot.is_stale, Some(false));
    }

    #[test]
    fn docker_batch_should_return_partial_results_when_command_missing() {
        let results = execute_docker_overview_batch("quick").expect("batch call should not hard fail");
        assert!(!results.is_empty());
        assert!(results.iter().all(|item| !item.action.is_empty()));
    }
}










