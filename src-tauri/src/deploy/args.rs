use crate::contracts::DeployProfile;
use super::utils::{is_safe_identifier, is_safe_docker_image_ref, split_non_empty_lines};

pub fn build_run_image_pull_args(image_ref: &str) -> Result<Vec<String>, String> {
    if !is_safe_docker_image_ref(image_ref) {
        return Err("镜像引用包含非法字符。".to_string());
    }

    Ok(vec!["pull".to_string(), image_ref.to_string()])
}

pub fn build_run_deploy_args(profile: &DeployProfile, image_ref: &str) -> Result<Vec<String>, String> {
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

pub fn build_run_image_build_args(profile: &DeployProfile, image_ref: &str) -> Result<Vec<String>, String> {
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

pub fn resolve_run_image_ref(profile: &DeployProfile) -> Result<String, String> {
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

pub fn build_compose_stop_args(profile: &DeployProfile) -> Vec<String> {
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

pub fn build_compose_up_args(profile: &DeployProfile) -> Vec<String> {
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
