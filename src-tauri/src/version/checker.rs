use std::time::{Duration, Instant};
use crate::contracts::{
    CheckImageVersionRequest, CheckImageVersionResponse, SourceCheckResult,
    VersionCandidate, VersionSourceConfig, VersionSourceKind,
};
use crate::version::errors::{VersionError, VersionErrorCode, VersionResult};
use crate::version::state::VersionRuntimeState;
use crate::version::source_trait::VersionSourceProvider;
use crate::version::docker_hub::DockerHubProvider;
use crate::version::github::GithubProvider;
use crate::version::git_checker::GitCheckerProvider;
use crate::version::custom_api::CustomApiProvider;

const DEFAULT_SOURCE_TIMEOUT_MS: u64 = 8000;
const DEFAULT_OVERALL_TIMEOUT_MS: u64 = 15000;
const CHECK_CACHE_TTL_SECONDS: u64 = 30;

/// Build image key from image selection
fn build_image_key(repository: &str, tag: &str) -> String {
    format!("{}:{}", repository, tag)
}

/// Create provider from source config
fn create_provider(config: VersionSourceConfig) -> Box<dyn VersionSourceProvider> {
    match config {
        VersionSourceConfig::DockerHub(cfg) => Box::new(DockerHubProvider::new(cfg)),
        VersionSourceConfig::GithubRelease(cfg) => Box::new(GithubProvider::new(cfg)),
        VersionSourceConfig::LocalGit(cfg) => Box::new(GitCheckerProvider::new(cfg)),
        VersionSourceConfig::CustomApi(cfg) => Box::new(CustomApiProvider::new(cfg)),
    }
}

/// Check single source with timeout
async fn check_single_source(
    provider: Box<dyn VersionSourceProvider>,
    timeout_ms: u64,
) -> SourceCheckResult {
    let source = provider.source_kind();
    let started_at = Instant::now();

    let result = tokio::time::timeout(
        Duration::from_millis(timeout_ms),
        provider.fetch_latest(),
    )
    .await;

    let elapsed_ms = started_at.elapsed().as_millis();

    match result {
        Ok(Ok(candidate)) => SourceCheckResult {
            source,
            ok: true,
            error_code: None,
            error_message: None,
            latest: Some(candidate),
            elapsed_ms,
        },
        Ok(Err(err)) => SourceCheckResult {
            source,
            ok: false,
            error_code: Some(err.code().as_str().to_string()),
            error_message: Some(err.user_message()),
            latest: None,
            elapsed_ms,
        },
        Err(_) => SourceCheckResult {
            source,
            ok: false,
            error_code: Some(VersionErrorCode::SourceTimeout.as_str().to_string()),
            error_message: Some(format!("Source check timeout after {}ms", timeout_ms)),
            latest: None,
            elapsed_ms,
        },
    }
}

/// Select recommended version from results
fn select_recommended(results: &[SourceCheckResult]) -> Option<VersionCandidate> {
    // Priority: LocalGit > GithubRelease > DockerHub > CustomApi
    let priority_order = [
        VersionSourceKind::LocalGit,
        VersionSourceKind::GithubRelease,
        VersionSourceKind::DockerHub,
        VersionSourceKind::CustomApi,
    ];

    for source_kind in &priority_order {
        if let Some(result) = results.iter().find(|r| r.ok && r.source == *source_kind) {
            if let Some(candidate) = &result.latest {
                return Some(candidate.clone());
            }
        }
    }

    None
}

/// Check image version from multiple sources
pub async fn check_image_version(
    request: CheckImageVersionRequest,
    runtime_state: &VersionRuntimeState,
) -> VersionResult<CheckImageVersionResponse> {
    let image_key = build_image_key(&request.image.repository, &request.image.tag);

    // Check cache first
    let cache_ttl = Duration::from_secs(CHECK_CACHE_TTL_SECONDS);
    if let Some(cached) = runtime_state.get_cached_check(&image_key, cache_ttl) {
        return Ok(cached);
    }

    // Validate sources
    if request.sources.is_empty() {
        return Err(VersionError::InvalidInput(
            "At least one version source is required".to_string(),
        ));
    }

    let source_timeout_ms = request.timeout_ms.unwrap_or(DEFAULT_SOURCE_TIMEOUT_MS);
    let overall_timeout_ms = request.overall_timeout_ms.unwrap_or(DEFAULT_OVERALL_TIMEOUT_MS);

    // Create providers
    let providers: Vec<Box<dyn VersionSourceProvider>> = request
        .sources
        .into_iter()
        .map(create_provider)
        .collect();

    // Check all sources in parallel with overall timeout
    let check_tasks: Vec<_> = providers
        .into_iter()
        .map(|provider| check_single_source(provider, source_timeout_ms))
        .collect();

    let results = tokio::time::timeout(
        Duration::from_millis(overall_timeout_ms),
        futures::future::join_all(check_tasks),
    )
    .await
    .map_err(|_| {
        VersionError::SourceTimeout(format!(
            "Overall version check timeout after {}ms",
            overall_timeout_ms
        ))
    })?;

    // Check if all sources failed
    if results.iter().all(|r| !r.ok) {
        return Err(VersionError::NoValidSourceResult);
    }

    // Select recommended version
    let recommended = select_recommended(&results);

    // Determine if update is available
    let has_update = if let Some(rec) = &recommended {
        // Simple version comparison (can be enhanced with semver)
        rec.version != request.image.tag
    } else {
        false
    };

    let response = CheckImageVersionResponse {
        image_key: image_key.clone(),
        current_version: Some(request.image.tag.clone()),
        has_update,
        recommended,
        results,
        checked_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    };

    // Cache the response
    runtime_state.cache_check(image_key, response.clone());

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_image_key() {
        assert_eq!(build_image_key("nginx", "latest"), "nginx:latest");
        assert_eq!(build_image_key("library/redis", "7.0"), "library/redis:7.0");
    }

    #[test]
    fn test_select_recommended_priority() {
        let results = vec![
            SourceCheckResult {
                source: VersionSourceKind::DockerHub,
                ok: true,
                error_code: None,
                error_message: None,
                latest: Some(VersionCandidate {
                    source: VersionSourceKind::DockerHub,
                    version: "1.0.0".to_string(),
                    digest: None,
                    release_notes: None,
                    published_at: None,
                    raw_reference: None,
                }),
                elapsed_ms: 100,
            },
            SourceCheckResult {
                source: VersionSourceKind::LocalGit,
                ok: true,
                error_code: None,
                error_message: None,
                latest: Some(VersionCandidate {
                    source: VersionSourceKind::LocalGit,
                    version: "1.1.0".to_string(),
                    digest: None,
                    release_notes: None,
                    published_at: None,
                    raw_reference: None,
                }),
                elapsed_ms: 200,
            },
        ];

        let recommended = select_recommended(&results);
        assert!(recommended.is_some());
        assert_eq!(recommended.unwrap().source, VersionSourceKind::LocalGit);
    }
}
