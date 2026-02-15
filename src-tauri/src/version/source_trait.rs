use async_trait::async_trait;
use crate::contracts::{VersionCandidate, VersionSourceKind};
use crate::version::errors::VersionResult;

/// Version source provider trait
/// All version sources must implement this trait
#[async_trait]
pub trait VersionSourceProvider: Send + Sync {
    /// Get the source kind
    fn source_kind(&self) -> VersionSourceKind;

    /// Fetch the latest version from this source
    async fn fetch_latest(&self) -> VersionResult<VersionCandidate>;

    /// Get the timeout for this source (in milliseconds)
    fn timeout_ms(&self) -> u64 {
        8000 // Default 8 seconds
    }
}
