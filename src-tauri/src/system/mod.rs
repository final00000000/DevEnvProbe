use crate::contracts::{SystemSnapshot, SystemRealtimeSnapshot};
use crate::process_runner::run_command_with_timeout;
use crate::runtime::current_timestamp_ms;

pub const SYSTEM_QUICK_TIMEOUT_MS: u64 = 1_200;
pub const SYSTEM_PRECISE_TIMEOUT_MS: u64 = 4_000;

pub fn build_placeholder_snapshot() -> SystemSnapshot {
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

pub fn build_placeholder_realtime() -> SystemRealtimeSnapshot {
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

pub fn query_system_snapshot_precise() -> Result<SystemSnapshot, String> {
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

pub fn query_system_snapshot_quick() -> Result<SystemSnapshot, String> {
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

pub fn query_system_realtime_quick() -> Result<SystemRealtimeSnapshot, String> {
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
