use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use crate::contracts::CheckImageVersionResponse;

/// Cache entry for version check results
#[derive(Debug, Clone)]
pub struct VersionCheckCache {
    pub response: CheckImageVersionResponse,
    pub cached_at: SystemTime,
}

impl VersionCheckCache {
    pub fn is_expired(&self, ttl: Duration) -> bool {
        SystemTime::now()
            .duration_since(self.cached_at)
            .map(|elapsed| elapsed > ttl)
            .unwrap_or(true)
    }
}

/// Update operation lock entry
#[derive(Debug, Clone)]
pub struct UpdateLock {
    pub operation_id: String,
    #[allow(dead_code)]
    pub image_key: String,
    pub locked_at: SystemTime,
}

impl UpdateLock {
    pub fn is_expired(&self, timeout: Duration) -> bool {
        SystemTime::now()
            .duration_since(self.locked_at)
            .map(|elapsed| elapsed > timeout)
            .unwrap_or(true)
    }
}

/// Runtime state for version management
#[derive(Debug, Clone)]
pub struct VersionRuntimeState {
    /// Version check result cache (image_key -> cached response)
    check_cache: Arc<Mutex<HashMap<String, VersionCheckCache>>>,

    /// Update operation locks (image_key -> lock)
    update_locks: Arc<Mutex<HashMap<String, UpdateLock>>>,
}

impl Default for VersionRuntimeState {
    fn default() -> Self {
        Self::new()
    }
}

impl VersionRuntimeState {
    pub fn new() -> Self {
        Self {
            check_cache: Arc::new(Mutex::new(HashMap::new())),
            update_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Get cached version check result
    pub fn get_cached_check(&self, image_key: &str, ttl: Duration) -> Option<CheckImageVersionResponse> {
        let cache = self.check_cache.lock().unwrap();
        cache.get(image_key).and_then(|entry| {
            if entry.is_expired(ttl) {
                None
            } else {
                Some(entry.response.clone())
            }
        })
    }

    /// Cache version check result
    pub fn cache_check(&self, image_key: String, response: CheckImageVersionResponse) {
        let mut cache = self.check_cache.lock().unwrap();
        cache.insert(
            image_key,
            VersionCheckCache {
                response,
                cached_at: SystemTime::now(),
            },
        );
    }

    /// Try to acquire update lock for an image
    pub fn try_lock_update(&self, image_key: String, operation_id: String) -> Result<(), String> {
        let mut locks = self.update_locks.lock().unwrap();

        // Clean up expired locks first
        let expired_keys: Vec<String> = locks
            .iter()
            .filter(|(_, lock)| lock.is_expired(Duration::from_secs(900))) // 15 minutes
            .map(|(key, _)| key.clone())
            .collect();

        for key in expired_keys {
            locks.remove(&key);
        }

        // Check if already locked
        if let Some(existing_lock) = locks.get(&image_key) {
            if !existing_lock.is_expired(Duration::from_secs(900)) {
                return Err(format!(
                    "镜像 {} 正在被操作 {} 更新中",
                    image_key, existing_lock.operation_id
                ));
            }
        }

        // Acquire lock
        locks.insert(
            image_key.clone(),
            UpdateLock {
                operation_id,
                image_key,
                locked_at: SystemTime::now(),
            },
        );

        Ok(())
    }

    /// Release update lock for an image
    pub fn unlock_update(&self, image_key: &str) {
        let mut locks = self.update_locks.lock().unwrap();
        locks.remove(image_key);
    }

    /// Clear all expired cache entries
    #[allow(dead_code)]
    pub fn cleanup_cache(&self, ttl: Duration) {
        let mut cache = self.check_cache.lock().unwrap();
        cache.retain(|_, entry| !entry.is_expired(ttl));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lock_acquire_and_release() {
        let state = VersionRuntimeState::new();
        let image_key = "nginx:latest".to_string();
        let op_id = "op-123".to_string();

        // Should acquire lock successfully
        assert!(state.try_lock_update(image_key.clone(), op_id.clone()).is_ok());

        // Should fail to acquire lock again
        assert!(state.try_lock_update(image_key.clone(), "op-456".to_string()).is_err());

        // Release lock
        state.unlock_update(&image_key);

        // Should acquire lock successfully again
        assert!(state.try_lock_update(image_key.clone(), "op-789".to_string()).is_ok());
    }

    #[test]
    fn test_cache_expiration() {
        let state = VersionRuntimeState::new();
        let image_key = "nginx:latest".to_string();

        let response = CheckImageVersionResponse {
            image_key: image_key.clone(),
            current_version: Some("1.0.0".to_string()),
            has_update: false,
            recommended: None,
            results: vec![],
            checked_at_ms: 0,
        };

        // Cache the response
        state.cache_check(image_key.clone(), response.clone());

        // Should get cached result with long TTL
        assert!(state.get_cached_check(&image_key, Duration::from_secs(60)).is_some());

        // Should not get cached result with zero TTL
        assert!(state.get_cached_check(&image_key, Duration::from_secs(0)).is_none());
    }
}
