use serde::Serialize;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::process::Command;

const INFO_FILE: &str = "/opt/sbin/.xkeen/01_info/01_info_variable.sh";
const INIT_DIR: &str = "/opt/etc/init.d";
const ALLOWED_CLIENTS: [&str; 2] = ["mihomo", "xray"];

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
    let status = read_status();
    let path = status
        .init_path
        .as_deref()
        .filter(|_| status.installed)
        .ok_or_else(|| "Не найден исполняемый init-файл XKeen".to_owned())?;
    let args: &[&str] = match action {
        "start" => &["start"],
        "stop" => &["stop"],
        "restart" => &["restart"],
        _ => return Err("Допустимы только start, stop и restart".to_owned()),
    };

    let mut command = Command::new(path);
    command
        .args(args)
        .env_clear()
        .env("PATH", "/opt/sbin:/opt/bin:/sbin:/bin:/usr/sbin:/usr/bin")
        .stdin(Stdio::null())
        .env("HOME", "/root")
        .env("TERM", "dumb");
    let output = command
        .output()
        .await
        .map_err(|error| format!("Не удалось выполнить {}: {error}", path))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.trim();
        let detail = if detail.is_empty() {
            String::from_utf8_lossy(&output.stdout).trim().to_owned()
        } else {
            detail.to_owned()
        };
        return Err(if detail.is_empty() {
            format!("XKeen завершил команду с кодом {}", output.status)
        } else {
            format!("XKeen: {}", truncate(&detail, 512))
        });
    }

    tokio::time::sleep(Duration::from_millis(200)).await;
    Ok(read_status())
}

fn process_is_running(name: &str) -> bool {
    fs::read_dir("/proc").is_ok_and(|entries| {
        entries.flatten().any(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|pid| pid.bytes().all(|byte| byte.is_ascii_digit()))
                && fs::read_to_string(entry.path().join("comm"))
                    .is_ok_and(|comm| comm.trim() == name)
        })
    })
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

fn truncate(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

#[cfg(test)]
mod tests {
    use super::{resolve_init_path, safe_init_path, shell_assignment};
    use std::path::Path;

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
    fn allows_only_supported_core_names() {
        let text = "name_client=../../busybox";
        let value = shell_assignment(text, "name_client").unwrap();
        assert!(!super::ALLOWED_CLIENTS.contains(&value.as_str()));
        assert!(super::ALLOWED_CLIENTS.contains(&"mihomo"));
    }
}
