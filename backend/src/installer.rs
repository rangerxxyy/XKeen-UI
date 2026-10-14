use std::{
    env,
    error::Error,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const DEFAULT_PREFIX: &str = "/opt";
const DEFAULT_PORT: u16 = 1001;

#[derive(Debug, PartialEq, Eq)]
struct InstallOptions {
    prefix: PathBuf,
    port: Option<u16>,
    package_dir: Option<PathBuf>,
}

impl Default for InstallOptions {
    fn default() -> Self {
        Self {
            prefix: PathBuf::from(DEFAULT_PREFIX),
            port: None,
            package_dir: None,
        }
    }
}

pub fn dispatch(args: &[String]) -> Result<(), Box<dyn Error>> {
    match args.first().map(String::as_str) {
        Some("install") | Some("update") => {
            let options = parse_install_options(&args[1..])?;
            install_or_update(&options)?;
        }
        Some("remove") => {
            let options = parse_install_options(&args[1..])?;
            remove(&options.prefix)?;
        }
        Some("service") => {
            let verb = args.get(1).map(String::as_str);
            let prefix = parse_service_prefix(args.get(2..).unwrap_or_default())?;
            match verb {
                Some("start") => service_start(&prefix)?,
                Some("stop") => service_stop(&prefix)?,
                Some("status") => service_status(&prefix),
                _ => return Err("service expects start, stop, or status".into()),
            }
        }
        Some("--help" | "-h") | None => print_help(),
        Some(command) => return Err(format!("unknown command: {command}").into()),
    }
    Ok(())
}

fn print_help() {
    println!(
        "XKeen UI installer\n\
         Usage: xkeen-ui install|update [--port PORT] [--prefix DIR] [--package-dir DIR]\n\
         Usage: xkeen-ui remove [--prefix DIR]\n\
         Usage: xkeen-ui service start|stop|status [--prefix DIR]"
    );
}

fn parse_install_options(args: &[String]) -> Result<InstallOptions, Box<dyn Error>> {
    let mut options = InstallOptions::default();
    let mut index = 0;
    while index < args.len() {
        let name = args[index].as_str();
        index += 1;
        let value = args
            .get(index)
            .ok_or_else(|| format!("missing value for {name}"))?;
        index += 1;
        match name {
            "--port" => {
                let port = value.parse::<u16>()?;
                if port == 0 {
                    return Err("port must be between 1 and 65535".into());
                }
                options.port = Some(port);
            }
            "--prefix" => options.prefix = PathBuf::from(value),
            "--package-dir" => options.package_dir = Some(PathBuf::from(value)),
            _ => return Err(format!("unknown option: {name}").into()),
        }
    }
    validate_prefix(&options.prefix)?;
    Ok(options)
}

fn parse_service_prefix(args: &[String]) -> Result<PathBuf, Box<dyn Error>> {
    if args.is_empty() {
        return Ok(PathBuf::from(DEFAULT_PREFIX));
    }
    if args.len() == 2 && args[0] == "--prefix" {
        let prefix = PathBuf::from(&args[1]);
        validate_prefix(&prefix)?;
        return Ok(prefix);
    }
    Err("service accepts only --prefix DIR".into())
}

fn validate_prefix(prefix: &Path) -> Result<(), Box<dyn Error>> {
    let value = prefix
        .to_str()
        .ok_or("installation path must be valid UTF-8")?;
    if !prefix.is_absolute()
        || value.contains("..")
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'_' | b'.' | b'-'))
    {
        return Err(
            "installation path must be an absolute path without traversal or special characters"
                .into(),
        );
    }
    Ok(())
}

fn install_or_update(options: &InstallOptions) -> Result<(), Box<dyn Error>> {
    if !cfg!(target_os = "linux") {
        return Err("installation is supported only on Linux/Entware".into());
    }
    let package_dir = options
        .package_dir
        .clone()
        .or_else(|| env::current_exe().ok()?.parent().map(Path::to_path_buf))
        .ok_or("cannot locate the release package")?;
    validate_package(&package_dir)?;

    let paths = Paths::new(&options.prefix);
    fs::create_dir_all(paths.share_parent())?;
    fs::create_dir_all(&paths.etc)?;
    let previous_config = read_optional(&paths.config)?;
    let saved = Config::parse(previous_config.as_deref())?;
    let port = options.port.unwrap_or(saved.port);
    let token = saved.token;
    let config = Config {
        port,
        token,
        mihomo_url: env::var("XKEEN_MIHOMO_URL").ok().or(saved.mihomo_url),
        mihomo_secret: env::var("XKEEN_MIHOMO_SECRET").ok().or(saved.mihomo_secret),
    };

    validate_owned_paths(&paths)?;
    let was_installed = paths.app.exists();
    if was_installed {
        service_stop(&options.prefix)?;
    }
    let backup = if paths.app.exists() {
        let backup = paths.backup_path()?;
        fs::rename(&paths.app, &backup)?;
        Some(backup)
    } else {
        None
    };

    let staging = paths.staging_path()?;
    if staging.exists() {
        if let Some(backup) = backup.as_ref() {
            let _ = fs::rename(backup, &paths.app);
        }
        if was_installed {
            let _ = service_start(&options.prefix);
        }
        return Err("installer staging path already exists; refusing to reuse it".into());
    }
    let result = (|| -> Result<(), Box<dyn Error>> {
        copy_package(&package_dir, &staging)?;
        set_mode(&staging.join("xkeen-ui"), 0o755)?;
        write_atomic(&staging.join(".xkeen-ui-managed"), b"XKeen UI\n", 0o600)?;
        fs::rename(&staging, &paths.app)?;
        write_config(&paths.config, &config)?;
        if let Some(parent) = paths.service.parent() {
            fs::create_dir_all(parent)?;
        }
        write_service(&paths.service, &options.prefix)?;
        service_start(&options.prefix)?;
        Ok(())
    })();

    if let Err(error) = result {
        let mut rollback_errors = Vec::new();
        if staging.exists() {
            if let Err(cleanup) = fs::remove_dir_all(&staging) {
                rollback_errors.push(format!("could not remove staging directory: {cleanup}"));
            }
        }
        if paths.app.exists() {
            if let Err(cleanup) = fs::remove_dir_all(&paths.app) {
                rollback_errors.push(format!("could not remove failed installation: {cleanup}"));
            }
        }
        if let Some(backup) = backup.as_ref() {
            if let Err(restore) = fs::rename(backup, &paths.app) {
                rollback_errors.push(format!("could not restore {}: {restore}", backup.display()));
            } else if let Err(start) = service_start(&options.prefix) {
                rollback_errors.push(format!(
                    "previous version was restored but did not start: {start}"
                ));
            }
        }
        if let Err(restore) = restore_file(&paths.config, previous_config.as_deref()) {
            rollback_errors.push(format!("could not restore configuration: {restore}"));
        }
        if !rollback_errors.is_empty() {
            return Err(format!(
                "{error}; rollback incomplete: {}",
                rollback_errors.join("; ")
            )
            .into());
        }
        return Err(error);
    }

    println!("XKeen UI установлен и запущен на порту {port}.");
    if let Some(backup) = backup {
        println!("Предыдущая версия сохранена: {}", backup.display());
    }
    println!("Ключ доступа (сохраните его): {}", config.token);
    Ok(())
}

fn validate_package(package_dir: &Path) -> Result<(), Box<dyn Error>> {
    let binary = package_dir.join("xkeen-ui");
    let web_index = package_dir.join("web/index.html");
    if !binary.is_file() || !web_index.is_file() {
        return Err("release package must contain xkeen-ui and web/index.html".into());
    }
    if fs::symlink_metadata(&binary)?.file_type().is_symlink()
        || fs::symlink_metadata(&web_index)?.file_type().is_symlink()
    {
        return Err("release package must not contain symlinked entry points".into());
    }
    Ok(())
}

fn copy_package(source: &Path, destination: &Path) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = destination.join(entry.file_name());
        if kind.is_symlink() {
            return Err("release package contains a symlink".into());
        }
        if kind.is_dir() {
            copy_package(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), target)?;
        } else {
            return Err("release package contains a special file".into());
        }
    }
    Ok(())
}

fn set_mode(path: &Path, mode: u32) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    let _ = (path, mode);
    Ok(())
}

fn remove(prefix: &Path) -> Result<(), Box<dyn Error>> {
    validate_prefix(prefix)?;
    let paths = Paths::new(prefix);
    if !paths.app.exists() {
        return Err(format!("application directory not found: {}", paths.app.display()).into());
    }
    validate_owned_paths(&paths)?;
    service_stop(prefix)?;
    fs::remove_dir_all(&paths.app)?;
    if paths.service.exists() {
        fs::remove_file(&paths.service)?;
    }
    println!("XKeen UI удалён; конфигурация и резервные копии сохранены.");
    Ok(())
}

fn service_start(prefix: &Path) -> Result<(), Box<dyn Error>> {
    let paths = Paths::new(prefix);
    let config = Config::parse(read_optional(&paths.config)?.as_deref())?;
    if !paths.app.join("xkeen-ui").is_file() {
        return Err("application executable not found".into());
    }
    if !paths.app.join(".xkeen-ui-managed").is_file() {
        return Err(
            "application ownership marker not found; refusing to manage this directory".into(),
        );
    }
    if let Some(pid) = read_pid(&paths.pid)? {
        if owns_process(pid, &paths.app.join("xkeen-ui")) {
            println!("XKeen UI уже запущен.");
            return Ok(());
        }
        fs::remove_file(&paths.pid)?;
    }
    if let Some(parent) = paths.pid.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut command = Command::new(paths.app.join("xkeen-ui"));
    command
        .env_clear()
        .env("XKEEN_PORT", config.port.to_string())
        .env("XKEEN_TOKEN", &config.token)
        .env("XKEEN_MODE", "router")
        .env("XKEEN_WEB_ROOT", paths.app.join("web"))
        .env(
            "XKEEN_CORE_SOURCES_PATH",
            paths.etc.join("xkeen-ui-core-sources.json"),
        )
        .env("PATH", "/opt/bin:/opt/sbin:/usr/bin:/bin")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(url) = config.mihomo_url.as_deref() {
        command.env("XKEEN_MIHOMO_URL", url);
    }
    if let Some(secret) = config.mihomo_secret.as_deref() {
        command.env("XKEEN_MIHOMO_SECRET", secret);
    }
    let child = command.spawn()?;
    let pid = child.id();
    write_atomic(&paths.pid, format!("{pid}\n").as_bytes(), 0o600)?;
    thread::sleep(Duration::from_millis(250));
    if owns_process(pid, &paths.app.join("xkeen-ui")) {
        println!("XKeen UI запущен на порту {}.", config.port);
        Ok(())
    } else {
        let _ = fs::remove_file(&paths.pid);
        Err("XKeen UI process did not stay running".into())
    }
}

fn service_stop(prefix: &Path) -> Result<(), Box<dyn Error>> {
    let paths = Paths::new(prefix);
    let Some(pid) = read_pid(&paths.pid)? else {
        println!("XKeen UI не запущен.");
        return Ok(());
    };
    if !owns_process(pid, &paths.app.join("xkeen-ui")) {
        fs::remove_file(&paths.pid)?;
        println!("Удалена устаревшая запись PID.");
        return Ok(());
    }
    signal_process(pid)?;
    for _ in 0..50 {
        if !owns_process(pid, &paths.app.join("xkeen-ui")) {
            fs::remove_file(&paths.pid)?;
            println!("XKeen UI остановлен.");
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("XKeen UI process did not stop; PID file was kept".into())
}

fn signal_process(pid: u32) -> io::Result<()> {
    let pid_arg = pid.to_string();
    let candidates = [
        "/opt/bin/kill",
        "/opt/sbin/kill",
        "/bin/kill",
        "/usr/bin/kill",
    ];
    let mut last_not_found = None;
    for executable in candidates {
        match Command::new(executable)
            .env_clear()
            .arg("-TERM")
            .arg(&pid_arg)
            .status()
        {
            Ok(status) if status.success() => return Ok(()),
            Ok(_) => return Err(io::Error::other("could not signal XKeen UI process")),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                last_not_found = Some(error);
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_not_found.unwrap_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "no supported kill command found")
    }))
}

fn service_status(prefix: &Path) {
    let paths = Paths::new(prefix);
    match read_pid(&paths.pid) {
        Ok(Some(pid)) if owns_process(pid, &paths.app.join("xkeen-ui")) => {
            println!("XKeen UI запущен (PID {pid}).")
        }
        _ => println!("XKeen UI остановлен."),
    }
}

fn owns_process(pid: u32, executable: &Path) -> bool {
    #[cfg(target_os = "linux")]
    {
        let proc_executable = fs::read_link(format!("/proc/{pid}/exe"));
        proc_executable.is_ok_and(|actual| actual == executable)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (pid, executable);
        false
    }
}

fn read_pid(path: &Path) -> io::Result<Option<u32>> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(value.trim().parse::<u32>().ok()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn random_token() -> io::Result<String> {
    let mut bytes = [0_u8; 32];
    fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    let token = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if token.len() != 64 {
        return Err(io::Error::other("could not create access token"));
    }
    Ok(token)
}

fn read_optional(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn restore_file(path: &Path, contents: Option<&[u8]>) -> io::Result<()> {
    match contents {
        Some(contents) => write_atomic(path, contents, 0o600),
        None if path.exists() => fs::remove_file(path),
        None => Ok(()),
    }
}

fn write_config(path: &Path, config: &Config) -> io::Result<()> {
    let mut contents = format!("XKEEN_PORT={}\nXKEEN_TOKEN={}\n", config.port, config.token);
    if let Some(url) = config
        .mihomo_url
        .as_deref()
        .filter(|value| valid_env_value(value))
    {
        contents.push_str(&format!("XKEEN_MIHOMO_URL={url}\n"));
    }
    if let Some(secret) = config
        .mihomo_secret
        .as_deref()
        .filter(|value| valid_env_value(value))
    {
        contents.push_str(&format!("XKEEN_MIHOMO_SECRET={secret}\n"));
    }
    write_atomic(path, contents.as_bytes(), 0o600)
}

fn valid_env_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 4096
        && !value.bytes().any(|byte| matches!(byte, b'\n' | b'\r' | 0))
}

fn write_service(path: &Path, prefix: &Path) -> io::Result<()> {
    let app = Paths::new(prefix).app;
    let contents = format!(
        "#!/bin/sh\n# Managed by XKeen UI.\nAPP='{}/xkeen-ui'\ncase \"${{1:-status}}\" in\n  start|stop|status) exec \"$APP\" service \"$1\" --prefix '{}' ;;\n  restart) \"$APP\" service stop --prefix '{}' && exec \"$APP\" service start --prefix '{}' ;;\n  *) exit 2 ;;\nesac\n",
        app.display(),
        prefix.display(),
        prefix.display(),
        prefix.display()
    );
    write_atomic(path, contents.as_bytes(), 0o755)
}

fn write_atomic(path: &Path, contents: &[u8], mode: u32) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("path has no parent directory"))?;
    fs::create_dir_all(parent)?;
    let temporary = path.with_extension(format!("tmp.{}", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    file.write_all(contents)?;
    file.sync_all()?;
    set_mode(&temporary, mode)?;
    fs::rename(temporary, path)
}

#[derive(Debug, PartialEq, Eq)]
struct Config {
    port: u16,
    token: String,
    mihomo_url: Option<String>,
    mihomo_secret: Option<String>,
}

impl Config {
    fn parse(bytes: Option<&[u8]>) -> Result<Self, Box<dyn Error>> {
        let mut port = None;
        let mut token = None;
        let mut mihomo_url = None;
        let mut mihomo_secret = None;
        if let Some(bytes) = bytes {
            let contents = std::str::from_utf8(bytes)?;
            for line in contents.lines() {
                if let Some(value) = line.strip_prefix("XKEEN_PORT=") {
                    let parsed = value.parse::<u16>()?;
                    if parsed == 0 {
                        return Err("saved port is outside 1..65535".into());
                    }
                    port = Some(parsed);
                }
                if let Some(value) = line.strip_prefix("XKEEN_TOKEN=") {
                    if valid_token(value) {
                        token = Some(value.to_owned());
                    }
                }
                if let Some(value) = line.strip_prefix("XKEEN_MIHOMO_URL=") {
                    if valid_env_value(value) {
                        mihomo_url = Some(value.to_owned());
                    }
                }
                if let Some(value) = line.strip_prefix("XKEEN_MIHOMO_SECRET=") {
                    if valid_env_value(value) {
                        mihomo_secret = Some(value.to_owned());
                    }
                }
            }
        }
        Ok(Self {
            port: port.unwrap_or(DEFAULT_PORT),
            token: match token {
                Some(token) => token,
                None => random_token()?,
            },
            mihomo_url,
            mihomo_secret,
        })
    }
}

fn valid_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

struct Paths {
    prefix: PathBuf,
    share: PathBuf,
    etc: PathBuf,
    app: PathBuf,
    config: PathBuf,
    service: PathBuf,
    pid: PathBuf,
}

impl Paths {
    fn new(prefix: &Path) -> Self {
        let share = prefix.join("share");
        let etc = prefix.join("etc");
        Self {
            prefix: prefix.to_path_buf(),
            app: share.join("xkeen-ui"),
            share,
            // zxc-rv installs its own XKeen UI service at S99xkeen-ui. Keep
            // this panel isolated so installing it never overwrites their
            // service script or changes the existing port-1000 instance.
            service: etc.join("init.d/S99xkeen-ui-panel"),
            config: etc.join("xkeen-ui.env"),
            pid: prefix.join("var/run/xkeen-ui.pid"),
            etc,
        }
    }

    fn share_parent(&self) -> &Path {
        &self.share
    }

    fn backup_path(&self) -> io::Result<PathBuf> {
        Ok(self.prefix.join(format!(
            "share/xkeen-ui.backup.{}-{}",
            timestamp()?,
            std::process::id()
        )))
    }

    fn staging_path(&self) -> io::Result<PathBuf> {
        Ok(self.prefix.join(format!(
            "share/.xkeen-ui-stage.{}-{}",
            timestamp()?,
            std::process::id()
        )))
    }
}

fn validate_owned_paths(paths: &Paths) -> Result<(), Box<dyn Error>> {
    if paths.app.exists() && fs::symlink_metadata(&paths.app)?.file_type().is_symlink() {
        return Err("application path is a symlink; refusing to replace it".into());
    }
    if paths.service.exists() {
        let contents = fs::read_to_string(&paths.service)?;
        if !contents.starts_with("#!/bin/sh\n# Managed by XKeen UI.\n") {
            return Err("service path already exists and is not managed by XKeen UI".into());
        }
    }
    if paths.app.exists() && !paths.app.join(".xkeen-ui-managed").is_file() {
        return Err(
            "application directory has no XKeen UI ownership marker; refusing to replace it".into(),
        );
    }
    Ok(())
}

fn timestamp() -> io::Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_secs())
}

#[cfg(test)]
mod tests {
    use super::{parse_install_options, validate_prefix, Config, InstallOptions};
    use std::path::Path;

    #[test]
    fn installer_options_have_safe_router_defaults() {
        assert_eq!(
            parse_install_options(&[]).unwrap(),
            InstallOptions::default()
        );
        assert!(parse_install_options(&["--port".into(), "0".into()]).is_err());
        assert!(parse_install_options(&["--port".into(), "65536".into()]).is_err());
        assert!(parse_install_options(&["--port".into(), "1001".into()]).is_ok());
    }

    #[test]
    fn installer_prefix_rejects_relative_paths_traversal_and_shell_metacharacters() {
        assert!(validate_prefix(Path::new("/opt")).is_ok());
        assert!(validate_prefix(Path::new("relative")).is_err());
        assert!(validate_prefix(Path::new("/opt/../etc")).is_err());
        assert!(validate_prefix(Path::new("/opt;rm")).is_err());
    }

    #[test]
    fn update_preserves_saved_port_and_only_accepts_a_strong_hex_token() {
        let saved = Config::parse(Some(
            b"XKEEN_PORT=1234\nXKEEN_TOKEN=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n",
        ))
        .unwrap();
        assert_eq!(saved.port, 1234);
        assert_eq!(saved.token.len(), 64);
        assert_eq!(saved.mihomo_url, None);
        assert_eq!(Config::parse(None).unwrap().port, 1001);
    }
}
