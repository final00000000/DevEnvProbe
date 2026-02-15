use std::process::Command;
use std::time::Instant;

use crate::contracts::{RollbackResult, UpdateStepLog};
use crate::version::errors::{VersionError, VersionResult};

pub struct RollbackManager {
    container_name: String,
    backup_container_name: String,
}

impl RollbackManager {
    pub fn new(container_name: String, operation_id: &str) -> Self {
        let backup_container_name = format!("{}-backup-{}", container_name, operation_id);
        Self {
            container_name,
            backup_container_name,
        }
    }

    /// Backup existing container by renaming it
    pub fn backup_container(&self) -> VersionResult<UpdateStepLog> {
        let start = Instant::now();

        // Check if container exists
        let check_output = Command::new("docker")
            .arg("inspect")
            .arg(&self.container_name)
            .output();

        match check_output {
            Ok(out) if !out.status.success() => {
                // Container doesn't exist, skip backup
                return Ok(UpdateStepLog {
                    step: "backup_container".to_string(),
                    command: Some(format!("docker inspect {}", self.container_name)),
                    ok: true,
                    skipped: true,
                    output: "Container does not exist, skipping backup".to_string(),
                    error: None,
                    elapsed_ms: start.elapsed().as_millis(),
                });
            }
            Err(e) => {
                return Ok(UpdateStepLog {
                    step: "backup_container".to_string(),
                    command: Some(format!("docker inspect {}", self.container_name)),
                    ok: false,
                    skipped: false,
                    output: String::new(),
                    error: Some(format!("Failed to check container: {}", e)),
                    elapsed_ms: start.elapsed().as_millis(),
                });
            }
            _ => {}
        }

        // Rename container to backup name
        let output = Command::new("docker")
            .arg("rename")
            .arg(&self.container_name)
            .arg(&self.backup_container_name)
            .output()
            .map_err(|e| VersionError::StepFailed {
                step: "backup_container".to_string(),
                message: format!("Failed to backup container: {}", e),
            })?;

        let elapsed = start.elapsed().as_millis();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let combined_output = format!("{}\n{}", stdout, stderr);

        if !output.status.success() {
            return Ok(UpdateStepLog {
                step: "backup_container".to_string(),
                command: Some(format!("docker rename {} {}", self.container_name, self.backup_container_name)),
                ok: false,
                skipped: false,
                output: combined_output.clone(),
                error: Some(combined_output),
                elapsed_ms: elapsed,
            });
        }

        Ok(UpdateStepLog {
            step: "backup_container".to_string(),
            command: Some(format!("docker rename {} {}", self.container_name, self.backup_container_name)),
            ok: true,
            skipped: false,
            output: combined_output,
            error: None,
            elapsed_ms: elapsed,
        })
    }

    /// Rollback: remove failed new container and restore backup
    pub fn rollback(&self) -> RollbackResult {
        let mut logs = Vec::new();

        // Step 1: Remove failed new container (if exists)
        let remove_result = Command::new("docker")
            .arg("rm")
            .arg("-f")
            .arg(&self.container_name)
            .output();

        if let Ok(out) = remove_result {
            let output = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            logs.push(format!("Remove failed container: {}", output));
        }

        // Step 2: Restore backup container name
        let restore_result = Command::new("docker")
            .arg("rename")
            .arg(&self.backup_container_name)
            .arg(&self.container_name)
            .output();

        match restore_result {
            Ok(out) if out.status.success() => {
                // Step 3: Start restored container
                let start_result = Command::new("docker")
                    .arg("start")
                    .arg(&self.container_name)
                    .output();

                match start_result {
                    Ok(start_out) if start_out.status.success() => {
                        RollbackResult {
                            attempted: true,
                            restored: true,
                            backup_container: Some(self.backup_container_name.clone()),
                            error: None,
                        }
                    }
                    Ok(start_out) => {
                        let error = format!(
                            "Failed to start restored container: {}\n{}",
                            String::from_utf8_lossy(&start_out.stdout),
                            String::from_utf8_lossy(&start_out.stderr)
                        );
                        RollbackResult {
                            attempted: true,
                            restored: false,
                            backup_container: Some(self.backup_container_name.clone()),
                            error: Some(error),
                        }
                    }
                    Err(e) => {
                        RollbackResult {
                            attempted: true,
                            restored: false,
                            backup_container: Some(self.backup_container_name.clone()),
                            error: Some(format!("Failed to execute docker start: {}", e)),
                        }
                    }
                }
            }
            Ok(out) => {
                let error = format!(
                    "Failed to restore backup container: {}\n{}",
                    String::from_utf8_lossy(&out.stdout),
                    String::from_utf8_lossy(&out.stderr)
                );
                RollbackResult {
                    attempted: true,
                    restored: false,
                    backup_container: Some(self.backup_container_name.clone()),
                    error: Some(error),
                }
            }
            Err(e) => {
                RollbackResult {
                    attempted: true,
                    restored: false,
                    backup_container: Some(self.backup_container_name.clone()),
                    error: Some(format!("Failed to execute docker rename: {}", e)),
                }
            }
        }
    }

    /// Clean up backup container after successful update
    pub fn cleanup_backup(&self) -> VersionResult<()> {
        let output = Command::new("docker")
            .arg("rm")
            .arg("-f")
            .arg(&self.backup_container_name)
            .output()
            .map_err(|e| VersionError::StepFailed {
                step: "cleanup_backup".to_string(),
                message: format!("Failed to cleanup backup: {}", e),
            })?;

        if !output.status.success() {
            let error = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return Err(VersionError::StepFailed {
                step: "cleanup_backup".to_string(),
                message: error,
            });
        }

        Ok(())
    }
}
