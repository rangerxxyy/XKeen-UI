use super::AppState;
use crate::xkeen;
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

const MAX_ASSET_BYTES: u64 = 32 * 1024 * 1024;
const MAX_BINARY_BYTES: u64 = 96 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoreInstallRequest {
    pub core: String,
    pub tag: String,
    pub asset: String,
    pub sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreInstallResult {
    pub core: String,
    pub tag: String,
    pub backup: Option<String>,
    pub restarted: bool,
    pub detail: String,
}

pub(super) async fn install(
    state: &AppState,
    request: CoreInstallRequest,
) -> Result<CoreInstallResult, String> {
    let core = request.core.as_str();
    if !matches!(core, "xray" | "mihomo") {
        return Err("Поддерживаются только ядра Xray и Mihomo".into());
    }
    if !valid_segment(&request.tag) || !valid_segment(&request.asset) {
        return Err("Некорректное имя релиза или файла".into());
    }
    if !valid_asset(core, &request.asset) {
        return Err(
            "Файл не является поддерживаемым архивом Linux ARM64 для выбранного ядра".into(),
        );
    }
    if request.sha256.len() != 64 || !request.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("GitHub не предоставил корректный SHA-256 для файла".into());
    }
    let repo = {
        let source = state
            .core_sources
            .read()
            .map_err(|_| "Не удалось прочитать репозиторий ядра".to_owned())?;
        if core == "xray" {
            source.xray.clone()
        } else {
            source.mihomo.clone()
        }
    };
    repo.strip_prefix("https://github.com/")
        .ok_or_else(|| "Разрешены только GitHub-репозитории".to_owned())?;
    let url = format!("{repo}/releases/download/{}/{}", request.tag, request.asset);
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_root = if Path::new("/opt/tmp").is_dir() {
        PathBuf::from("/opt/tmp")
    } else {
        std::env::temp_dir()
    };
    let temp = temp_root.join(format!("xkeen-core-{}-{epoch}", std::process::id()));
    tokio::fs::create_dir(&temp)
        .await
        .map_err(|error| format!("Не удалось создать временный каталог: {error}"))?;
    #[cfg(unix)]
    tokio::fs::set_permissions(&temp, fs::Permissions::from_mode(0o700))
        .await
        .map_err(|error| format!("Не удалось закрыть права временного каталога: {error}"))?;

    let result = stage_and_install(core, &request, &url, &temp).await;
    let cleanup = tokio::fs::remove_dir_all(&temp).await;
    if let Err(error) = cleanup {
        tracing::warn!(path = %temp.display(), %error, "Could not remove temporary core update files");
    }
    result
}

async fn stage_and_install(
    core: &str,
    request: &CoreInstallRequest,
    url: &str,
    temp: &Path,
) -> Result<CoreInstallResult, String> {
    let archive = temp.join(&request.asset);
    let mut download = Command::new("curl");
    download
        .args([
            "-fLsS",
            "--retry",
            "2",
            "--connect-timeout",
            "15",
            "--max-time",
            "300",
        ])
        .arg("--max-filesize")
        .arg(MAX_ASSET_BYTES.to_string())
        .arg("--proto")
        .arg("=https")
        .arg("--proto-redir")
        .arg("=https")
        .arg("-o")
        .arg(&archive)
        .arg(url)
        .env_clear()
        .env("PATH", "/opt/bin:/opt/sbin:/usr/bin:/bin")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let downloaded = tokio::time::timeout(Duration::from_secs(330), download.status())
        .await
        .map_err(|_| "Загрузка ядра превысила 330 секунд".to_owned())?
        .map_err(|error| format!("Не удалось запустить curl: {error}"))?;
    if !downloaded.success() {
        return Err("GitHub не отдал архив ядра или лимит размера был превышен".into());
    }
    let archive_size = tokio::fs::metadata(&archive)
        .await
        .map_err(|error| format!("Не найден загруженный архив: {error}"))?
        .len();
    if archive_size == 0 || archive_size > MAX_ASSET_BYTES {
        return Err("Размер архива ядра вне допустимого диапазона".into());
    }

    let checksum = Command::new("sha256sum")
        .arg(&archive)
        .env_clear()
        .env("PATH", "/opt/bin:/opt/sbin:/usr/bin:/bin")
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| format!("Не удалось проверить SHA-256: {error}"))?;
    if !checksum.status.success() {
        return Err("Утилита sha256sum завершилась с ошибкой".into());
    }
    let actual = String::from_utf8_lossy(&checksum.stdout)
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if actual != request.sha256.to_ascii_lowercase() {
        return Err("SHA-256 архива не совпал со значением из GitHub API".into());
    }

    let staged = temp.join("core.new");
    tokio::time::timeout(
        Duration::from_secs(90),
        extract_core(core, &request.asset, &archive, &staged),
    )
    .await
    .map_err(|_| "Распаковка ядра превысила 90 секунд".to_owned())??;
    let binary_size = tokio::fs::metadata(&staged)
        .await
        .map_err(|error| format!("Не удалось прочитать распакованное ядро: {error}"))?
        .len();
    if !(1024 * 1024..=MAX_BINARY_BYTES).contains(&binary_size) || !is_aarch64_elf(&staged).await? {
        return Err("Архив не содержит допустимый исполняемый ELF-бинарник Linux ARM64".into());
    }
    #[cfg(unix)]
    tokio::fs::set_permissions(&staged, fs::Permissions::from_mode(0o755))
        .await
        .map_err(|error| format!("Не удалось установить права ядра: {error}"))?;

    let target = PathBuf::from(format!("/opt/sbin/{core}"));
    let previous = xkeen::read_status();
    let core_running = process_is_running(core);
    if core_running && previous.core.as_deref() != Some(core) {
        return Err(
            "Ядро запущено, но его связь с init-файлом XKeen не подтверждена; замена отменена"
                .into(),
        );
    }
    let active =
        core_running && previous.running == Some(true) && previous.core.as_deref() == Some(core);
    if active {
        validate_active_config(core, &staged).await?;
    }

    let backup = backup_existing(&target, core).await?;
    if active && backup.is_none() {
        return Err("Активный файл ядра не найден; безопасный откат невозможен".into());
    }
    tokio::fs::rename(&staged, &target)
        .await
        .map_err(|error| format!("Не удалось атомарно заменить ядро: {error}"))?;
    if active {
        let backup_path = backup
            .as_ref()
            .ok_or("Не удалось найти резервную копию активного ядра")?;
        match xkeen::control("restart").await {
            Ok(status) if status.running == Some(true) => {}
            Ok(_) => {
                restore_backup(backup_path, &target).await?;
                let _ = xkeen::control("restart").await;
                return Err("Новое ядро не запустилось. Предыдущая версия восстановлена.".into());
            }
            Err(error) => {
                restore_backup(backup_path, &target).await?;
                let _ = xkeen::control("restart").await;
                return Err(format!(
                    "Обновление отменено, предыдущая версия восстановлена: {error}"
                ));
            }
        }
    }

    Ok(CoreInstallResult {
        core: core.to_owned(),
        tag: request.tag.clone(),
        backup: backup.map(|path| path.to_string_lossy().into_owned()),
        restarted: active,
        detail: if active {
            "Ядро установлено, конфигурация проверена, сервис перезапущен".into()
        } else {
            "Ядро установлено; активный сервис не перезапускался".into()
        },
    })
}

async fn extract_core(
    core: &str,
    asset_name: &str,
    archive: &Path,
    output: &Path,
) -> Result<(), String> {
    let (program, args) = if core == "xray" {
        let listing = Command::new("unzip")
            .args(["-Z1"])
            .arg(archive)
            .env_clear()
            .env("PATH", "/opt/bin:/opt/sbin:/usr/bin:/bin")
            .stdin(Stdio::null())
            .output()
            .await
            .map_err(|error| format!("Не удалось прочитать Xray ZIP-архив: {error}"))?;
        if !listing.status.success() || listing.stdout.len() > 1024 * 1024 {
            return Err("ZIP-архив Xray повреждён или содержит слишком много записей".into());
        }
        let entries = String::from_utf8_lossy(&listing.stdout);
        let member = entries
            .lines()
            .find(|entry| !entry.ends_with('/') && entry.rsplit('/').next() == Some("xray"))
            .ok_or_else(|| "В Xray ZIP-архиве не найден бинарник xray".to_owned())?;
        (
            "unzip",
            vec![
                "-p".to_owned(),
                archive.display().to_string(),
                member.to_owned(),
            ],
        )
    } else if asset_name.ends_with(".gz") {
        ("gzip", vec!["-dc".into(), archive.display().to_string()])
    } else {
        return Err("Формат архива ядра не поддерживается".into());
    };

    let mut child = Command::new(program)
        .args(args)
        .env_clear()
        .env("PATH", "/opt/bin:/opt/sbin:/usr/bin:/bin")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Не удалось запустить {program}: {error}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("Не удалось прочитать архив ядра")?;
    let mut file = tokio::fs::File::create(output)
        .await
        .map_err(|error| format!("Не удалось создать временный бинарник: {error}"))?;
    let mut count = 0_u64;
    let mut chunk = [0_u8; 16 * 1024];
    loop {
        let size = stdout
            .read(&mut chunk)
            .await
            .map_err(|error| format!("Ошибка распаковки ядра: {error}"))?;
        if size == 0 {
            break;
        }
        count = count.saturating_add(size as u64);
        if count > MAX_BINARY_BYTES {
            let _ = child.kill().await;
            let _ = tokio::fs::remove_file(output).await;
            return Err("Распакованный бинарник превышает лимит 96 MiB".into());
        }
        file.write_all(&chunk[..size])
            .await
            .map_err(|error| format!("Не удалось записать временный бинарник: {error}"))?;
    }
    file.sync_all()
        .await
        .map_err(|error| format!("Не удалось сохранить временный бинарник: {error}"))?;
    drop(file);
    let status = child
        .wait()
        .await
        .map_err(|error| format!("Не удалось дождаться распаковки: {error}"))?;
    if !status.success() {
        let _ = tokio::fs::remove_file(output).await;
        return Err(format!("Распаковщик {program} завершился с ошибкой"));
    }
    Ok(())
}

async fn validate_active_config(core: &str, binary: &Path) -> Result<(), String> {
    let (args, config) = if core == "mihomo" {
        (
            vec!["-t", "-f", "/opt/etc/mihomo/config.yaml"],
            "/opt/etc/mihomo/config.yaml",
        )
    } else {
        (vec!["run", "-test"], "/opt/etc/xray/configs")
    };
    if !Path::new(config).exists() {
        return Err(format!(
            "Активный конфиг ядра не найден: {config}; обновление отменено"
        ));
    }
    let mut command = Command::new(binary);
    command
        .args(args)
        .env_clear()
        .env("PATH", "/opt/bin:/opt/sbin:/usr/bin:/bin")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if core == "xray" {
        command
            .env("XRAY_LOCATION_CONFDIR", "/opt/etc/xray/configs")
            .env("XRAY_LOCATION_ASSET", "/opt/etc/xray/dat")
            .current_dir("/opt/etc/xray");
    } else {
        command
            .env("CLASH_HOME_DIR", "/opt/etc/mihomo")
            .current_dir("/opt/etc/mihomo");
    }
    let output = tokio::time::timeout(Duration::from_secs(20), command.status())
        .await
        .map_err(|_| "Проверка конфигурации превысила 20 секунд".to_owned())?
        .map_err(|error| format!("Не удалось проверить конфигурацию: {error}"))?;
    if !output.success() {
        return Err(format!(
            "Текущая конфигурация {core} не проходит проверку новой версией; файлы не изменены"
        ));
    }
    Ok(())
}

async fn backup_existing(target: &Path, core: &str) -> Result<Option<PathBuf>, String> {
    let metadata = match tokio::fs::symlink_metadata(target).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Не удалось проверить установленное ядро: {error}")),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Текущий файл ядра не является обычным файлом; замена запрещена".into());
    }
    let dir = Path::new("/opt/sbin/core-backup");
    match tokio::fs::symlink_metadata(dir).await {
        Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
            return Err(
                "Каталог резервных копий является ссылкой или не является каталогом".into(),
            );
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Не удалось проверить каталог резервных копий: {error}"
            ));
        }
    }
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|error| format!("Не удалось создать каталог резервных копий: {error}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let backup = dir.join(format!("{core}-{stamp}"));
    tokio::fs::copy(target, &backup)
        .await
        .map_err(|error| format!("Не удалось создать резервную копию ядра: {error}"))?;
    Ok(Some(backup))
}

async fn restore_backup(backup: &Path, target: &Path) -> Result<(), String> {
    let restore = target.with_extension("rollback");
    tokio::fs::copy(backup, &restore)
        .await
        .map_err(|error| format!("Не удалось скопировать резервную копию: {error}"))?;
    #[cfg(unix)]
    tokio::fs::set_permissions(&restore, fs::Permissions::from_mode(0o755))
        .await
        .map_err(|error| format!("Не удалось установить права отката: {error}"))?;
    tokio::fs::rename(restore, target)
        .await
        .map_err(|error| format!("Не удалось восстановить ядро из резервной копии: {error}"))
}

async fn is_aarch64_elf(path: &Path) -> Result<bool, String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("Не удалось открыть распакованное ядро: {error}"))?;
    let mut header = [0_u8; 20];
    file.read_exact(&mut header)
        .await
        .map_err(|error| format!("Заголовок бинарника ядра повреждён: {error}"))?;
    Ok(&header[..4] == b"\x7fELF"
        && header[4] == 2
        && header[5] == 1
        && u16::from_le_bytes([header[18], header[19]]) == 183)
}

fn valid_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._+-".contains(&byte))
}

fn valid_asset(core: &str, asset: &str) -> bool {
    match core {
        "xray" => {
            asset
                .to_ascii_lowercase()
                .starts_with("xray-linux-arm64-v8a")
                && asset.ends_with(".zip")
        }
        "mihomo" => asset.contains("linux-arm64") && asset.ends_with(".gz"),
        _ => false,
    }
}

fn process_is_running(name: &str) -> bool {
    fs::read_dir("/proc").is_ok_and(|entries| {
        entries.flatten().any(|entry| {
            entry.file_name().to_str().is_some_and(|pid| {
                pid.bytes().all(|byte| byte.is_ascii_digit())
                    && fs::read_to_string(entry.path().join("comm"))
                        .is_ok_and(|comm| comm.trim() == name)
            })
        })
    })
}

#[cfg(test)]
mod tests {
    use super::{valid_asset, valid_segment};

    #[test]
    fn only_accepts_linux_arm64_core_archives() {
        assert!(valid_asset("xray", "Xray-linux-arm64-v8a.zip"));
        assert!(!valid_asset("xray", "Xray-linux-amd64.zip"));
        assert!(valid_asset("mihomo", "mihomo-linux-arm64-v1.19.32.gz"));
        assert!(!valid_asset("mihomo", "mihomo-linux-amd64-v1.19.32.gz"));
    }

    #[test]
    fn release_segments_cannot_contain_paths_or_shell_syntax() {
        assert!(valid_segment("v1.19.32"));
        assert!(!valid_segment("../xray"));
        assert!(!valid_segment("xray;id"));
    }
}
