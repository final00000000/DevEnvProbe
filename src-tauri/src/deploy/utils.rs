use crate::process_runner::ProcessCapture;
use std::path::{Path, PathBuf};
use std::time::Instant;
use crate::contracts::DeployStepResult;

pub fn is_safe_git_ref(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '/' | '.'))
}

pub fn is_safe_docker_image_ref(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '/' | ':' | '@'))
}

pub fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}

pub fn ensure_existing_dir(raw: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if !path.exists() {
        return Err(format!("{}不存在: {}", label, raw));
    }
    if !path.is_dir() {
        return Err(format!("{}不是目录: {}", label, raw));
    }
    Ok(path)
}

pub fn normalize_remote_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "origin".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn split_non_empty_lines(raw: &str) -> Vec<String> {
    raw.split('\n')
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

pub fn format_command_output(command: &str, args: &[String], capture: &ProcessCapture) -> String {
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

pub fn prefer_error_output(capture: &ProcessCapture) -> String {
    if !capture.stderr.trim().is_empty() {
        return capture.stderr.trim().to_string();
    }

    if !capture.stdout.trim().is_empty() {
        return capture.stdout.trim().to_string();
    }

    "无输出".to_string()
}

pub fn run_deploy_command(
    command: &str,
    args: &[String],
    timeout_ms: u64,
    current_dir: Option<&Path>,
    command_records: &mut Vec<String>,
) -> Result<ProcessCapture, String> {
    command_records.push(format!("{} {}", command, args.join(" ")));
    crate::process_runner::execute_process_with_timeout_in_dir(command, args, timeout_ms, current_dir)
}

pub fn build_deploy_step_result(
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

pub fn resolve_deploy_project_path(profile: &crate::contracts::DeployProfile) -> Result<String, String> {
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
