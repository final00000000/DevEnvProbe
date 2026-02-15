use async_trait::async_trait;
use crate::contracts::{CustomApiSourceConfig, VersionCandidate, VersionSourceKind};
use crate::version::errors::{VersionError, VersionResult};
use crate::version::source_trait::VersionSourceProvider;
use serde_json::Value;

pub struct CustomApiProvider {
    config: CustomApiSourceConfig,
}

impl CustomApiProvider {
    pub fn new(config: CustomApiSourceConfig) -> Self {
        Self { config }
    }

    fn validate_url(&self) -> VersionResult<()> {
        let url = &self.config.endpoint;
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(VersionError::InvalidInput(format!(
                "Invalid URL scheme: {}. Only http:// and https:// are allowed",
                url
            )));
        }
        Ok(())
    }

    fn extract_field(json: &Value, field: &str) -> Option<String> {
        json.get(field)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }
}

#[async_trait]
impl VersionSourceProvider for CustomApiProvider {
    fn source_kind(&self) -> VersionSourceKind {
        VersionSourceKind::CustomApi
    }

    async fn fetch_latest(&self) -> VersionResult<VersionCandidate> {
        // Validate URL
        self.validate_url()?;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(self.timeout_ms()))
            .build()
            .map_err(|e| VersionError::Http(e.to_string()))?;

        // Build request
        let method = match self.config.method.to_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            _ => {
                return Err(VersionError::InvalidInput(format!(
                    "Unsupported HTTP method: {}. Only GET and POST are supported",
                    self.config.method
                )))
            }
        };

        let mut request = client.request(method, &self.config.endpoint);

        // Add custom headers
        for header in &self.config.headers {
            // Validate header key (only allow alphanumeric, dash, underscore)
            if !header.key.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
                return Err(VersionError::InvalidInput(format!(
                    "Invalid header key: {}",
                    header.key
                )));
            }
            request = request.header(&header.key, &header.value);
        }

        // Send request
        let response = request.send().await.map_err(|e| {
            if e.is_timeout() {
                VersionError::SourceTimeout(format!("Custom API timeout: {}", self.config.endpoint))
            } else {
                VersionError::SourceUnavailable(format!("Custom API error: {}", e))
            }
        })?;

        if !response.status().is_success() {
            return Err(VersionError::SourceUnavailable(format!(
                "Custom API returned status: {}",
                response.status()
            )));
        }

        // Parse JSON response
        let json: Value = response
            .json()
            .await
            .map_err(|e| VersionError::Parse(format!("Failed to parse custom API response: {}", e)))?;

        // Extract version field
        let version = Self::extract_field(&json, &self.config.version_field)
            .ok_or_else(|| {
                VersionError::Parse(format!(
                    "Version field '{}' not found in response",
                    self.config.version_field
                ))
            })?;

        // Extract optional fields
        let release_notes = self
            .config
            .notes_field
            .as_ref()
            .and_then(|field| Self::extract_field(&json, field));

        let published_at = self
            .config
            .published_at_field
            .as_ref()
            .and_then(|field| Self::extract_field(&json, field));

        Ok(VersionCandidate {
            source: VersionSourceKind::CustomApi,
            version,
            digest: None,
            release_notes,
            published_at,
            raw_reference: Some(self.config.endpoint.clone()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_url() {
        let config = CustomApiSourceConfig {
            endpoint: "https://api.example.com/version".to_string(),
            method: "GET".to_string(),
            headers: vec![],
            version_field: "version".to_string(),
            notes_field: None,
            published_at_field: None,
        };

        let provider = CustomApiProvider::new(config);
        assert!(provider.validate_url().is_ok());
    }

    #[test]
    fn test_validate_invalid_url() {
        let config = CustomApiSourceConfig {
            endpoint: "ftp://invalid.com".to_string(),
            method: "GET".to_string(),
            headers: vec![],
            version_field: "version".to_string(),
            notes_field: None,
            published_at_field: None,
        };

        let provider = CustomApiProvider::new(config);
        assert!(provider.validate_url().is_err());
    }

    #[test]
    fn test_extract_field() {
        let json: Value = serde_json::json!({
            "version": "1.0.0",
            "notes": "Release notes"
        });

        assert_eq!(
            CustomApiProvider::extract_field(&json, "version"),
            Some("1.0.0".to_string())
        );
        assert_eq!(
            CustomApiProvider::extract_field(&json, "notes"),
            Some("Release notes".to_string())
        );
        assert_eq!(CustomApiProvider::extract_field(&json, "missing"), None);
    }
}
