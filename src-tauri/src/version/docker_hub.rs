use async_trait::async_trait;
use crate::contracts::{DockerHubSourceConfig, VersionCandidate, VersionSourceKind};
use crate::version::errors::{VersionError, VersionResult};
use crate::version::source_trait::VersionSourceProvider;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct DockerHubTag {
    name: String,
    last_updated: String,
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DockerHubTagsResponse {
    results: Vec<DockerHubTag>,
}

pub struct DockerHubProvider {
    config: DockerHubSourceConfig,
}

impl DockerHubProvider {
    pub fn new(config: DockerHubSourceConfig) -> Self {
        Self { config }
    }

    fn build_api_url(&self) -> String {
        format!(
            "https://hub.docker.com/v2/repositories/{}/{}/tags",
            self.config.namespace, self.config.repository
        )
    }

    fn filter_and_sort_tags(&self, tags: Vec<DockerHubTag>) -> Option<DockerHubTag> {
        let mut filtered: Vec<DockerHubTag> = tags
            .into_iter()
            .filter(|tag| {
                // Filter by regex if provided
                if let Some(regex_pattern) = &self.config.tag_regex {
                    if let Ok(regex) = regex::Regex::new(regex_pattern) {
                        return regex.is_match(&tag.name);
                    }
                }
                true
            })
            .collect();

        // Sort by last_updated (most recent first)
        filtered.sort_by(|a, b| b.last_updated.cmp(&a.last_updated));

        filtered.into_iter().next()
    }
}

#[async_trait]
impl VersionSourceProvider for DockerHubProvider {
    fn source_kind(&self) -> VersionSourceKind {
        VersionSourceKind::DockerHub
    }

    async fn fetch_latest(&self) -> VersionResult<VersionCandidate> {
        let url = self.build_api_url();

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(self.timeout_ms()))
            .build()
            .map_err(|e| VersionError::Http(e.to_string()))?;

        let response = client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    VersionError::SourceTimeout(format!("Docker Hub API timeout: {}", url))
                } else {
                    VersionError::SourceUnavailable(format!("Docker Hub API error: {}", e))
                }
            })?;

        if !response.status().is_success() {
            return Err(VersionError::SourceUnavailable(format!(
                "Docker Hub API returned status: {}",
                response.status()
            )));
        }

        let tags_response: DockerHubTagsResponse = response
            .json()
            .await
            .map_err(|e| VersionError::Parse(format!("Failed to parse Docker Hub response: {}", e)))?;

        let latest_tag = self
            .filter_and_sort_tags(tags_response.results)
            .ok_or_else(|| VersionError::Parse("No matching tags found".to_string()))?;

        Ok(VersionCandidate {
            source: VersionSourceKind::DockerHub,
            version: latest_tag.name.clone(),
            digest: latest_tag.digest,
            release_notes: None,
            published_at: Some(latest_tag.last_updated),
            raw_reference: Some(format!(
                "{}/{}:{}",
                self.config.namespace, self.config.repository, latest_tag.name
            )),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_api_url() {
        let config = DockerHubSourceConfig {
            namespace: "library".to_string(),
            repository: "nginx".to_string(),
            include_prerelease: false,
            tag_regex: None,
        };

        let provider = DockerHubProvider::new(config);
        assert_eq!(
            provider.build_api_url(),
            "https://hub.docker.com/v2/repositories/library/nginx/tags"
        );
    }

    #[test]
    fn test_filter_tags_with_regex() {
        let config = DockerHubSourceConfig {
            namespace: "library".to_string(),
            repository: "nginx".to_string(),
            include_prerelease: false,
            tag_regex: Some(r"^\d+\.\d+\.\d+$".to_string()),
        };

        let provider = DockerHubProvider::new(config);

        let tags = vec![
            DockerHubTag {
                name: "1.21.0".to_string(),
                last_updated: "2023-01-01T00:00:00Z".to_string(),
                digest: None,
            },
            DockerHubTag {
                name: "latest".to_string(),
                last_updated: "2023-01-02T00:00:00Z".to_string(),
                digest: None,
            },
            DockerHubTag {
                name: "1.22.0".to_string(),
                last_updated: "2023-01-03T00:00:00Z".to_string(),
                digest: None,
            },
        ];

        let latest = provider.filter_and_sort_tags(tags);
        assert!(latest.is_some());
        assert_eq!(latest.unwrap().name, "1.22.0");
    }
}
