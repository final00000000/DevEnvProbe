use std::time::Instant;
use crate::contracts::DockerCommandResult;
use crate::process_runner::execute_process_with_timeout;
use crate::runtime::current_timestamp_ms;

pub const DOCKER_ACTION_TIMEOUT_MS: u64 = 10_000;
pub const DOCKER_BATCH_TIMEOUT_MS: u64 = 25_000;

pub fn build_docker_args(action: &str, target: Option<&str>) -> Result<Vec<String>, String> {
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
                return Err("容器标识不合法,仅允许字母、数字、点、下划线、中划线".to_string());
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

pub fn execute_docker_action(
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

pub fn execute_docker_overview_batch(mode: &str) -> Result<Vec<DockerCommandResult>, String> {
    let actions: Vec<&str> = match mode {
        "full" => vec!["version", "info", "ps", "images", "stats", "compose_ls", "system_df"],
        _ => vec!["version", "ps", "images", "stats", "compose_ls"],
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
                stderr: format!("批量刷新超时({}ms)", DOCKER_BATCH_TIMEOUT_MS),
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

fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}
