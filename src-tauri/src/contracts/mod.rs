use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResponse<T>
where
    T: Serialize,
{
    pub ok: bool,
    pub data: Option<T>,
    pub error: Option<String>,
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSnapshot {
    pub name: String,
    pub mount_point: String,
    pub total_gb: f64,
    pub used_gb: f64,
    pub usage_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    pub host_name: String,
    pub os_name: String,
    pub os_version: String,
    pub build_number: String,
    pub architecture: String,
    pub uptime_seconds: u64,
    pub cpu_model: String,
    pub cpu_cores: u32,
    pub cpu_logical_cores: u32,
    pub cpu_usage_percent: f64,
    pub total_memory_gb: f64,
    pub used_memory_gb: f64,
    pub memory_usage_percent: f64,
    pub disks: Vec<DiskSnapshot>,
    pub sample_mode: Option<String>,
    pub sampled_at_ms: Option<u64>,
    pub is_stale: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemRealtimeSnapshot {
    pub uptime_seconds: u64,
    pub cpu_usage_percent: f64,
    pub total_memory_gb: f64,
    pub used_memory_gb: f64,
    pub memory_usage_percent: f64,
    pub sample_mode: Option<String>,
    pub sampled_at_ms: Option<u64>,
    pub is_stale: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub name: String,
    pub command: String,
    pub category: String,
    pub installed: bool,
    pub version: Option<String>,
    pub details: Option<String>,
    pub install_key: Option<String>,
    pub install_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerCommandResult {
    pub action: String,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployStepRequest {
    pub profile: DeployProfile,
    pub step: String,
    pub selected_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployProfile {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub git: DeployGitConfig,
    pub compose: DeployComposeConfig,
    pub run: DeployRunConfig,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployGitConfig {
    pub enabled: bool,
    pub remote: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployComposeConfig {
    pub project_path: String,
    pub compose_file: String,
    pub service: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployRunConfig {
    pub param_mode: String,
    pub container_name: String,
    pub image_ref: String,
    pub image_source: String,
    pub build_context: String,
    pub dockerfile: String,
    pub image_tag: String,
    pub ports_text: String,
    pub env_text: String,
    pub volumes_text: String,
    pub restart_policy: String,
    pub extra_args: String,
    pub template_args: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployStepResult {
    pub step: String,
    pub ok: bool,
    pub skipped: bool,
    pub commands: Vec<String>,
    pub output: String,
    pub error: Option<String>,
    pub elapsed_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub item_key: String,
    pub package_id: String,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallResult {
    pub item_key: String,
    pub package_id: String,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathValidationResult {
    pub valid: bool,
    pub exists: bool,
    pub writable: bool,
    pub available_space_gb: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WingetStatus {
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

// ============================================================================
// Version Management Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSelection {
    pub image_id: Option<String>,
    pub repository: String,
    pub tag: String,
    pub container_name: Option<String>,
    pub project_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionSourceKind {
    DockerHub,
    GithubRelease,
    LocalGit,
    CustomApi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerHubSourceConfig {
    pub namespace: String,
    pub repository: String,
    pub include_prerelease: bool,
    pub tag_regex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubReleaseSourceConfig {
    pub owner: String,
    pub repo: String,
    pub include_prerelease: bool,
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalGitSourceConfig {
    pub repo_path: String,
    pub branch: String,
    pub version_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomApiSourceConfig {
    pub endpoint: String,
    pub method: String,
    pub headers: Vec<HttpHeaderPair>,
    pub version_field: String,
    pub notes_field: Option<String>,
    pub published_at_field: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpHeaderPair {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "config")]
pub enum VersionSourceConfig {
    DockerHub(DockerHubSourceConfig),
    GithubRelease(GithubReleaseSourceConfig),
    LocalGit(LocalGitSourceConfig),
    CustomApi(CustomApiSourceConfig),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckImageVersionRequest {
    pub image: ImageSelection,
    pub sources: Vec<VersionSourceConfig>,
    pub timeout_ms: Option<u64>,
    pub overall_timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionCandidate {
    pub source: VersionSourceKind,
    pub version: String,
    pub digest: Option<String>,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
    pub raw_reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCheckResult {
    pub source: VersionSourceKind,
    pub ok: bool,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub latest: Option<VersionCandidate>,
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckImageVersionResponse {
    pub image_key: String,
    pub current_version: Option<String>,
    pub has_update: bool,
    pub recommended: Option<VersionCandidate>,
    pub results: Vec<SourceCheckResult>,
    pub checked_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkflowConfig {
    pub git_pull_path: String,
    pub git_branch: String,
    pub build_context: String,
    pub dockerfile: String,
    pub new_image_tag: String,
    pub run_args: Vec<String>,
    pub health_check_cmd: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTimeoutConfig {
    pub git_pull_ms: u64,
    pub docker_build_ms: u64,
    pub docker_stop_ms: u64,
    pub docker_run_ms: u64,
    pub health_check_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackPolicy {
    pub enabled: bool,
    pub keep_backup_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateImageAndRestartRequest {
    pub operation_id: Option<String>,
    pub image: ImageSelection,
    pub source: VersionSourceKind,
    pub target_version: String,
    pub workflow: UpdateWorkflowConfig,
    pub timeouts: UpdateTimeoutConfig,
    pub rollback: RollbackPolicy,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStepLog {
    pub step: String,
    pub command: Option<String>,
    pub ok: bool,
    pub skipped: bool,
    pub output: String,
    pub error: Option<String>,
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub attempted: bool,
    pub restored: bool,
    pub backup_container: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateImageAndRestartResponse {
    pub operation_id: String,
    pub image_key: String,
    pub success: bool,
    pub final_image_ref: Option<String>,
    pub step_logs: Vec<UpdateStepLog>,
    pub rollback: RollbackResult,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_response_serialization() {
        let response = CommandResponse {
            ok: true,
            data: Some("test data".to_string()),
            error: None,
            elapsed_ms: 123,
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["ok"], true);
        assert_eq!(json["data"], "test data");
        assert_eq!(json["elapsedMs"], 123);
        assert!(json.get("elapsed_ms").is_none());
    }

    #[test]
    fn test_disk_snapshot_camel_case() {
        let disk = DiskSnapshot {
            name: "C:".to_string(),
            mount_point: "/".to_string(),
            total_gb: 500.0,
            used_gb: 250.0,
            usage_percent: 50.0,
        };

        let json = serde_json::to_value(&disk).unwrap();
        assert_eq!(json["mountPoint"], "/");
        assert_eq!(json["totalGb"], 500.0);
        assert_eq!(json["usedGb"], 250.0);
        assert_eq!(json["usagePercent"], 50.0);
        assert!(json.get("mount_point").is_none());
    }

    #[test]
    fn test_system_snapshot_camel_case() {
        let snapshot = SystemSnapshot {
            host_name: "test-host".to_string(),
            os_name: "Windows".to_string(),
            os_version: "11".to_string(),
            build_number: "22000".to_string(),
            architecture: "x64".to_string(),
            uptime_seconds: 3600,
            cpu_model: "Intel".to_string(),
            cpu_cores: 8,
            cpu_logical_cores: 16,
            cpu_usage_percent: 25.5,
            total_memory_gb: 16.0,
            used_memory_gb: 8.0,
            memory_usage_percent: 50.0,
            disks: vec![],
            sample_mode: Some("quick".to_string()),
            sampled_at_ms: Some(1234567890),
            is_stale: Some(false),
        };

        let json = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json["hostName"], "test-host");
        assert_eq!(json["osName"], "Windows");
        assert_eq!(json["osVersion"], "11");
        assert_eq!(json["buildNumber"], "22000");
        assert_eq!(json["uptimeSeconds"], 3600);
        assert_eq!(json["cpuModel"], "Intel");
        assert_eq!(json["cpuCores"], 8);
        assert_eq!(json["cpuLogicalCores"], 16);
        assert_eq!(json["cpuUsagePercent"], 25.5);
        assert_eq!(json["totalMemoryGb"], 16.0);
        assert_eq!(json["usedMemoryGb"], 8.0);
        assert_eq!(json["memoryUsagePercent"], 50.0);
        assert_eq!(json["sampleMode"], "quick");
        assert_eq!(json["sampledAtMs"], 1234567890);
        assert_eq!(json["isStale"], false);
    }

    #[test]
    fn test_tool_status_camel_case() {
        let tool = ToolStatus {
            name: "git".to_string(),
            command: "git".to_string(),
            category: "dev".to_string(),
            installed: true,
            version: Some("2.40.0".to_string()),
            details: None,
            install_key: Some("git".to_string()),
            install_path: None,
        };

        let json = serde_json::to_value(&tool).unwrap();
        assert_eq!(json["installKey"], "git");
        assert!(json.get("install_key").is_none());
    }

    #[test]
    fn test_docker_command_result_camel_case() {
        let result = DockerCommandResult {
            action: "ps".to_string(),
            command: "docker ps".to_string(),
            stdout: "output".to_string(),
            stderr: "".to_string(),
            exit_code: 0,
        };

        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["exitCode"], 0);
        assert!(json.get("exit_code").is_none());
    }

    #[test]
    fn test_deploy_step_result_camel_case() {
        let result = DeployStepResult {
            step: "build".to_string(),
            ok: true,
            skipped: false,
            commands: vec!["docker build".to_string()],
            output: "success".to_string(),
            error: None,
            elapsed_ms: 5000,
        };

        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["elapsedMs"], 5000);
        assert!(json.get("elapsed_ms").is_none());
    }

    #[test]
    fn test_install_result_camel_case() {
        let result = InstallResult {
            item_key: "git".to_string(),
            package_id: "Git.Git".to_string(),
            command: "winget install".to_string(),
            stdout: "installed".to_string(),
            stderr: "".to_string(),
            exit_code: 0,
        };

        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["itemKey"], "git");
        assert_eq!(json["packageId"], "Git.Git");
        assert_eq!(json["exitCode"], 0);
        assert!(json.get("item_key").is_none());
        assert!(json.get("package_id").is_none());
    }

    #[test]
    fn test_deploy_profile_nested_camel_case() {
        let profile = DeployProfile {
            id: "test".to_string(),
            name: "Test Profile".to_string(),
            mode: "compose".to_string(),
            git: DeployGitConfig {
                enabled: true,
                remote: "origin".to_string(),
            },
            compose: DeployComposeConfig {
                project_path: "/app".to_string(),
                compose_file: "docker-compose.yml".to_string(),
                service: "web".to_string(),
            },
            run: DeployRunConfig {
                param_mode: "simple".to_string(),
                container_name: "app".to_string(),
                image_ref: "app:latest".to_string(),
                image_source: "local".to_string(),
                build_context: ".".to_string(),
                dockerfile: "Dockerfile".to_string(),
                image_tag: "latest".to_string(),
                ports_text: "8080:80".to_string(),
                env_text: "".to_string(),
                volumes_text: "".to_string(),
                restart_policy: "always".to_string(),
                extra_args: "".to_string(),
                template_args: "".to_string(),
            },
            created_at: 1234567890,
            updated_at: 1234567890,
        };

        let json = serde_json::to_value(&profile).unwrap();
        assert_eq!(json["createdAt"], 1234567890);
        assert_eq!(json["updatedAt"], 1234567890);
        assert_eq!(json["compose"]["projectPath"], "/app");
        assert_eq!(json["compose"]["composeFile"], "docker-compose.yml");
        assert_eq!(json["run"]["paramMode"], "simple");
        assert_eq!(json["run"]["containerName"], "app");
        assert_eq!(json["run"]["imageRef"], "app:latest");
        assert_eq!(json["run"]["imageSource"], "local");
        assert_eq!(json["run"]["buildContext"], ".");
        assert_eq!(json["run"]["imageTag"], "latest");
        assert_eq!(json["run"]["portsText"], "8080:80");
        assert_eq!(json["run"]["envText"], "");
        assert_eq!(json["run"]["volumesText"], "");
        assert_eq!(json["run"]["restartPolicy"], "always");
        assert_eq!(json["run"]["extraArgs"], "");
        assert_eq!(json["run"]["templateArgs"], "");
    }
}
