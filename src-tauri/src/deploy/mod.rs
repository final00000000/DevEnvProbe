mod args;
mod steps;
mod utils;

pub const DEPLOY_GIT_TIMEOUT_MS: u64 = 90_000;
pub const DEPLOY_DOCKER_TIMEOUT_MS: u64 = 120_000;

pub use steps::execute_deploy_step_internal;
pub use utils::{ensure_existing_dir, split_non_empty_lines};

use crate::process_runner::execute_process_with_timeout_in_dir;
use utils::*;

pub fn list_git_branches_internal(project_path: &str) -> Result<Vec<String>, String> {
    let directory = ensure_existing_dir(project_path, "Git 项目目录")?;
    let args = vec!["branch".to_string(), "--format=%(refname:short)".to_string()];
    let capture = execute_process_with_timeout_in_dir("git", &args, DEPLOY_GIT_TIMEOUT_MS, Some(&directory))?;

    if capture.exit_code != 0 {
        return Err(format!(
            "获取 Git 分支失败({})：{}",
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
