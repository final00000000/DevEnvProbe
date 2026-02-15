use std::sync::{Arc, RwLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::contracts::{SystemSnapshot, SystemRealtimeSnapshot};

#[derive(Debug, Default)]
pub struct RuntimeSampleCache {
    pub snapshot: Option<SystemSnapshot>,
    pub realtime: Option<SystemRealtimeSnapshot>,
    pub last_sample_mode: Option<String>,
    pub last_sampled_at_ms: u64,
}

#[derive(Clone, Default)]
pub struct AppRuntimeState {
    pub inner: Arc<RwLock<RuntimeSampleCache>>,
}

impl AppRuntimeState {
    pub fn get_snapshot(&self) -> Option<SystemSnapshot> {
        self.inner.read().ok().and_then(|cache| cache.snapshot.clone())
    }

    pub fn get_realtime(&self) -> Option<SystemRealtimeSnapshot> {
        self.inner.read().ok().and_then(|cache| cache.realtime.clone())
    }

    pub fn update_snapshot(&self, mut snapshot: SystemSnapshot, sample_mode: &str, is_stale: bool) {
        snapshot.sample_mode = Some(sample_mode.to_string());
        snapshot.sampled_at_ms = Some(current_timestamp_ms());
        snapshot.is_stale = Some(is_stale);

        let mut realtime = SystemRealtimeSnapshot {
            uptime_seconds: snapshot.uptime_seconds,
            cpu_usage_percent: snapshot.cpu_usage_percent,
            total_memory_gb: snapshot.total_memory_gb,
            used_memory_gb: snapshot.used_memory_gb,
            memory_usage_percent: snapshot.memory_usage_percent,
            sample_mode: snapshot.sample_mode.clone(),
            sampled_at_ms: snapshot.sampled_at_ms,
            is_stale: snapshot.is_stale,
        };

        if let Ok(mut cache) = self.inner.write() {
            cache.last_sample_mode = Some(sample_mode.to_string());
            cache.last_sampled_at_ms = snapshot.sampled_at_ms.unwrap_or_default();
            cache.snapshot = Some(snapshot);
            realtime.sampled_at_ms = Some(cache.last_sampled_at_ms);
            cache.realtime = Some(realtime);
        }
    }

    pub fn update_realtime(&self, mut realtime: SystemRealtimeSnapshot, sample_mode: &str, is_stale: bool) {
        realtime.sample_mode = Some(sample_mode.to_string());
        realtime.sampled_at_ms = Some(current_timestamp_ms());
        realtime.is_stale = Some(is_stale);

        if let Ok(mut cache) = self.inner.write() {
            cache.last_sample_mode = Some(sample_mode.to_string());
            cache.last_sampled_at_ms = realtime.sampled_at_ms.unwrap_or_default();

            if let Some(snapshot) = cache.snapshot.as_mut() {
                snapshot.cpu_usage_percent = realtime.cpu_usage_percent;
                snapshot.total_memory_gb = realtime.total_memory_gb;
                snapshot.used_memory_gb = realtime.used_memory_gb;
                snapshot.memory_usage_percent = realtime.memory_usage_percent;
                snapshot.uptime_seconds = realtime.uptime_seconds;
                snapshot.sample_mode = realtime.sample_mode.clone();
                snapshot.sampled_at_ms = realtime.sampled_at_ms;
                snapshot.is_stale = realtime.is_stale;
            }

            cache.realtime = Some(realtime);
        }
    }
}

pub fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

pub fn spawn_system_sampling_workers<F1, F2>(
    runtime_state: AppRuntimeState,
    query_realtime_quick: F1,
    query_snapshot_precise: F2,
) where
    F1: Fn() -> Result<SystemRealtimeSnapshot, String> + Send + 'static,
    F2: Fn() -> Result<SystemSnapshot, String> + Send + 'static,
{
    let quick_state = runtime_state.clone();
    thread::spawn(move || loop {
        match query_realtime_quick() {
            Ok(realtime) => quick_state.update_realtime(realtime, "quick", false),
            Err(_) => {
                if let Some(mut stale) = quick_state.get_realtime() {
                    stale.is_stale = Some(true);
                    quick_state.update_realtime(stale, "quick", true);
                }
            }
        }

        thread::sleep(Duration::from_secs(1));
    });

    let precise_state = runtime_state.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(500));
        loop {
            if let Ok(snapshot) = query_snapshot_precise() {
                precise_state.update_snapshot(snapshot, "precise", false);
            }

            thread::sleep(Duration::from_secs(10));
        }
    });
}
