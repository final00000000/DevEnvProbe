use crate::contracts::ToolStatus;
use crate::process_runner::{self, execute_process_with_timeout, run_command_with_timeout};
use std::path::Path;

use super::specs::ToolSpec;
use super::{TOOL_DETECT_TIMEOUT_MS, AI_TOOL_DETECT_TIMEOUT_MS};

pub fn detect_tool(spec: &ToolSpec) -> ToolStatus {
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
                let is_command_not_found = is_missing_command_detail(&stderr)
                    || stderr.contains("不是内部或外部命令")
                    || stderr.contains("系统找不到指定的文件")
                    || stderr.to_lowercase().contains("not recognized")
                    || stderr.to_lowercase().contains("command not found");

                if is_command_not_found {
                    Some("未检测到该命令，可能未安装或未配置到系统环境变量".to_string())
                } else if !stderr.is_empty() {
                    Some(format!("返回码 {}，{}", output.exit_code, &stderr))
                } else {
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

pub fn resolve_tool_path(command: &str) -> Option<String> {
    let args = vec![command.to_string()];
    let result = execute_process_with_timeout("where", &args, TOOL_DETECT_TIMEOUT_MS).ok()?;
    if result.exit_code != 0 {
        return None;
    }
    first_line(&result.stdout)
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

    let is_command_not_found = is_missing_command_detail(&detect_error)
        || detect_error.contains("不是内部或外部命令")
        || detect_error.contains("系统找不到指定的文件")
        || detect_error.to_lowercase().contains("not recognized")
        || detect_error.to_lowercase().contains("command not found");

    let details = if is_command_not_found {
        Some("未检测到该命令，可能未安装或未配置到系统环境变量".to_string())
    } else {
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
            if value.is_empty() { None } else { Some(value) }
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
    let raw = if output.stdout.is_empty() { output.stderr } else { output.stdout };
    first_line(&raw)
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
