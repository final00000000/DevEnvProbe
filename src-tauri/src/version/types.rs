use serde::{Deserialize, Serialize};

/// Version check step identifier
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionCheckStep {
    FetchRemote,
    ParseVersion,
    CompareVersion,
}

/// Update workflow step identifier
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateStep {
    GitPull,
    DockerBuild,
    DockerStop,
    DockerRename,
    DockerRun,
    HealthCheck,
    Rollback,
}

#[allow(dead_code)]
impl UpdateStep {
    pub fn as_str(&self) -> &'static str {
        match self {
            UpdateStep::GitPull => "git_pull",
            UpdateStep::DockerBuild => "docker_build",
            UpdateStep::DockerStop => "docker_stop",
            UpdateStep::DockerRename => "docker_rename",
            UpdateStep::DockerRun => "docker_run",
            UpdateStep::HealthCheck => "health_check",
            UpdateStep::Rollback => "rollback",
        }
    }
}

/// Container backup snapshot for rollback
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerBackup {
    pub original_name: String,
    pub backup_name: String,
    pub image_ref: String,
    pub created_at_ms: u64,
}

#[allow(dead_code)]
impl ContainerBackup {
    pub fn new(original_name: String, operation_id: &str, image_ref: String) -> Self {
        Self {
            backup_name: format!("{}-backup-{}", original_name, operation_id),
            original_name,
            image_ref,
            created_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        }
    }
}
