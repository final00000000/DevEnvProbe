use async_trait::async_trait;
use crate::contracts::{LocalGitSourceConfig, VersionCandidate, VersionSourceKind};
use crate::version::errors::{VersionError, VersionResult};
use crate::version::source_trait::VersionSourceProvider;
use std::path::Path;
use std::process::Command;

pub struct GitCheckerProvider {
    config: LocalGitSourceConfig,
}

impl GitCheckerProvider {
    pub fn new(config: LocalGitSourceConfig) -> Self {
        Self { config }
    }

    fn validate_repo_path(&self) -> VersionResult<()> {
        let path = Path::new(&self.config.repo_path);
        if !path.exists() {
            return Err(VersionError::InvalidInput(format!(
                "Git repository path does not exist: {}",
                self.config.repo_path
            )));
        }

        let git_dir = path.join(".git");
        if !git_dir.exists() {
            return Err(VersionError::InvalidInput(format!(
                "Not a Git repository: {}",
                self.config.repo_path
            )));
        }

        Ok(())
    }

    fn execute_git_command(&self, args: &[&str]) -> VersionResult<String> {
        let output = Command::new("git")
            .current_dir(&self.config.repo_path)
            .args(args)
            .output()
            .map_err(VersionError::Io)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(VersionError::StepFailed {
                step: format!("git {}", args.join(" ")),
                message: stderr.to_string(),
            });
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn fetch_remote(&self) -> VersionResult<()> {
        self.execute_git_command(&["fetch", "--tags", "--prune", "origin"])?;
        Ok(())
    }

    fn get_current_commit(&self) -> VersionResult<String> {
        self.execute_git_command(&["rev-parse", "HEAD"])
    }

    fn get_remote_commit(&self) -> VersionResult<String> {
        let remote_branch = format!("origin/{}", self.config.branch);
        self.execute_git_command(&["rev-parse", &remote_branch])
    }

    fn get_latest_tag(&self) -> VersionResult<Option<String>> {
        let output = self.execute_git_command(&["tag", "--sort=-v:refname"])?;
        Ok(output.lines().next().map(|s| s.to_string()))
    }

    fn get_commits_behind(&self, local: &str, remote: &str) -> VersionResult<usize> {
        let output = self.execute_git_command(&["rev-list", "--count", &format!("{}..{}", local, remote)])?;
        output
            .parse::<usize>()
            .map_err(|e| VersionError::Parse(format!("Failed to parse commit count: {}", e)))
    }

    fn get_latest_commit_message(&self, commit: &str) -> VersionResult<String> {
        self.execute_git_command(&["log", "-1", "--pretty=format:%s", commit])
    }

    fn read_version_from_file(&self) -> VersionResult<Option<String>> {
        if let Some(version_file) = &self.config.version_file {
            let file_path = Path::new(&self.config.repo_path).join(version_file);
            if file_path.exists() {
                let content = std::fs::read_to_string(&file_path)
                    .map_err(VersionError::Io)?;
                return Ok(Some(content.trim().to_string()));
            }
        }
        Ok(None)
    }
}

#[async_trait]
impl VersionSourceProvider for GitCheckerProvider {
    fn source_kind(&self) -> VersionSourceKind {
        VersionSourceKind::LocalGit
    }

    async fn fetch_latest(&self) -> VersionResult<VersionCandidate> {
        // Validate repository
        self.validate_repo_path()?;

        // Fetch remote updates
        self.fetch_remote()?;

        // Get current and remote commits
        let local_commit = self.get_current_commit()?;
        let remote_commit = self.get_remote_commit()?;

        // Determine version
        let version = if let Some(file_version) = self.read_version_from_file()? {
            file_version
        } else if let Some(tag) = self.get_latest_tag()? {
            tag
        } else {
            remote_commit[..8].to_string() // Use short commit hash
        };

        // Get commits behind count
        let commits_behind = self.get_commits_behind(&local_commit, &remote_commit)?;

        // Get latest commit message
        let latest_message = self.get_latest_commit_message(&remote_commit).ok();

        let release_notes = if commits_behind > 0 {
            Some(format!(
                "{} commits behind. Latest: {}",
                commits_behind,
                latest_message.as_deref().unwrap_or("(no message)")
            ))
        } else {
            latest_message
        };

        let short_commit = remote_commit[..8].to_string();

        Ok(VersionCandidate {
            source: VersionSourceKind::LocalGit,
            version,
            digest: Some(remote_commit),
            release_notes,
            published_at: None,
            raw_reference: Some(format!("{}@{}", self.config.branch, short_commit)),
        })
    }

    fn timeout_ms(&self) -> u64 {
        30000 // Git operations can be slower, use 30 seconds
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_invalid_path() {
        let config = LocalGitSourceConfig {
            repo_path: "/nonexistent/path".to_string(),
            branch: "main".to_string(),
            version_file: None,
        };

        let provider = GitCheckerProvider::new(config);
        assert!(provider.validate_repo_path().is_err());
    }
}
