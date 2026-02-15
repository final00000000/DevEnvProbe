use rayon::prelude::*;
use serde::Serialize;
use std::future::Future;
use std::time::Instant;
use tauri::{AppHandle, LogicalSize, Manager, Size};

mod process_runner;
mod contracts;
mod runtime;
mod system;
mod tools;
mod docker;
mod deploy;
mod install;
mod version;

use contracts::*;
use runtime::*;
use system::*;
use tools::*;
use docker::*;
use deploy::*;
use install::*;
use version::*;

#[tauri::command]
async fn get_system_snapshot(app: AppHandle) -> CommandResponse<SystemSnapshot> {
    let runtime_state = app.state::<AppRuntimeState>().inner().clone();

    with_timing_async(async move {
        if let Some(snapshot) = runtime_state.get_snapshot() {
            return Ok(snapshot);
        }

        match run_blocking(query_system_snapshot_quick).await {
            Ok(snapshot) => {
                runtime_state.update_snapshot(snapshot.clone(), "quick", false);
                Ok(snapshot)
            }
            Err(error) => {
                if let Some(mut snapshot) = runtime_state.get_snapshot() {
                    snapshot.is_stale = Some(true);
                    return Ok(snapshot);
                }

                let mut snapshot = build_placeholder_snapshot();
                snapshot.is_stale = Some(true);
                snapshot.sample_mode = Some("quick".to_string());
                snapshot.sampled_at_ms = Some(current_timestamp_ms());
                let _ = error;
                Ok(snapshot)
            }
        }
    })
    .await
}

#[tauri::command]
async fn get_system_realtime(app: AppHandle) -> CommandResponse<SystemRealtimeSnapshot> {
    let runtime_state = app.state::<AppRuntimeState>().inner().clone();

    with_timing_async(async move {
        if let Some(realtime) = runtime_state.get_realtime() {
            return Ok(realtime);
        }

        match run_blocking(query_system_realtime_quick).await {
            Ok(realtime) => {
                runtime_state.update_realtime(realtime.clone(), "quick", false);
                Ok(realtime)
            }
            Err(error) => {
                if let Some(mut realtime) = runtime_state.get_realtime() {
                    realtime.is_stale = Some(true);
                    return Ok(realtime);
                }

                let mut realtime = build_placeholder_realtime();
                realtime.is_stale = Some(true);
                realtime.sample_mode = Some("quick".to_string());
                realtime.sampled_at_ms = Some(current_timestamp_ms());
                let _ = error;
                Ok(realtime)
            }
        }
    })
    .await
}

#[tauri::command]
async fn detect_dev_tools() -> CommandResponse<Vec<ToolStatus>> {
    with_timing_async(async {
        let tools = run_blocking(detect_dev_tools_parallel).await?;
        Ok(tools)
    })
    .await
}

fn detect_dev_tools_parallel() -> Result<Vec<ToolStatus>, String> {
    let max_workers = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4)
        .min(8);

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(max_workers)
        .build()
        .map_err(|error| format!("初始化工具探测线程池失败: {}", error))?;

    let tools = pool.install(|| default_tool_specs().par_iter().map(detect_tool).collect::<Vec<_>>());
    Ok(tools)
}

#[tauri::command]
async fn run_docker_action(action: String, target: Option<String>) -> CommandResponse<DockerCommandResult> {
    with_timing_async(async move {
        run_blocking(move || execute_docker_action(&action, target.as_deref(), docker::DOCKER_ACTION_TIMEOUT_MS)).await
    })
    .await
}

#[tauri::command]
async fn get_docker_overview_batch(mode: String) -> CommandResponse<Vec<DockerCommandResult>> {
    with_timing_async(async move { run_blocking(move || execute_docker_overview_batch(&mode)).await }).await
}

#[tauri::command]
async fn list_git_branches(project_path: String) -> CommandResponse<Vec<String>> {
    with_timing_async(async move { run_blocking(move || list_git_branches_internal(&project_path)).await }).await
}

#[tauri::command]
async fn execute_deploy_step(request: DeployStepRequest) -> CommandResponse<DeployStepResult> {
    with_timing_async(async move { run_blocking(move || execute_deploy_step_internal(&request)).await }).await
}

#[tauri::command]
async fn install_market_item(item_key: String, install_path: Option<String>) -> CommandResponse<InstallResult> {
    with_timing_async(async move {
        run_blocking(move || execute_install_item(&item_key, install_path.as_deref())).await
    })
    .await
}

#[tauri::command]
async fn uninstall_market_item(item_key: String) -> CommandResponse<UninstallResult> {
    with_timing_async(async move {
        run_blocking(move || execute_uninstall_item(&item_key)).await
    })
    .await
}

#[tauri::command]
async fn pick_install_directory() -> CommandResponse<Option<String>> {
    with_timing_async(async { run_blocking(select_install_directory).await }).await
}

#[tauri::command]
async fn pick_project_directory() -> CommandResponse<Option<String>> {
    with_timing_async(async { run_blocking(select_project_directory).await }).await
}

#[tauri::command]
async fn validate_path(path: String) -> CommandResponse<PathValidationResult> {
    with_timing_async(async move {
        run_blocking(move || validate_install_path(&path)).await
    })
    .await
}

#[tauri::command]
async fn check_winget_prerequisite() -> CommandResponse<WingetStatus> {
    with_timing_async(async {
        run_blocking(check_winget_available).await
    })
    .await
}

#[tauri::command]
async fn install_app_installer_auto() -> CommandResponse<InstallResult> {
    with_timing_async(async {
        run_blocking(install_app_installer).await
    })
    .await
}

// ============================================================================
// Version Management Commands
// ============================================================================

#[tauri::command]
async fn check_image_version(
    app: AppHandle,
    request: CheckImageVersionRequest,
) -> CommandResponse<CheckImageVersionResponse> {
    let version_state = app.state::<VersionRuntimeState>().inner().clone();

    with_timing_async(async move {
        version::check_image_version(request, &version_state)
            .await
            .map_err(|e| e.user_message())
    })
    .await
}

#[tauri::command]
async fn update_image_and_restart(
    app: AppHandle,
    request: UpdateImageAndRestartRequest,
) -> CommandResponse<UpdateImageAndRestartResponse> {
    let version_state = app.state::<VersionRuntimeState>().inner().clone();
    let image_key = format!("{}:{}", request.image.repository, request.image.tag);

    with_timing_async(async move {
        // Try to acquire lock
        version_state.try_lock_update(image_key.clone(), request.operation_id.clone().unwrap_or_else(|| "default".to_string()))?;

        let result = run_blocking(move || {
            version::update_image_and_restart(request)
                .map_err(|e| e.user_message())
        }).await;

        // Release lock
        version_state.unlock_update(&image_key);

        result
    })
    .await
}

async fn with_timing_async<T, Fut>(operation: Fut) -> CommandResponse<T>
where
    T: Serialize,
    Fut: Future<Output = Result<T, String>>,
{
    let start = Instant::now();
    match operation.await {
        Ok(data) => CommandResponse {
            ok: true,
            data: Some(data),
            error: None,
            elapsed_ms: start.elapsed().as_millis(),
        },
        Err(error) => CommandResponse {
            ok: false,
            data: None,
            error: Some(error),
            elapsed_ms: start.elapsed().as_millis(),
        },
    }
}

async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("后台任务执行失败: {}", error))?
}

fn adapt_main_window_for_monitor(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();

        if let Ok(Some(monitor)) = window.current_monitor() {
            let size = monitor.size();
            let target_width = ((size.width as f64) * 0.78).clamp(980.0, 1800.0);
            let target_height = ((size.height as f64) * 0.82).clamp(680.0, 1260.0);

            let _ = window.set_size(Size::Logical(LogicalSize::new(target_width, target_height)));
            let _ = window.center();
            return;
        }

        let _ = window.center();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppRuntimeState::default())
        .manage(VersionRuntimeState::new())
        .setup(|app| {
            adapt_main_window_for_monitor(app.handle());

            let runtime_state = app.state::<AppRuntimeState>().inner().clone();
            spawn_system_sampling_workers(
                runtime_state,
                query_system_realtime_quick,
                query_system_snapshot_precise,
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_snapshot,
            get_system_realtime,
            detect_dev_tools,
            run_docker_action,
            get_docker_overview_batch,
            list_git_branches,
            execute_deploy_step,
            install_market_item,
            uninstall_market_item,
            pick_install_directory,
            pick_project_directory,
            validate_path,
            check_winget_prerequisite,
            install_app_installer_auto,
            check_image_version,
            update_image_and_restart,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_state_should_keep_latest_snapshot_and_realtime() {
        let state = AppRuntimeState::default();
        let snapshot = SystemSnapshot {
            host_name: "host".to_string(),
            os_name: "Windows".to_string(),
            os_version: "10".to_string(),
            build_number: "19045".to_string(),
            architecture: "x64".to_string(),
            uptime_seconds: 100,
            cpu_model: "cpu".to_string(),
            cpu_cores: 4,
            cpu_logical_cores: 8,
            cpu_usage_percent: 12.5,
            total_memory_gb: 16.0,
            used_memory_gb: 6.0,
            memory_usage_percent: 37.5,
            disks: Vec::new(),
            sample_mode: None,
            sampled_at_ms: None,
            is_stale: None,
        };

        state.update_snapshot(snapshot, "quick", false);

        let realtime = state.get_realtime().expect("realtime should exist");
        assert_eq!(realtime.uptime_seconds, 100);
        assert_eq!(realtime.sample_mode.as_deref(), Some("quick"));

        let latest_snapshot = state.get_snapshot().expect("snapshot should exist");
        assert_eq!(latest_snapshot.sample_mode.as_deref(), Some("quick"));
        assert_eq!(latest_snapshot.is_stale, Some(false));
    }

    #[test]
    fn docker_batch_should_return_partial_results_when_command_missing() {
        let results = execute_docker_overview_batch("quick").expect("batch call should not hard fail");
        assert!(!results.is_empty());
        assert!(results.iter().all(|item| !item.action.is_empty()));
    }
}
