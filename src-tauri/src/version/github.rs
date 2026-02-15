use async_trait::async_trait;
use crate::contracts::{GithubReleaseSourceConfig, VersionCandidate, VersionSourceKind};
use crate::version::errors::{VersionError, VersionResult};
use crate::version::source_trait::VersionSourceProvider;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[allow(dead_code)]
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    prerelease: bool,
    draft: bool,
}

pub struct GithubProvider {
    config: GithubReleaseSourceConfig,
}

impl GithubProvider {
    pub fn new(config: GithubReleaseSourceConfig) -> Self {
        Self { config }
    }

    fn build_api_url(&self) -> String {
        format!(
            "https://api.github.com/repos/{}/{}/releases",
            self.config.owner, self.config.repo
        )
    }

    fn filter_releases(&self, releases: Vec<GithubRelease>) -> Option<GithubRelease> {
        releases
            .into_iter()
            .find(|release| {
                // Skip drafts
                if release.draft {
                    return false;
                }
                // Filter prerelease based on config
                if release.prerelease && !self.config.include_prerelease {
                    return false;
                }
                true
            })
    }
}

#[async_trait]
impl VersionSourceProvider for GithubProvider {
    fn source_kind(&self) -> VersionSourceKind {
        VersionSourceKind::GithubRelease
    }

    async fn fetch_latest(&self) -> VersionResult<VersionCandidate> {
        let url = self.build_api_url();

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(self.timeout_ms()))
            .user_agent("DevEnvProbe/1.0")
            .build()
            .map_err(|e| VersionError::Http(e.to_string()))?;

        let mut request = client
            .get(&url)
            .header("Accept", "application/vnd.github+json");

        // Add token if provided
        if let Some(token) = &self.config.token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let response = request.send().await.map_err(|e| {
            if e.is_timeout() {
                VersionError::SourceTimeout(format!("GitHub API timeout: {}", url))
            } else {
                VersionError::SourceUnavailable(format!("GitHub API error: {}", e))
            }
        })?;

        if !response.status().is_success() {
            return Err(VersionError::SourceUnavailable(format!(
                "GitHub API returned status: {}",
                response.status()
            )));
        }

        let releases: Vec<GithubRelease> = response
            .json()
            .await
            .map_err(|e| VersionError::Parse(format!("Failed to parse GitHub response: {}", e)))?;

        let latest_release = self
            .filter_releases(releases)
            .ok_or_else(|| VersionError::Parse("No matching releases found".to_string()))?;

        Ok(VersionCandidate {
            source: VersionSourceKind::GithubRelease,
            version: latest_release.tag_name.clone(),
            digest: None,
            release_notes: latest_release.body,
            published_at: latest_release.published_at,
            raw_reference: Some(format!(
                "https://github.com/{}/{}/releases/tag/{}",
                self.config.owner, self.config.repo, latest_release.tag_name
            )),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_api_url() {
        let config = GithubReleaseSourceConfig {
            owner: "nginx".to_string(),
            repo: "nginx".to_string(),
            include_prerelease: false,
            token: None,
        };

        let provider = GithubProvider::new(config);
        assert_eq!(
            provider.build_api_url(),
            "https://api.github.com/repos/nginx/nginx/releases"
        );
    }

    #[test]
    fn test_filter_releases() {
        let config = GithubReleaseSourceConfig {
            owner: "test".to_string(),
            repo: "test".to_string(),
            include_prerelease: false,
            token: None,
        };

        let provider = GithubProvider::new(config);

        let releases = vec![
            GithubRelease {
                tag_name: "v1.0.0".to_string(),
                name: Some("Release 1.0.0".to_string()),
                body: None,
                published_at: Some("2023-01-01T00:00:00Z".to_string()),
                prerelease: false,
                draft: false,
            },
            GithubRelease {
                tag_name: "v1.1.0-beta".to_string(),
                name: Some("Beta 1.1.0".to_string()),
                body: None,
                published_at: Some("2023-01-02T00:00:00Z".to_string()),
                prerelease: true,
                draft: false,
            },
            GithubRelease {
                tag_name: "v1.2.0".to_string(),
                name: Some("Draft".to_string()),
                body: None,
                published_at: None,
                prerelease: false,
                draft: true,
            },
        ];

        let latest = provider.filter_releases(releases);
        assert!(latest.is_some());
        assert_eq!(latest.unwrap().tag_name, "v1.0.0");
    }
}
