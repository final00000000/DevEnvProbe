use std::process::Command;
use std::time::Instant;

use crate::contracts::{
    UpdateStepLog, UpdateWorkflowConfig, UpdateTimeoutConfig,
    UpdateImageAndRestartRequest, UpdateImageAndRestartResponse, RollbackResult,
};
use crate::version::errors::{VersionError, VersionResult};
use crate::version::rollback::RollbackManager;
use crate::version::health_check::HealthChecker;

pub fn update_image_and_restart(request: UpdateImageAndRestartRequest) -> VersionResult<UpdateImageAndRestartResponse> {
    let operation_id = request.operation_id.unwrap_or_else(|| format!("op-{}", chrono::Utc::now().timestamp()));
    let image_key = format!("{}:{}", request.image.repository, request.image.tag);

    let orchestrator = UpdateOrchestrator::new(request.workflow.clone(), request.timeouts, operation_id.clone());

    match orchestrator.execute() {
        Ok((logs, rollback)) => {
            let success = logs.iter().all(|log| log.ok || log.skipped);

            Ok(UpdateImageAndRestartResponse {
                operation_id,
                image_key,
                success,
                final_image_ref: if success { Some(request.workflow.new_image_tag.clone()) } else { None },
                step_logs: logs,
                rollback,
            })
        }
        Err(e) => Err(e),
    }
}

pub struct UpdateOrchestrator {
    workflow: UpdateWorkflowConfig,
    timeouts: UpdateTimeoutConfig,
    operation_id: String,
}

impl UpdateOrchestrator {
    pub fn new(workflow: UpdateWorkflowConfig, timeouts: UpdateTimeoutConfig, operation_id: String) -> Self {
        Self { workflow, timeouts, operation_id }
    }

    pub fn execute(&self) -> VersionResult<(Vec<UpdateStepLog>, RollbackResult)> {
        let mut logs = Vec::new();
        let container_name = self.extract_container_name();
        let rollback_mgr = RollbackManager::new(container_name.clone(), &self.operation_id);

        // Step 1: git pull
        match self.git_pull() {
            Ok(log) => {
                logs.push(log.clone());
                if !log.ok { return Ok((logs, RollbackResult::default())); }
            }
            Err(e) => return Err(e),
        }

        // Step 2: docker build
        match self.docker_build() {
            Ok(log) => {
                logs.push(log.clone());
                if !log.ok { return Ok((logs, RollbackResult::default())); }
            }
            Err(e) => return Err(e),
        }

        // Step 3: backup container
        match rollback_mgr.backup_container() {
            Ok(log) => {
                logs.push(log.clone());
                if !log.ok && !log.skipped { return Ok((logs, RollbackResult::default())); }
            }
            Err(e) => return Err(e),
        }

        // Step 4: docker run
        match self.docker_run() {
            Ok(log) => {
                logs.push(log.clone());
                if !log.ok {
                    let rollback = rollback_mgr.rollback();
                    return Ok((logs, rollback));
                }
            }
            Err(_e) => {
                let rollback = rollback_mgr.rollback();
                return Ok((logs, rollback));
            }
        }

        // Step 5: health check
        let health_checker = HealthChecker::new(container_name, self.timeouts.health_check_ms / 1000);
        match health_checker.wait_until_healthy() {
            Ok(_) => {
                logs.push(UpdateStepLog {
                    step: "health_check".to_string(),
                    command: Some(format!("docker inspect {}", self.extract_container_name())),
                    ok: true,
                    skipped: false,
                    output: "Container is healthy".to_string(),
                    error: None,
                    elapsed_ms: 0,
                });
            }
            Err(_) => {
                logs.push(UpdateStepLog {
                    step: "health_check".to_string(),
                    command: Some(format!("docker inspect {}", self.extract_container_name())),
                    ok: false,
                    skipped: false,
                    output: String::new(),
                    error: Some(format!("Health check failed after {} seconds", self.timeouts.health_check_ms / 1000)),
                    elapsed_ms: self.timeouts.health_check_ms as u128,
                });
                let rollback = rollback_mgr.rollback();
                return Ok((logs, rollback));
            }
        }

        // Success: cleanup backup
        let _ = rollback_mgr.cleanup_backup();

        Ok((logs, RollbackResult::default()))
    }

    fn git_pull(&self) -> VersionResult<UpdateStepLog> {
        let start = Instant::now();

        let output = Command::new("git")
            .arg("-C")
            .arg(&self.workflow.git_pull_path)
            .arg("pull")
            .arg("--ff-only")
            .arg("origin")
            .arg(&self.workflow.git_branch)
            .output()
            .map_err(|e| VersionError::StepFailed {
                step: "git_pull".to_string(),
                message: format!("Failed to execute git pull: {}", e),
            })?;

        let elapsed = start.elapsed().as_millis();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let combined_output = format!("{}\n{}", stdout, stderr);

        if !output.status.success() {
            return Ok(UpdateStepLog {
                step: "git_pull".to_string(),
                command: Some(format!("git -C {} pull --ff-only origin {}", self.workflow.git_pull_path, self.workflow.git_branch)),
                ok: false,
                skipped: false,
                output: combined_output.clone(),
                error: Some(combined_output),
                elapsed_ms: elapsed,
            });
        }

        Ok(UpdateStepLog {
            step: "git_pull".to_string(),
            command: Some(format!("git -C {} pull --ff-only origin {}", self.workflow.git_pull_path, self.workflow.git_branch)),
            ok: true,
            skipped: false,
            output: combined_output,
            error: None,
            elapsed_ms: elapsed,
        })
    }

    fn docker_build(&self) -> VersionResult<UpdateStepLog> {
        let start = Instant::now();

        let output = Command::new("docker")
            .arg("build")
            .arg("-t")
            .arg(&self.workflow.new_image_tag)
            .arg("-f")
            .arg(&self.workflow.dockerfile)
            .arg(&self.workflow.build_context)
            .output()
            .map_err(|e| VersionError::StepFailed {
                step: "docker_build".to_string(),
                message: format!("Failed to execute docker build: {}", e),
            })?;

        let elapsed = start.elapsed().as_millis();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let combined_output = format!("{}\n{}", stdout, stderr);

        if !output.status.success() {
            return Ok(UpdateStepLog {
                step: "docker_build".to_string(),
                command: Some(format!("docker build -t {} -f {} {}", self.workflow.new_image_tag, self.workflow.dockerfile, self.workflow.build_context)),
                ok: false,
                skipped: false,
                output: combined_output.clone(),
                error: Some(combined_output),
                elapsed_ms: elapsed,
            });
        }

        Ok(UpdateStepLog {
            step: "docker_build".to_string(),
            command: Some(format!("docker build -t {} -f {} {}", self.workflow.new_image_tag, self.workflow.dockerfile, self.workflow.build_context)),
            ok: true,
            skipped: false,
            output: combined_output,
            error: None,
            elapsed_ms: elapsed,
        })
    }

    fn docker_run(&self) -> VersionResult<UpdateStepLog> {
        let start = Instant::now();

        let mut cmd = Command::new("docker");
        cmd.arg("run");

        for arg in &self.workflow.run_args {
            cmd.arg(arg);
        }

        cmd.arg(&self.workflow.new_image_tag);

        let output = cmd.output()
            .map_err(|e| VersionError::StepFailed {
                step: "docker_run".to_string(),
                message: format!("Failed to execute docker run: {}", e),
            })?;

        let elapsed = start.elapsed().as_millis();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let combined_output = format!("{}\n{}", stdout, stderr);

        if !output.status.success() {
            return Ok(UpdateStepLog {
                step: "docker_run".to_string(),
                command: Some(format!("docker run {} {}", self.workflow.run_args.join(" "), self.workflow.new_image_tag)),
                ok: false,
                skipped: false,
                output: combined_output.clone(),
                error: Some(combined_output),
                elapsed_ms: elapsed,
            });
        }

        Ok(UpdateStepLog {
            step: "docker_run".to_string(),
            command: Some(format!("docker run {} {}", self.workflow.run_args.join(" "), self.workflow.new_image_tag)),
            ok: true,
            skipped: false,
            output: combined_output,
            error: None,
            elapsed_ms: elapsed,
        })
    }

    fn extract_container_name(&self) -> String {
        for (i, arg) in self.workflow.run_args.iter().enumerate() {
            if arg == "--name" && i + 1 < self.workflow.run_args.len() {
                return self.workflow.run_args[i + 1].clone();
            }
        }
        String::new()
    }
}
