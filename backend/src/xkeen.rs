use serde::Serialize;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::process::Command;

const INFO_FILE: &str = "/opt/sbin/.xkeen/01_info/01_info_variable.sh";
const INIT_DIR: &str = "/opt/etc/init.d";
const ALLOWED_CLIENTS: [&str; 2] = ["mihomo", "xray"];
const SERVICE_STATE_TIMEOUT: usize = 60;
const MAX_INIT_OUTPUT_BYTES: usize = 16 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XkeenStatus {
    pub installed: bool,
    pub running: Option<bool>,
    pub version: Option<String>,
    pub core: Option<String>,
    pub init_path: Option<String>,
    pub detail: String,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlRequest {
    pub action: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct ProcessIdentity {
    pid: u32,
    start_ticks: u64,
}

pub fn read_status() -> XkeenStatus {
    let info = fs::read_to_string(INFO_FILE).ok();
    let init_path = info
        .as_deref()
        .and_then(resolve_init_path)
        .or_else(fallback_init_path);
    let version = info
        .as_deref()
        .and_then(|text| shell_assignment(text, "xkeen_current_version"))
        .filter(|value| !value.is_empty() && value.len() <= 64);
    let init_contents = init_path
        .as_deref()
        .and_then(|path| fs::read_to_string(path).ok());
    let core = init_contents
        .as_deref()
        .and_then(|text| shell_assignment(text, "name_client"))
        .or_else(|| {
            init_path
                .as_deref()
                .filter(|path| path.ends_with("/S24xray"))
                .map(|_| "xray".to_owned())
        })
        .filter(|value| ALLOWED_CLIENTS.contains(&value.as_str()));

    let installed = init_path
        .as_deref()
        .is_some_and(|path| executable_file(Path::new(path)));
    let running = if installed {
        core.as_deref().map(process_is_running)
    } else {
        None
    };
    let detail = match (installed, running) {
        (false, _) => "Не найден штатный init-файл XKeen".to_owned(),
        (true, Some(true)) => "Процесс ядра обнаружен".to_owned(),
        (true, Some(false)) => "Процесс ядра не обнаружен".to_owned(),
        (true, None) => "Не удалось определить активное ядро".to_owned(),
    };

    XkeenStatus {
        installed,
        running,
        version,
        core,
        init_path,
        detail,
    }
}

pub async fn control(action: &str) -> Result<XkeenStatus, String> {
    let before = read_status();
    let action_name = match action {
        "start" | "stop" | "restart" => action,
        _ => "invalid",
    };
    let before_processes = before
        .core
        .as_deref()
        .map(process_identities)
        .unwrap_or_default();
    let path = before.init_path.as_deref().filter(|_| before.installed);
    let result = match control_args(action) {
        Err(error) => Err(error),
        Ok(args) => match path {
            None => Err("Не найден исполняемый init-файл XKeen".to_owned()),
            Some(path) => match execute_init_command(
                Path::new(path),
                args,
                Path::new(crate::logs::XKEEN_UI_LOG_PATH),
            )
            .await
            {
                Err(error) => Err(error),
                Ok(()) => {
                    let mut confirmed = None;
                    for _ in 0..SERVICE_STATE_TIMEOUT {
                        let current = before
                            .core
                            .as_deref()
                            .map(process_identities)
                            .unwrap_or_default();
                        if process_transition_verified(action, &before_processes, &current) {
                            confirmed = Some(read_status());
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                    confirmed.ok_or_else(|| {
                        let current = read_status();
                        format!(
                            "Команда XKeen завершилась успешно, но действие не подтверждено: {}",
                            current.detail
                        )
                    })
                }
            },
        },
    };
    let after = read_status();
    let after_processes = after
        .core
        .as_deref()
        .map(process_identities)
        .unwrap_or_default();
    let result = require_verified_transition(action, result, &before_processes, &after_processes);
    let verified = result.is_ok();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if !verified {
        let error_event = format!(
            "unix={timestamp} level=ERROR component=xkeen action={action_name} running_before={} running_after={} message={}",
            display_running(before.running),
            display_running(after.running),
            result.as_ref().err().map(String::as_str).unwrap_or("transition was not verified"),
        );
        if let Err(error) = crate::logs::append_xkeen_lifecycle(&[error_event]) {
            tracing::warn!(%error, "Could not append XKeen control error to Error Log");
        }
    }
    result.map(|_| after)
}

fn require_verified_transition<T>(
    action: &str,
    result: Result<T, String>,
    before: &[ProcessIdentity],
    after: &[ProcessIdentity],
) -> Result<T, String> {
    match result {
        Ok(value) if process_transition_verified(action, before, after) => Ok(value),
        Ok(_) => Err(format!(
            "Команда XKeen завершилась, но переход процесса для действия {action} не подтверждён"
        )),
        Err(error) => Err(error),
    }
}

fn display_running(running: Option<bool>) -> &'static str {
    match running {
        Some(true) => "true",
        Some(false) => "false",
        None => "unknown",
    }
}

fn process_transition_verified(
    action: &str,
    before: &[ProcessIdentity],
    after: &[ProcessIdentity],
) -> bool {
    match action {
        "start" => !after.is_empty(),
        "stop" => after.is_empty(),
        "restart" => {
            !after.is_empty()
                && (before.is_empty() || before.iter().all(|identity| !after.contains(identity)))
        }
        _ => false,
    }
}

async fn execute_init_command(path: &Path, args: &[&str], log_path: &Path) -> Result<(), String> {
    let output = spawn_output_helper(log_path)
        .map_err(|error| format!("Не удалось подготовить журнал XKeen: {error}"))?;
    let stderr = output.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(path);
    command
        .args(args)
        .kill_on_drop(true)
        .env_clear()
        .env("PATH", "/opt/sbin:/opt/bin:/sbin:/bin:/usr/sbin:/usr/bin")
        .stdin(Stdio::null())
        .stdout(Stdio::from(std::os::fd::OwnedFd::from(output)))
        .stderr(Stdio::from(std::os::fd::OwnedFd::from(stderr)))
        .env("HOME", "/root")
        .env("TERM", "dumb");
    let mut child = command.spawn()
        .map_err(|error| format!("Не удалось выполнить {}: {error}", path.display()))?;
    let status = tokio::time::timeout(Duration::from_secs(30), child.wait()).await
        .map_err(|_| "Команда XKeen не завершилась за 30 секунд".to_owned())?
        .map_err(|error| format!("Не удалось выполнить {}: {error}", path.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("XKeen завершил команду с кодом {status}"))
    }
}

fn spawn_output_helper(log_path: &Path) -> std::io::Result<std::os::unix::net::UnixStream> {
    use std::io::Read;
    let (mut writer, reader) = std::os::unix::net::UnixStream::pair()?;
    let mut command = std::process::Command::new(std::env::current_exe()?);
    #[cfg(not(test))]
    command.arg("--internal-xkeen-output").arg(log_path);
    #[cfg(test)]
    command.args(["--exact", "xkeen::tests::output_helper_subprocess", "--nocapture"])
        .env("XKEEN_UI_OUTPUT_HELPER_LOG", log_path);
    command.stdin(Stdio::from(std::os::fd::OwnedFd::from(reader)))
        .stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = command.spawn()?;
    writer.set_read_timeout(Some(Duration::from_secs(2)))?;
    let mut ready = [0_u8];
    if let Err(error) = writer.read_exact(&mut ready) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    writer.set_read_timeout(None)?;
    if ready != [1] {
        let _ = child.kill();
        let _ = child.wait();
        return Err(std::io::Error::other("output helper did not become ready"));
    }
    // Reap on natural EOF without tying the helper's lifetime to the panel.
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok(writer)
}

pub(super) fn run_output_helper(log_path: &Path) -> std::io::Result<()> {
    use std::{io::Write, os::fd::FromRawFd};
    unsafe extern "C" {
        fn setsid() -> std::os::raw::c_int;
        fn prctl(option: std::os::raw::c_int, ...) -> std::os::raw::c_int;
    }
    // SAFETY: no pointer arguments to setsid; PR_SET_NAME reads a static,
    // NUL-terminated string. The internal child exclusively owns descriptor 0.
    if unsafe { setsid() } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    if unsafe { prctl(15, c"xkeen-logdrain".as_ptr(), 0, 0, 0) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let mut input = unsafe { fs::File::from_raw_fd(0) };
    input.write_all(&[1])?;
    drain_init_output(&mut input, log_path)
}

fn drain_init_output(input: &mut impl std::io::Read, log_path: &Path) -> std::io::Result<()> {
    let mut buffer = [0_u8; 4096];
    let mut pending = Vec::new();
    let mut remaining_input = MAX_INIT_OUTPUT_BYTES;
    let mut remaining_write = MAX_INIT_OUTPUT_BYTES;
    loop {
        let count = match input.read(&mut buffer) {
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            result => result?,
        };
        if count == 0 {
            if !pending.is_empty() {
                persist_init_output_line(&pending, log_path, &mut remaining_write);
            }
            return Ok(());
        }
        let retained = count.min(remaining_input);
        remaining_input -= retained;
        for byte in &buffer[..retained] {
            if *byte == b'\n' {
                persist_init_output_line(&pending, log_path, &mut remaining_write);
                pending.clear();
            } else {
                pending.push(*byte);
            }
        }
        if remaining_input == 0 && !pending.is_empty() {
            persist_init_output_line(&pending, log_path, &mut remaining_write);
            pending.clear();
        }
        // Past the capture budget continue draining until all inherited writers
        // close. No raw output files, unbounded buffers, or journal growth.
    }
}

fn persist_init_output_line(bytes: &[u8], log_path: &Path, remaining: &mut usize) {
    if *remaining < 2 { return; }
    let clean = crate::logs::sanitize_line(&String::from_utf8_lossy(bytes));
    if clean.trim().is_empty() { return; }
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let mut entry = format!("unix={timestamp} {clean}");
    let mut end = entry.len().min(4096).min(*remaining - 1);
    while !entry.is_char_boundary(end) { end -= 1; }
    entry.truncate(end);
    *remaining -= entry.len() + 1;
    // Persistence failure must not close the drain and break the core's writer.
    let _ = crate::logs::append_log_file(log_path, &[entry]);
}

fn control_args(action: &str) -> Result<&'static [&'static str], String> {
    match action {
        "start" => Ok(&["start", "on"]),
        "stop" => Ok(&["stop"]),
        "restart" => Ok(&["restart", "on"]),
        _ => Err("Допустимы только start, stop и restart".to_owned()),
    }
}

fn process_is_running(name: &str) -> bool {
    !process_identities(name).is_empty()
}

fn process_identities(name: &str) -> Vec<ProcessIdentity> {
    let mut identities = fs::read_dir("/proc")
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let pid = entry.file_name().to_str()?.parse::<u32>().ok()?;
            let comm = fs::read_to_string(entry.path().join("comm")).ok()?;
            if comm.trim() != name {
                return None;
            }
            let stat = fs::read_to_string(entry.path().join("stat")).ok()?;
            let start_ticks = process_start_ticks(&stat)?;
            Some(ProcessIdentity { pid, start_ticks })
        })
        .collect::<Vec<_>>();
    identities.sort_unstable();
    identities
}

fn process_start_ticks(stat: &str) -> Option<u64> {
    let comm_end = stat.rfind(')')?;
    stat[comm_end + 1..]
        .split_whitespace()
        .nth(19)?
        .parse()
        .ok()
}

fn executable_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| {
        metadata.is_file()
            && !metadata.file_type().is_symlink()
            && metadata.permissions().mode() & 0o111 != 0
    })
}

fn resolve_init_path(info: &str) -> Option<String> {
    let dir = shell_assignment(info, "initd_dir")?;
    let file = shell_assignment(info, "initd_file")?;
    let resolved = file.replace("$initd_dir", &dir);
    let path = if Path::new(&resolved).is_absolute() {
        PathBuf::from(resolved)
    } else {
        PathBuf::from(dir).join(resolved)
    };
    safe_init_path(&path).then(|| path.to_string_lossy().into_owned())
}

fn fallback_init_path() -> Option<String> {
    [
        PathBuf::from("/opt/etc/init.d/S05xkeen"),
        PathBuf::from("/opt/etc/init.d/S99xkeen"),
    ]
    .into_iter()
    .find(|path| executable_file(path))
    .map(|path| path.to_string_lossy().into_owned())
}

fn safe_init_path(path: &Path) -> bool {
    path.parent() == Some(Path::new(INIT_DIR))
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.starts_with('S')
                    && name.len() <= 128
                    && name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
            })
}

fn shell_assignment(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (name, raw) = line.split_once('=')?;
        if name.trim() != key {
            return None;
        }
        let value = raw.split('#').next()?.trim();
        let value = value.trim_matches(|character| character == '\'' || character == '"');
        (!value.is_empty() && value.len() <= 512).then(|| value.to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::{
        control_args, execute_init_command, process_start_ticks, process_transition_verified,
        require_verified_transition, resolve_init_path, safe_init_path, shell_assignment,
        ProcessIdentity,
    };
    use std::{
        os::unix::fs::PermissionsExt,
        path::Path,
        time::{Duration, Instant},
    };

    #[test]
    fn reads_xkeen_config_without_sourcing_shell() {
        let text = "initd_dir=\"/opt/etc/init.d\" # dir\ninitd_file=\"$initd_dir/S05xkeen\"\nxkeen_current_version=2.1";
        assert_eq!(
            resolve_init_path(text).as_deref(),
            Some("/opt/etc/init.d/S05xkeen")
        );
        assert_eq!(
            shell_assignment(text, "xkeen_current_version").as_deref(),
            Some("2.1")
        );
    }

    #[test]
    fn rejects_init_paths_outside_the_entware_init_directory() {
        assert!(!safe_init_path(Path::new("/tmp/evil")));
        assert!(!safe_init_path(Path::new("/opt/etc/init.d/../../tmp/evil")));
        assert!(safe_init_path(Path::new("/opt/etc/init.d/S05xkeen")));
    }

    #[test]
    fn maps_service_actions_to_supported_init_commands() {
        assert_eq!(control_args("start").unwrap(), &["start", "on"]);
        assert_eq!(control_args("stop").unwrap(), &["stop"]);
        assert_eq!(control_args("restart").unwrap(), &["restart", "on"]);
        assert!(control_args("invalid").is_err());
    }

    #[test]
    fn restart_requires_a_new_process_identity() {
        let old = ProcessIdentity {
            pid: 321,
            start_ticks: 900,
        };
        assert!(!process_transition_verified("restart", &[old], &[old]));
    }

    #[test]
    fn restart_accepts_a_replaced_process_and_start_from_stopped_state() {
        let old = ProcessIdentity {
            pid: 321,
            start_ticks: 900,
        };
        let new = ProcessIdentity {
            pid: 321,
            start_ticks: 901,
        };
        assert!(process_transition_verified("restart", &[old], &[new]));
        assert!(process_transition_verified("restart", &[], &[new]));
    }

    #[test]
    fn start_and_stop_require_the_expected_process_presence() {
        let identity = ProcessIdentity {
            pid: 321,
            start_ticks: 900,
        };
        assert!(process_transition_verified("start", &[], &[identity]));
        assert!(!process_transition_verified("start", &[], &[]));
        assert!(process_transition_verified("stop", &[identity], &[]));
        assert!(!process_transition_verified(
            "stop",
            &[identity],
            &[identity]
        ));
    }

    #[test]
    fn refuses_to_return_success_when_final_restart_transition_is_unverified() {
        let identity = ProcessIdentity {
            pid: 321,
            start_ticks: 900,
        };
        let result = require_verified_transition("restart", Ok(()), &[identity], &[identity]);
        assert!(result.unwrap_err().contains("не подтверждён"));
    }

    #[test]
    fn preserves_command_failure_when_transition_is_unverified() {
        let identity = ProcessIdentity {
            pid: 321,
            start_ticks: 900,
        };
        let result = require_verified_transition(
            "restart",
            Err::<(), _>("XKeen завершил команду с кодом 1".to_owned()),
            &[identity],
            &[identity],
        );
        assert_eq!(result.unwrap_err(), "XKeen завершил команду с кодом 1");
    }

    #[test]
    fn parses_process_start_time_after_comm_with_spaces_and_parentheses() {
        let fields = std::iter::once("S")
            .chain(std::iter::repeat_n("0", 18))
            .chain(std::iter::once("98765"))
            .collect::<Vec<_>>()
            .join(" ");
        let stat = format!("42 (mihomo (worker)) {fields}");
        assert_eq!(process_start_ticks(&stat), Some(98765));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn init_command_does_not_wait_for_a_background_daemon() {
        let path =
            std::env::temp_dir().join(format!("xkeen-ui-control-test-{}.sh", std::process::id()));
        std::fs::write(&path, "#!/bin/sh\n(sleep 2) &\nexit 0\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();

        let started = Instant::now();
        let log = path.with_extension("log");
        let result = execute_init_command(&path, &["restart", "on"], &log).await;
        let elapsed = started.elapsed();
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&log);

        assert!(result.is_ok());
        assert!(elapsed < Duration::from_millis(1_500));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn persists_actual_init_output_even_when_the_command_fails() {
        let path = std::env::temp_dir().join(format!(
            "xkeen-ui-control-output-{}.sh",
            std::process::id()
        ));
        let log = path.with_extension("log");
        std::fs::write(&path, "#!/bin/sh\nprintf '\\033[32mПрокси-клиент запущен в режиме Hybrid\\033[0m\\n'\nprintf 'failure token=private token=second-private\\n' >&2\n(sleep 2) &\nexit 1\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        let started = Instant::now();
        let result = execute_init_command(&path, &["restart", "on"], &log).await;
        let deadline = Instant::now() + Duration::from_millis(500);
        let contents = loop {
            let contents = std::fs::read_to_string(&log).unwrap_or_default();
            if contents.contains("failure token=[REDACTED] token=[REDACTED]") || Instant::now() >= deadline {
                break contents;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        };
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&log);
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_millis(1_500));
        assert!(contents.contains("Прокси-клиент запущен в режиме Hybrid"));
        assert!(contents.contains("failure token=[REDACTED]"));
        assert!(!contents.contains("private"));
        assert!(!contents.contains('\u{001b}'));
    }

    #[test]
    fn output_helper_subprocess() {
        if let Some(path) = std::env::var_os("XKEEN_UI_OUTPUT_HELPER_LOG") {
            super::run_output_helper(Path::new(&path)).unwrap();
        }
    }

    #[test]
    fn drains_excess_output_without_growing_the_journal_or_creating_raw_files() {
        let directory = std::env::temp_dir().join(format!("xkeen-ui-drain-bounds-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let log = directory.join("journal.log");
        let data = "token=first token=second output line\n".repeat(10_000).into_bytes();
        let mut input = data.as_slice();
        super::drain_init_output(&mut input, &log).unwrap();
        assert!(input.is_empty());
        let contents = std::fs::read_to_string(&log).unwrap();
        assert!(!contents.contains("first"));
        assert!(!contents.contains("second"));
        assert!(contents.len() <= 16_384);
        assert!(contents.contains("token=[REDACTED] token=[REDACTED]"));
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        let _ = std::fs::remove_file(log);
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn init_output_survives_capture_process_exit() {
        const CHILD_ENV: &str = "XKEEN_UI_CAPTURE_EXIT_TEST";
        if let Some(directory) = std::env::var_os(CHILD_ENV) {
            let directory = std::path::PathBuf::from(directory);
            let script = directory.join("init.sh");
            let marker = directory.join("survived");
            let log = directory.join("journal.log");
            let result = tokio::runtime::Runtime::new().unwrap().block_on(
                execute_init_command(&script, &[marker.to_str().unwrap()], &log),
            );
            std::process::exit(if result.is_ok() { 0 } else { 1 });
        }
        let directory = std::env::temp_dir().join(format!("xkeen-ui-capture-exit-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let script = directory.join("init.sh");
        std::fs::write(&script, "#!/bin/sh\n(sleep 1; printf 'late daemon output\\n' || exit 1; printf survived > \"$1\") &\nexit 0\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "xkeen::tests::init_output_survives_capture_process_exit", "--nocapture"])
            .env(CHILD_ENV, &directory)
            .status().unwrap();
        assert!(status.success());
        let marker = directory.join("survived");
        let log = directory.join("journal.log");
        let deadline = Instant::now() + Duration::from_secs(4);
        while (!marker.exists() || !std::fs::read_to_string(&log).unwrap_or_default().contains("late daemon output")) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(std::fs::read_to_string(&marker).unwrap(), "survived");
        assert!(std::fs::read_to_string(&log).unwrap().contains("late daemon output"));
        let _ = std::fs::remove_file(marker);
        let _ = std::fs::remove_file(script);
        let _ = std::fs::remove_file(directory.join("journal.log"));
        std::fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn allows_only_supported_core_names() {
        let text = "name_client=../../busybox";
        let value = shell_assignment(text, "name_client").unwrap();
        assert!(!super::ALLOWED_CLIENTS.contains(&value.as_str()));
        assert!(super::ALLOWED_CLIENTS.contains(&"mihomo"));
    }
}
