use crate::contracts::DeployStepRequest;
use crate::contracts::DeployStepResult;
use std::time::Instant;

use super::args::*;
use super::utils::*;
use super::{DEPLOY_GIT_TIMEOUT_MS, DEPLOY_DOCKER_TIMEOUT_MS};

pub fn execute_deploy_step_internal(request: &DeployStepRequest) -> Result<DeployStepResult, String> {
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
