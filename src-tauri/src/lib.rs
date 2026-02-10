use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, LogicalSize, Manager, Size};

mod process_runner;

use process_runner::{execute_process_with_timeout, execute_process_with_timeout_in_dir, run_command_with_timeout};

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
    install_path: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeployStepRequest {
    profile: DeployProfile,
    step: String,
    selected_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeployProfile {
    id: String,
    name: String,
    mode: String,
    git: DeployGitConfig,
    compose: DeployComposeConfig,
    run: DeployRunConfig,
    created_at: u64,
    updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeployGitConfig {
    enabled: bool,
    remote: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeployComposeConfig {
    project_path: String,
    compose_file: String,
    service: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeployRunConfig {
    param_mode: String,
    container_name: String,
    image_ref: String,
    image_source: String,
    build_context: String,
    dockerfile: String,
    image_tag: String,
    ports_text: String,
    env_text: String,
    volumes_text: String,
    restart_policy: String,
    extra_args: String,
    template_args: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeployStepResult {
    step: String,
    ok: bool,
    skipped: bool,
    commands: Vec<String>,
    output: String,
    error: Option<String>,
    elapsed_ms: u128,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UninstallResult {
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

#[derive(Clone)]
struct InstallExecutionPlan {
    command: String,
    args: Vec<String>,
    package_id: String,
}

const SYSTEM_QUICK_TIMEOUT_MS: u64 = 1_200;
const SYSTEM_PRECISE_TIMEOUT_MS: u64 = 4_000;
const TOOL_DETECT_TIMEOUT_MS: u64 = 1_000;
const AI_TOOL_DETECT_TIMEOUT_MS: u64 = 3_000;
const DOCKER_ACTION_TIMEOUT_MS: u64 = 10_000;
const DOCKER_BATCH_TIMEOUT_MS: u64 = 25_000;
const DEPLOY_GIT_TIMEOUT_MS: u64 = 90_000;
const DEPLOY_DOCKER_TIMEOUT_MS: u64 = 120_000;
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
async fn list_git_branches(project_path: String) -> CommandResponse<Vec<String>> {
    with_timing_async(async move { run_blocking(move || list_git_branches_internal(&project_path)).await }).await
}

#[tauri::command]
async fn execute_deploy_step(request: DeployStepRequest) -> CommandResponse<DeployStepResult> {
    with_timing_async(async move { run_blocking(move || execute_deploy_step_internal(&request)).await }).await
}

#[tauri::command]
async fn install_market_item(item_key: String, install_path: Option<String>) -> CommandResponse<InstallResult> {
    with_timing_async(async move {
        run_blocking(move || execute_install_item(&item_key, install_path.as_deref())).await
    })
    .await
}

#[tauri::command]
async fn uninstall_market_item(item_key: String) -> CommandResponse<UninstallResult> {
    with_timing_async(async move {
        run_blocking(move || execute_uninstall_item(&item_key)).await
    })
    .await
}

#[tauri::command]
async fn pick_install_directory() -> CommandResponse<Option<String>> {
    with_timing_async(async { run_blocking(select_install_directory).await }).await
}

#[tauri::command]
async fn pick_project_directory() -> CommandResponse<Option<String>> {
    with_timing_async(async { run_blocking(select_project_directory).await }).await
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
        // ── AI ──
        ToolSpec {
            name: "Claude Code",
            command: "claude",
            args: &["--version"],
            category: "AI",
            install_key: Some("claude-code"),
        },
        ToolSpec {
            name: "Codex CLI",
            command: "codex",
            args: &["--version"],
            category: "AI",
            install_key: Some("codex-cli"),
        },
        ToolSpec {
            name: "Gemini CLI",
            command: "gemini",
            args: &["--version"],
            category: "AI",
            install_key: Some("gemini-cli"),
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
        // ── AI ──
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

fn resolve_tool_path(command: &str) -> Option<String> {
    let args = vec![command.to_string()];
    let result = execute_process_with_timeout("where", &args, TOOL_DETECT_TIMEOUT_MS).ok()?;
    if result.exit_code != 0 {
        return None;
    }
    first_line(&result.stdout)
}

fn detect_tool(spec: &ToolSpec) -> ToolStatus {
    let args: Vec<String> = spec.args.iter().map(|arg| (*arg).to_string()).collect();
    let timeout = if spec.category == "AI" {
        AI_TOOL_DETECT_TIMEOUT_MS
    } else {
        TOOL_DETECT_TIMEOUT_MS
    };
    let result = execute_process_with_timeout(spec.command, &args, timeout);

    match result {
        Ok(output) => {
            let stdout = output.stdout;
            let stderr = output.stderr;
            let raw = if !stdout.is_empty() {
                stdout.clone()
            } else {
                stderr.clone()
            };

            let installed = output.exit_code == 0
                || (output.exit_code == process_runner::TIMEOUT_EXIT_CODE
                    && first_line(&raw).is_some());
            let details = if installed {
                None
            } else {
                // 检查是否是"命令未找到"类的错误
                let is_command_not_found = is_missing_command_detail(&stderr)
                    || stderr.contains("不是内部或外部命令")
                    || stderr.contains("系统找不到指定的文件")
                    || stderr.to_lowercase().contains("not recognized")
                    || stderr.to_lowercase().contains("command not found");

                if is_command_not_found {
                    // 将技术性错误转换为友好提示（不隐藏错误，只是优化表达）
                    Some("未检测到该命令，可能未安装或未配置到系统环境变量".to_string())
                } else if !stderr.is_empty() {
                    // 其他类型的错误，显示详情以便调试
                    Some(format!("返回码 {}，{}", output.exit_code, &stderr))
                } else {
                    // 没有错误输出但返回码非0
                    Some(format!("命令执行失败（返回码 {}）", output.exit_code))
                }
            };

            ToolStatus {
                name: spec.name.to_string(),
                command: spec.command.to_string(),
                category: spec.category.to_string(),
                installed,
                version: if installed { first_line(&raw) } else { None },
                details,
                install_key: spec.install_key.map(ToString::to_string),
                install_path: if installed { resolve_tool_path(spec.command) } else { None },
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
                install_path: Some(path),
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
                install_path: resolve_tool_path(spec.command),
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
                install_path: resolve_tool_path(spec.command),
            };
        }
    }

    // 检查是否是"命令未找到"类错误
    let is_command_not_found = is_missing_command_detail(&detect_error)
        || detect_error.contains("不是内部或外部命令")
        || detect_error.contains("系统找不到指定的文件")
        || detect_error.to_lowercase().contains("not recognized")
        || detect_error.to_lowercase().contains("command not found");

    let details = if is_command_not_found {
        // 将技术性错误转换为友好提示（不隐藏错误，只是优化表达）
        Some("未检测到该命令，可能未安装或未配置到系统环境变量".to_string())
    } else {
        // 其他类型的错误，保留原始错误信息
        Some(detect_error)
    };

    ToolStatus {
        name: spec.name.to_string(),
        command: spec.command.to_string(),
        category: spec.category.to_string(),
        installed: false,
        version: None,
        details,
        install_key: spec.install_key.map(ToString::to_string),
        install_path: None,
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

fn list_git_branches_internal(project_path: &str) -> Result<Vec<String>, String> {
    let directory = ensure_existing_dir(project_path, "Git 项目目录")?;
    let args = vec!["branch".to_string(), "--format=%(refname:short)".to_string()];
    let capture = execute_process_with_timeout_in_dir("git", &args, DEPLOY_GIT_TIMEOUT_MS, Some(&directory))?;

    if capture.exit_code != 0 {
        return Err(format!(
            "获取 Git 分支失败（{}）：{}",
            capture.exit_code,
            prefer_error_output(&capture)
        ));
    }

    let mut branches = split_non_empty_lines(&capture.stdout);
    if branches.is_empty() {
        let current_args = vec!["rev-parse".to_string(), "--abbrev-ref".to_string(), "HEAD".to_string()];
        let current = execute_process_with_timeout_in_dir("git", &current_args, DEPLOY_GIT_TIMEOUT_MS, Some(&directory))?;
        if current.exit_code == 0 {
            branches = split_non_empty_lines(&current.stdout);
        }
    }

    branches.sort();
    branches.dedup();
    Ok(branches)
}

fn execute_deploy_step_internal(request: &DeployStepRequest) -> Result<DeployStepResult, String> {
    match request.step.as_str() {
        "pull_code" => execute_pull_code_step(request),
        "stop_old" => execute_stop_old_step(request),
        "deploy_new" => execute_deploy_new_step(request),
        _ => Err(format!("未支持的部署步骤: {}", request.step)),
    }
}

fn execute_pull_code_step(request: &DeployStepRequest) -> Result<DeployStepResult, String> {
    let started_at = Instant::now();
    let mut commands: Vec<String> = Vec::new();
    let mut outputs: Vec<String> = Vec::new();

    if !request.profile.git.enabled {
        return Ok(build_deploy_step_result(
            "pull_code",
            true,
            true,
            commands,
            "已禁用代码拉取，步骤跳过。".to_string(),
            None,
            started_at,
        ));
    }

    let branch = request
        .selected_branch
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "未选择分支，无法执行代码拉取。".to_string())?;

    if !is_safe_git_ref(branch) {
        return Err("分支名称包含非法字符。".to_string());
    }

    let project_path = resolve_deploy_project_path(&request.profile)?;
    let project_dir = ensure_existing_dir(&project_path, "拉取代码目录")?;
    let remote = normalize_remote_name(&request.profile.git.remote);

    let fetch_args = vec!["fetch".to_string(), "--prune".to_string(), remote.clone()];
    let fetch = run_deploy_command("git", &fetch_args, DEPLOY_GIT_TIMEOUT_MS, Some(&project_dir), &mut commands)?;
    outputs.push(format_command_output("git", &fetch_args, &fetch));
    if fetch.exit_code != 0 {
        return Ok(build_deploy_step_result(
            "pull_code",
            false,
            false,
            commands,
            outputs.join("\n\n"),
            Some(prefer_error_output(&fetch)),
            started_at,
        ));
    }

    let checkout_args = vec!["checkout".to_string(), branch.to_string()];
    let checkout = run_deploy_command("git", &checkout_args, DEPLOY_GIT_TIMEOUT_MS, Some(&project_dir), &mut commands)?;
    outputs.push(format_command_output("git", &checkout_args, &checkout));
    if checkout.exit_code != 0 {
        return Ok(build_deploy_step_result(
            "pull_code",
            false,
            false,
            commands,
            outputs.join("\n\n"),
            Some(prefer_error_output(&checkout)),
            started_at,
        ));
    }

    let pull_args = vec![
        "pull".to_string(),
        "--ff-only".to_string(),
        remote,
        branch.to_string(),
    ];
    let pull = run_deploy_command("git", &pull_args, DEPLOY_GIT_TIMEOUT_MS, Some(&project_dir), &mut commands)?;
    outputs.push(format_command_output("git", &pull_args, &pull));

    Ok(build_deploy_step_result(
        "pull_code",
        pull.exit_code == 0,
        false,
        commands,
        outputs.join("\n\n"),
        if pull.exit_code == 0 {
            None
        } else {
            Some(prefer_error_output(&pull))
        },
        started_at,
    ))
}

fn execute_stop_old_step(request: &DeployStepRequest) -> Result<DeployStepResult, String> {
    let started_at = Instant::now();
    let mut commands: Vec<String> = Vec::new();

    if request.profile.mode == "compose" {
        let project_path = resolve_deploy_project_path(&request.profile)?;
        let project_dir = ensure_existing_dir(&project_path, "Compose 项目目录")?;
        let args = build_compose_stop_args(&request.profile);
        let capture = run_deploy_command("docker", &args, DEPLOY_DOCKER_TIMEOUT_MS, Some(&project_dir), &mut commands)?;

        return Ok(build_deploy_step_result(
            "stop_old",
            capture.exit_code == 0,
            false,
            commands,
            format_command_output("docker", &args, &capture),
            if capture.exit_code == 0 {
                None
            } else {
                Some(prefer_error_output(&capture))
            },
            started_at,
        ));
    }

    let container_name = request.profile.run.container_name.trim();
    if !is_safe_identifier(container_name) {
        return Err("Run 模式容器名称不合法。".to_string());
    }

    let args = vec!["rm".to_string(), "-f".to_string(), container_name.to_string()];
    let capture = run_deploy_command("docker", &args, DEPLOY_DOCKER_TIMEOUT_MS, None, &mut commands)?;
    let combined = prefer_error_output(&capture).to_lowercase();
    let missing_container = combined.contains("no such container") || combined.contains("not found") || combined.contains("找不到");

    if capture.exit_code != 0 && missing_container {
        return Ok(build_deploy_step_result(
            "stop_old",
            true,
            true,
            commands,
            format_command_output("docker", &args, &capture),
            None,
            started_at,
        ));
    }

    Ok(build_deploy_step_result(
        "stop_old",
        capture.exit_code == 0,
        false,
        commands,
        format_command_output("docker", &args, &capture),
        if capture.exit_code == 0 {
            None
        } else {
            Some(prefer_error_output(&capture))
        },
        started_at,
    ))
}

fn execute_deploy_new_step(request: &DeployStepRequest) -> Result<DeployStepResult, String> {
    let started_at = Instant::now();
    let mut commands: Vec<String> = Vec::new();
    let mut outputs: Vec<String> = Vec::new();

    if request.profile.mode == "compose" {
        let project_path = resolve_deploy_project_path(&request.profile)?;
        let project_dir = ensure_existing_dir(&project_path, "Compose 项目目录")?;
        let args = build_compose_up_args(&request.profile);
        let capture = run_deploy_command("docker", &args, DEPLOY_DOCKER_TIMEOUT_MS, Some(&project_dir), &mut commands)?;
        outputs.push(format_command_output("docker", &args, &capture));

        return Ok(build_deploy_step_result(
            "deploy_new",
            capture.exit_code == 0,
            false,
            commands,
            outputs.join("\n\n"),
            if capture.exit_code == 0 {
                None
            } else {
                Some(prefer_error_output(&capture))
            },
            started_at,
        ));
    }

    let image_ref = resolve_run_image_ref(&request.profile)?;

    if request.profile.run.image_source == "pull" {
        let pull_args = build_run_image_pull_args(&image_ref)?;
        let pull_capture = run_deploy_command("docker", &pull_args, DEPLOY_DOCKER_TIMEOUT_MS, None, &mut commands)?;
        outputs.push(format_command_output("docker", &pull_args, &pull_capture));
        if pull_capture.exit_code != 0 {
            return Ok(build_deploy_step_result(
                "deploy_new",
                false,
                false,
                commands,
                outputs.join("\n\n"),
                Some(prefer_error_output(&pull_capture)),
                started_at,
            ));
        }
    }

    if request.profile.run.image_source == "build" {
        let build_dir = ensure_existing_dir(request.profile.run.build_context.trim(), "构建目录")?;
        let build_args = build_run_image_build_args(&request.profile, &image_ref)?;
        let build_capture = run_deploy_command("docker", &build_args, DEPLOY_DOCKER_TIMEOUT_MS, Some(&build_dir), &mut commands)?;
        outputs.push(format_command_output("docker", &build_args, &build_capture));
        if build_capture.exit_code != 0 {
            return Ok(build_deploy_step_result(
                "deploy_new",
                false,
                false,
                commands,
                outputs.join("\n\n"),
                Some(prefer_error_output(&build_capture)),
                started_at,
            ));
        }
    }

    let run_args = build_run_deploy_args(&request.profile, &image_ref)?;
    let run_capture = run_deploy_command("docker", &run_args, DEPLOY_DOCKER_TIMEOUT_MS, None, &mut commands)?;
    outputs.push(format_command_output("docker", &run_args, &run_capture));

    Ok(build_deploy_step_result(
        "deploy_new",
        run_capture.exit_code == 0,
        false,
        commands,
        outputs.join("\n\n"),
        if run_capture.exit_code == 0 {
            None
        } else {
            Some(prefer_error_output(&run_capture))
        },
        started_at,
    ))
}

fn build_run_image_pull_args(image_ref: &str) -> Result<Vec<String>, String> {
    if !is_safe_docker_image_ref(image_ref) {
        return Err("镜像引用包含非法字符。".to_string());
    }

    Ok(vec!["pull".to_string(), image_ref.to_string()])
}

fn build_run_deploy_args(profile: &DeployProfile, image_ref: &str) -> Result<Vec<String>, String> {
    if profile.run.param_mode == "template" {
        return build_run_template_args(profile, image_ref);
    }

    build_run_form_args(profile, image_ref)
}

fn build_run_form_args(profile: &DeployProfile, image_ref: &str) -> Result<Vec<String>, String> {
    let container_name = profile.run.container_name.trim();
    if !is_safe_identifier(container_name) {
        return Err("容器名称不合法，仅允许字母、数字、点、下划线、中划线。".to_string());
    }

    let mut args = vec![
        "run".to_string(),
        "-d".to_string(),
        "--name".to_string(),
        container_name.to_string(),
    ];

    if !profile.run.restart_policy.trim().is_empty() {
        args.push("--restart".to_string());
        args.push(profile.run.restart_policy.trim().to_string());
    }

    for line in split_non_empty_lines(&profile.run.ports_text) {
        args.push("-p".to_string());
        args.push(line);
    }

    for line in split_non_empty_lines(&profile.run.env_text) {
        args.push("-e".to_string());
        args.push(line);
    }

    for line in split_non_empty_lines(&profile.run.volumes_text) {
        args.push("-v".to_string());
        args.push(line);
    }

    if !profile.run.extra_args.trim().is_empty() {
        args.extend(
            profile
                .run
                .extra_args
                .split_whitespace()
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty()),
        );
    }

    args.push(image_ref.to_string());
    Ok(args)
}

fn build_run_template_args(profile: &DeployProfile, image_ref: &str) -> Result<Vec<String>, String> {
    let container_name = profile.run.container_name.trim();
    if !is_safe_identifier(container_name) {
        return Err("容器名称不合法，仅允许字母、数字、点、下划线、中划线。".to_string());
    }

    let template = profile
        .run
        .template_args
        .replace("{{IMAGE}}", image_ref)
        .replace("{{CONTAINER}}", container_name);
    let mut tokens: Vec<String> = template
        .split_whitespace()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();

    if tokens.is_empty() {
        return Err("高级模板参数不能为空。".to_string());
    }

    if tokens[0] != "run" {
        tokens.insert(0, "run".to_string());
    }

    Ok(tokens)
}

fn build_run_image_build_args(profile: &DeployProfile, image_ref: &str) -> Result<Vec<String>, String> {
    if !is_safe_docker_image_ref(image_ref) {
        return Err("镜像 Tag 不合法。".to_string());
    }

    let mut args = vec!["build".to_string(), "-t".to_string(), image_ref.to_string()];
    if !profile.run.dockerfile.trim().is_empty() {
        args.push("-f".to_string());
        args.push(profile.run.dockerfile.trim().to_string());
    }
    args.push(".".to_string());
    Ok(args)
}

fn resolve_run_image_ref(profile: &DeployProfile) -> Result<String, String> {
    if profile.run.image_source == "build" {
        let tag = profile.run.image_tag.trim();
        if tag.is_empty() {
            return Err("构建模式缺少镜像 Tag。".to_string());
        }
        if !is_safe_docker_image_ref(tag) {
            return Err("构建模式镜像 Tag 包含非法字符。".to_string());
        }
        return Ok(tag.to_string());
    }

    let image_ref = profile.run.image_ref.trim();
    if image_ref.is_empty() {
        return Err("拉取模式缺少镜像引用。".to_string());
    }
    if !is_safe_docker_image_ref(image_ref) {
        return Err("镜像引用包含非法字符。".to_string());
    }
    Ok(image_ref.to_string())
}

fn build_compose_stop_args(profile: &DeployProfile) -> Vec<String> {
    let mut args = vec!["compose".to_string()];
    if !profile.compose.compose_file.trim().is_empty() {
        args.push("-f".to_string());
        args.push(profile.compose.compose_file.trim().to_string());
    }
    args.push("stop".to_string());
    if !profile.compose.service.trim().is_empty() {
        args.push(profile.compose.service.trim().to_string());
    }
    args
}

fn build_compose_up_args(profile: &DeployProfile) -> Vec<String> {
    let mut args = vec!["compose".to_string()];
    if !profile.compose.compose_file.trim().is_empty() {
        args.push("-f".to_string());
        args.push(profile.compose.compose_file.trim().to_string());
    }
    args.extend([
        "up".to_string(),
        "-d".to_string(),
        "--build".to_string(),
        "--force-recreate".to_string(),
    ]);
    if !profile.compose.service.trim().is_empty() {
        args.push(profile.compose.service.trim().to_string());
    }
    args
}

fn run_deploy_command(
    command: &str,
    args: &[String],
    timeout_ms: u64,
    current_dir: Option<&Path>,
    command_records: &mut Vec<String>,
) -> Result<process_runner::ProcessCapture, String> {
    command_records.push(format!("{} {}", command, args.join(" ")));
    execute_process_with_timeout_in_dir(command, args, timeout_ms, current_dir)
}

fn build_deploy_step_result(
    step: &str,
    ok: bool,
    skipped: bool,
    commands: Vec<String>,
    output: String,
    error: Option<String>,
    started_at: Instant,
) -> DeployStepResult {
    DeployStepResult {
        step: step.to_string(),
        ok,
        skipped,
        commands,
        output,
        error,
        elapsed_ms: started_at.elapsed().as_millis(),
    }
}

fn resolve_deploy_project_path(profile: &DeployProfile) -> Result<String, String> {
    let value = if profile.mode == "compose" {
        profile.compose.project_path.trim()
    } else {
        profile.run.build_context.trim()
    };

    if value.is_empty() {
        return Err("缺少项目目录配置。".to_string());
    }

    Ok(value.to_string())
}

fn ensure_existing_dir(raw: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if !path.exists() {
        return Err(format!("{}不存在: {}", label, raw));
    }
    if !path.is_dir() {
        return Err(format!("{}不是目录: {}", label, raw));
    }
    Ok(path)
}

fn is_safe_docker_image_ref(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '/' | ':' | '@'))
}

fn is_safe_git_ref(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '/' | '.'))
}

fn normalize_remote_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "origin".to_string()
    } else {
        trimmed.to_string()
    }
}

fn split_non_empty_lines(raw: &str) -> Vec<String> {
    raw.split('\n')
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

fn format_command_output(command: &str, args: &[String], capture: &process_runner::ProcessCapture) -> String {
    let mut chunks = vec![format!(
        "$ {} {}\nexit={}",
        command,
        args.join(" "),
        capture.exit_code
    )];

    if !capture.stdout.trim().is_empty() {
        chunks.push(capture.stdout.trim().to_string());
    }
    if !capture.stderr.trim().is_empty() {
        chunks.push(format!("[stderr]\n{}", capture.stderr.trim()));
    }

    chunks.join("\n\n")
}

fn prefer_error_output(capture: &process_runner::ProcessCapture) -> String {
    if !capture.stderr.trim().is_empty() {
        return capture.stderr.trim().to_string();
    }

    if !capture.stdout.trim().is_empty() {
        return capture.stdout.trim().to_string();
    }

    "无输出".to_string()
}

fn execute_install_item(item_key: &str, install_path: Option<&str>) -> Result<InstallResult, String> {
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

fn resolve_install_plan(
    item_key: &str,
    package_id: &str,
    install_path: Option<&str>,
) -> Result<InstallExecutionPlan, String> {
    let node_package = node_package_name(item_key);
    if let Some(npm_package) = node_package {
        return Ok(build_npm_global_install_plan(npm_package));
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

fn node_package_name(item_key: &str) -> Option<&'static str> {
    match item_key {
        "pnpm" => Some("pnpm"),
        "yarn" => Some("yarn"),
        "claude-code" => Some("@anthropic-ai/claude-code"),
        "codex-cli" => Some("@openai/codex"),
        "gemini-cli" => Some("@google/gemini-cli"),
        _ => None,
    }
}

fn build_npm_global_install_plan(npm_package: &str) -> InstallExecutionPlan {
    InstallExecutionPlan {
        command: "npm".to_string(),
        args: vec!["install".to_string(), "-g".to_string(), npm_package.to_string()],
        package_id: format!("npm:{}", npm_package),
    }
}

fn execute_uninstall_item(item_key: &str) -> Result<UninstallResult, String> {
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

fn resolve_uninstall_plan(
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

fn select_install_directory() -> Result<Option<String>, String> {
    select_directory_with_prompt("选择安装目录")
}

fn select_project_directory() -> Result<Option<String>, String> {
    select_directory_with_prompt("选择项目目录")
}

fn select_directory_with_prompt(prompt: &str) -> Result<Option<String>, String> {
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
        "run" | "start" | "stop" | "restart" | "logs" | "rm" | "rmi" => {
            let target = target.ok_or_else(|| format!("动作 {} 需要提供容器名称或 ID", action))?;
            if !is_safe_identifier(target) {
                return Err("容器标识不合法，仅允许字母、数字、点、下划线、中划线".to_string());
            }

            match action {
                "run" => {
                    let run_name = format!("dep-run-{}", current_timestamp_ms());
                    Ok(vec![
                        "run".to_string(),
                        "-d".to_string(),
                        "--name".to_string(),
                        run_name,
                        target.to_string(),
                    ])
                }
                "start" => Ok(vec!["start".to_string(), target.to_string()]),
                "stop" => Ok(vec!["stop".to_string(), target.to_string()]),
                "restart" => Ok(vec!["restart".to_string(), target.to_string()]),
                "rm" => Ok(vec!["rm".to_string(), target.to_string()]),
                "rmi" => Ok(vec!["rmi".to_string(), target.to_string()]),
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

fn is_missing_command_detail(detail: &str) -> bool {
    let lowered = detail.to_lowercase();
    detail.contains("不是内部或外部命令")
        || detail.contains("系统找不到指定的文件")
        || lowered.contains("not recognized as an internal or external command")
        || lowered.contains("is not recognized")
        || lowered.contains("command not found")
        || lowered.contains("no such file or directory")
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
            list_git_branches,
            execute_deploy_step,
            install_market_item,
            uninstall_market_item,
            pick_install_directory,
            pick_project_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_deploy_profile() -> DeployProfile {
        DeployProfile {
            id: "p1".to_string(),
            name: "test".to_string(),
            mode: "run".to_string(),
            git: DeployGitConfig {
                enabled: true,
                remote: "origin".to_string(),
            },
            compose: DeployComposeConfig {
                project_path: "D:/workspace/demo".to_string(),
                compose_file: "docker-compose.yml".to_string(),
                service: "web".to_string(),
            },
            run: DeployRunConfig {
                param_mode: "form".to_string(),
                container_name: "demo-app".to_string(),
                image_ref: "nginx:latest".to_string(),
                image_source: "pull".to_string(),
                build_context: "D:/workspace/demo".to_string(),
                dockerfile: "Dockerfile".to_string(),
                image_tag: "demo:latest".to_string(),
                ports_text: "8080:8080\n9090:9090".to_string(),
                env_text: "NODE_ENV=production".to_string(),
                volumes_text: "./data:/app/data:rw".to_string(),
                restart_policy: "unless-stopped".to_string(),
                extra_args: "--network bridge".to_string(),
                template_args: "-d --name {{CONTAINER}} {{IMAGE}}".to_string(),
            },
            created_at: 0,
            updated_at: 0,
        }
    }

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
        let run = build_docker_args("run", Some("sha256abc123")).expect("run args should build");
        let logs = build_docker_args("logs", Some("redis-dev")).expect("logs args should build");
        let rm = build_docker_args("rm", Some("redis-dev")).expect("rm args should build");
        let rmi = build_docker_args("rmi", Some("sha256abc123")).expect("rmi args should build");

        assert_eq!(run[0], "run");
        assert_eq!(run[1], "-d");
        assert_eq!(run[2], "--name");
        assert_eq!(logs[0], "logs");
        assert_eq!(rm[0], "rm");
        assert_eq!(rmi[0], "rmi");

        assert!(build_docker_args("logs", Some("redis dev")).is_err());
        assert!(build_docker_args("rmi", Some("nginx:latest")).is_err());
        assert!(build_docker_args("start", None).is_err());
    }

    #[test]
    fn deploy_args_builder_should_support_compose_and_run() {
        let mut profile = sample_deploy_profile();
        profile.mode = "compose".to_string();

        let compose_stop = build_compose_stop_args(&profile);
        let compose_up = build_compose_up_args(&profile);
        assert_eq!(compose_stop[0], "compose");
        assert!(compose_stop.contains(&"stop".to_string()));
        assert!(compose_up.contains(&"up".to_string()));

        profile.mode = "run".to_string();
        let run_form_args = build_run_form_args(&profile, "nginx:latest").expect("run form args should build");
        assert_eq!(run_form_args[0], "run");
        assert!(run_form_args.contains(&"-p".to_string()));
        assert!(run_form_args.contains(&"-e".to_string()));
        assert!(run_form_args.contains(&"-v".to_string()));

        let pull_args = build_run_image_pull_args("looplj/axonhub:latest").expect("run pull args should build");
        assert_eq!(pull_args[0], "pull");
        assert_eq!(pull_args[1], "looplj/axonhub:latest");
        assert!(build_run_image_pull_args("looplj/axonhub latest").is_err());
    }

    #[test]
    fn deploy_template_args_should_replace_placeholders() {
        let mut profile = sample_deploy_profile();
        profile.run.param_mode = "template".to_string();
        profile.run.template_args = "-d --name {{CONTAINER}} -p 8080:8080 {{IMAGE}}".to_string();

        let args = build_run_template_args(&profile, "looplj/axonhub:latest").expect("template args should build");
        assert_eq!(args[0], "run");
        assert!(args.iter().any(|item| item == "demo-app"));
        assert!(args.iter().any(|item| item == "looplj/axonhub:latest"));
    }

    #[test]
    fn git_ref_validation_should_reject_invalid_values() {
        assert!(is_safe_git_ref("main"));
        assert!(is_safe_git_ref("feature/docker-flow"));
        assert!(!is_safe_git_ref(""));
        assert!(!is_safe_git_ref("main && rm"));
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
