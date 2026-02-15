use std::process::Command;
use std::time::{Duration, Instant};
use std::thread;

use crate::version::errors::{VersionError, VersionResult};

pub struct HealthChecker {
    container_name: String,
    max_wait_seconds: u64,
    check_interval_ms: u64,
}

impl HealthChecker {
    pub fn new(container_name: String, max_wait_seconds: u64) -> Self {
        Self {
            container_name,
            max_wait_seconds,
            check_interval_ms: 1000,
        }
    }

    pub fn wait_until_healthy(&self) -> VersionResult<()> {
        let start = Instant::now();
        let timeout = Duration::from_secs(self.max_wait_seconds);

        loop {
            if start.elapsed() > timeout {
                return Err(VersionError::StepFailed {
                    step: "health_check".to_string(),
                    message: format!("Container {} did not become healthy within {} seconds",
                        self.container_name, self.max_wait_seconds),
                });
            }

            match self.check_container_status() {
                Ok(true) => return Ok(()),
                Ok(false) => {
                    thread::sleep(Duration::from_millis(self.check_interval_ms));
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
    }

    fn check_container_status(&self) -> VersionResult<bool> {
        let output = Command::new("docker")
            .arg("inspect")
            .arg("--format")
            .arg("{{.State.Status}}")
            .arg(&self.container_name)
            .output()
            .map_err(|e| VersionError::StepFailed {
                step: "health_check".to_string(),
                message: format!("Failed to inspect container: {}", e),
            })?;

        if !output.status.success() {
            return Err(VersionError::StepFailed {
                step: "health_check".to_string(),
                message: format!("Container {} not found", self.container_name),
            });
        }

        let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(status == "running")
    }
}
