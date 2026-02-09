use encoding_rs::GBK;
use std::fmt::Display;
use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone)]
pub struct ProcessCapture {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub fn run_command_with_timeout(
    command: &str,
    args: &[&str],
    timeout_ms: u64,
) -> Result<String, String> {
    let string_args: Vec<String> = args.iter().map(|item| (*item).to_string()).collect();
    let output = execute_process_with_timeout(command, &string_args, timeout_ms)?;

    if output.exit_code == 0 {
        if output.stdout.is_empty() {
            Ok(output.stderr)
        } else {
            Ok(output.stdout)
        }
    } else {
        let detail = if output.stderr.is_empty() {
            output.stdout
        } else {
            output.stderr
        };

        Err(format!("执行命令失败（返回码 {}）：{}", output.exit_code, detail))
    }
}

pub fn execute_process_with_timeout(
    command: &str,
    args: &[String],
    timeout_ms: u64,
) -> Result<ProcessCapture, String> {
    let mut child = create_command(command)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(display_error)?;

    let timeout = Duration::from_millis(timeout_ms.max(1));
    let started_at = Instant::now();

    loop {
        match child.try_wait().map_err(display_error)? {
            Some(status) => {
                let mut stdout_bytes = Vec::new();
                let mut stderr_bytes = Vec::new();

                if let Some(mut stdout) = child.stdout.take() {
                    let _ = stdout.read_to_end(&mut stdout_bytes);
                }

                if let Some(mut stderr) = child.stderr.take() {
                    let _ = stderr.read_to_end(&mut stderr_bytes);
                }

                return Ok(ProcessCapture {
                    stdout: decode_bytes(&stdout_bytes),
                    stderr: decode_bytes(&stderr_bytes),
                    exit_code: status.code().unwrap_or(-1),
                });
            }
            None => {
                if started_at.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();

                    let mut stdout_bytes = Vec::new();
                    let mut stderr_bytes = Vec::new();

                    if let Some(mut stdout) = child.stdout.take() {
                        let _ = stdout.read_to_end(&mut stdout_bytes);
                    }

                    if let Some(mut stderr) = child.stderr.take() {
                        let _ = stderr.read_to_end(&mut stderr_bytes);
                    }

                    let stdout = decode_bytes(&stdout_bytes);
                    let stderr = decode_bytes(&stderr_bytes);
                    let mut details = format!("命令执行超时（{}ms）：{} {}", timeout_ms, command, args.join(" "));

                    if !stdout.is_empty() {
                        details.push_str(&format!("\n[stdout]\n{}", stdout));
                    }

                    if !stderr.is_empty() {
                        details.push_str(&format!("\n[stderr]\n{}", stderr));
                    }

                    return Err(details);
                }

                thread::sleep(Duration::from_millis(20));
            }
        }
    }
}

fn create_command(command: &str) -> Command {
    let mut process = Command::new(command);

    #[cfg(target_os = "windows")]
    {
        process.creation_flags(CREATE_NO_WINDOW);
    }

    process
}

fn decode_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    if let Ok(decoded) = std::str::from_utf8(bytes) {
        return decoded.trim().to_string();
    }

    let (gbk_decoded, _, had_errors) = GBK.decode(bytes);
    if !had_errors {
        return gbk_decoded.trim().to_string();
    }

    String::from_utf8_lossy(bytes).trim().to_string()
}

fn display_error<E: Display>(error: E) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execute_process_with_timeout_success() {
        let capture = execute_process_with_timeout(
            "powershell",
            &[
                "-NoProfile".to_string(),
                "-Command".to_string(),
                "Write-Output 'ok'".to_string(),
            ],
            2_000,
        )
        .expect("should execute");

        assert_eq!(capture.exit_code, 0);
        assert!(capture.stdout.to_lowercase().contains("ok"));
    }

    #[test]
    fn execute_process_with_timeout_timeout() {
        let result = execute_process_with_timeout(
            "powershell",
            &[
                "-NoProfile".to_string(),
                "-Command".to_string(),
                "Start-Sleep -Seconds 2; Write-Output 'done'".to_string(),
            ],
            200,
        );

        assert!(result.is_err());
        assert!(result.err().unwrap_or_default().contains("命令执行超时"));
    }
}

