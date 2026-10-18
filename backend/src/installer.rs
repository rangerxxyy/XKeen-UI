use std::{
    env,
    error::Error,
    fs::{self, OpenOptions},
    io::{self, Write},
    net::{Ipv4Addr, TcpListener},
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
    let bind_ip = preferred_install_bind(saved.bind_ip, env::var_os("XKEEN_BIND").is_some())
        .map(Ok)
        .unwrap_or_else(resolve_bind_ip)?;
    validate_owned_paths(&paths)?;
    let was_installed = paths.app.exists();
    if was_installed {
        println!("Остановка текущей панели…");
        service_stop(&options.prefix)?;
    }
    let requested_port = preferred_install_port(options.port, was_installed, saved.port);
    let reuse_saved_port = was_installed && options.port.is_none();
    let port = match choose_port(requested_port, reuse_saved_port) {
        Ok(port) => port,
        Err(error) => {
            if was_installed {
                let _ = service_start(&options.prefix);
            }
            return Err(error.into());
        }
    };
    let config = Config {
        port,
        bind_ip: Some(bind_ip),
        mihomo_url: env::var("XKEEN_MIHOMO_URL").ok().or(saved.mihomo_url),
        mihomo_secret: env::var("XKEEN_MIHOMO_SECRET").ok().or(saved.mihomo_secret),
    };

    let backup = if paths.app.exists() {
        println!("Сохранение предыдущей версии панели…");
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
        println!("Установка новой версии панели…");
        copy_package(&package_dir, &staging)?;
        set_mode(&staging.join("xkeen-ui"), 0o755)?;
        prepare_runtime_binary(&staging)?;
        write_atomic(&staging.join(".xkeen-ui-managed"), b"XKeen UI\n", 0o600)?;
        fs::rename(&staging, &paths.app)?;
        write_config(&paths.config, &config)?;
        if let Some(parent) = paths.service.parent() {
            fs::create_dir_all(parent)?;
        }
        write_service(&paths.service, &options.prefix)?;
        println!("Запуск обновлённой панели…");
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

    let bind_ip = config
        .bind_ip
        .expect("installer always resolves a LAN address");
    println!("\x1b[38;5;51mПанель XKeen UI успешно установлена ✔️\x1b[0m");
    println!("\x1b[38;5;51mАдрес панели: http://{bind_ip}:{port}\x1b[0m");
    if let Some(backup) = backup {
        println!("Предыдущая версия сохранена: {}", backup.display());
    }
    Ok(())
}

fn resolve_bind_ip() -> Result<Ipv4Addr, Box<dyn Error>> {
    if let Ok(value) = env::var("XKEEN_BIND") {
        return value
            .parse::<Ipv4Addr>()
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "XKEEN_BIND must be a valid IPv4 address",
                )
            })
            .map_err(Into::into);
    }
    let candidates = [
        "/opt/sbin/ip",
        "/opt/bin/ip",
        "/sbin/ip",
        "/usr/sbin/ip",
        "/bin/ip",
    ];
    for executable in candidates {
        let output = match Command::new(executable)
            .args(["-4", "-o", "addr", "show", "dev", "br0"])
            .output()
        {
            Ok(output) => output,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        if !output.status.success() {
            continue;
        }
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let mut fields = line.split_whitespace();
            while let Some(field) = fields.next() {
                if field == "inet" {
                    if let Some(address) = fields.next().and_then(|value| value.split('/').next()) {
                        if let Ok(ip) = address.parse::<Ipv4Addr>() {
                            return Ok(ip);
                        }
                    }
                }
            }
        }
    }
    Err("could not detect the br0 IPv4 address; set XKEEN_BIND explicitly".into())
}

fn preferred_install_bind(saved: Option<Ipv4Addr>, has_override: bool) -> Option<Ipv4Addr> {
    if has_override {
        None
    } else {
        saved
    }
}

fn choose_port(requested: Option<u16>, reuse_saved_port: bool) -> io::Result<u16> {
    if let Some(port) = requested {
        return if reuse_saved_port || port_is_available(port) {
            Ok(port)
        } else {
            Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                format!("requested port {port} is already in use"),
            ))
        };
    }
    first_available_port(DEFAULT_PORT)
}

fn preferred_install_port(
    override_port: Option<u16>,
    was_installed: bool,
    saved_port: u16,
) -> Option<u16> {
    override_port.or_else(|| was_installed.then_some(saved_port))
}

fn first_available_port(start: u16) -> io::Result<u16> {
    (start..=u16::MAX)
        .find(|port| port_is_available(*port))
        .ok_or_else(|| io::Error::new(io::ErrorKind::AddrNotAvailable, "no free TCP port found"))
}

fn port_is_available(port: u16) -> bool {
    TcpListener::bind(("0.0.0.0", port)).is_ok()
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

fn prepare_runtime_binary(app: &Path) -> io::Result<()> {
    let cli = app.join("xkeen-ui");
    let runtime = app.join("xkeen-ui-ranger");
    // A separate executable name avoids zxc-rv's `killall xkeen-ui`.
    // Hard linking keeps a single copy on Entware filesystems that support it.
    fs::hard_link(&cli, &runtime).or_else(|_| fs::copy(&cli, &runtime).map(|_| ()))?;
    set_mode(&runtime, 0o755)
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
    let executable = paths.runtime_executable();
    let config = Config::parse(read_optional(&paths.config)?.as_deref())?;
    if !executable.is_file() {
        return Err("application executable not found".into());
    }
    if !paths.app.join(".xkeen-ui-managed").is_file() {
        return Err(
            "application ownership marker not found; refusing to manage this directory".into(),
        );
    }
    if let Some(pid) = read_pid(&paths.pid)? {
        if owns_panel_process(pid, &paths) {
            println!("XKeen UI уже запущен.");
            return Ok(());
        }
        fs::remove_file(&paths.pid)?;
    }
    if let Some(parent) = paths.pid.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut command = Command::new(&executable);
    let bind_ip = match config.bind_ip {
        Some(address) => address,
        None => resolve_bind_ip()?,
    };
    command
        .env_clear()
        .env("XKEEN_PORT", config.port.to_string())
        .env("XKEEN_BIND", bind_ip.to_string())
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
    if owns_process(pid, &executable) {
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
    if !owns_panel_process(pid, &paths) {
        fs::remove_file(&paths.pid)?;
        println!("Удалена устаревшая запись PID.");
        return Ok(());
    }
    signal_process(pid)?;
    for _ in 0..50 {
        if !owns_panel_process(pid, &paths) {
            fs::remove_file(&paths.pid)?;
            println!("XKeen UI остановлен.");
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("XKeen UI process did not stop; PID file was kept".into())
}

fn signal_process(pid: u32) -> io::Result<()> {
    use std::os::raw::c_int;

    // Entware commonly provides `kill` only as a BusyBox shell builtin, so
    // invoking `/bin/kill` or `/opt/bin/kill` fails with ENOENT. Signal the
    // verified panel PID directly; ownership is checked by service_stop first.
    unsafe extern "C" {
        fn kill(pid: c_int, signal: c_int) -> c_int;
    }
    let pid = c_int::try_from(pid)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid panel PID"))?;
    // SAFETY: `pid` is the validated PID read from the service file and the
    // caller verified that it belongs to the XKeen UI executable.
    let result = unsafe { kill(pid, 15) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn service_status(prefix: &Path) {
    let paths = Paths::new(prefix);
    match read_pid(&paths.pid) {
        Ok(Some(pid)) if owns_panel_process(pid, &paths) => {
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

fn owns_panel_process(pid: u32, paths: &Paths) -> bool {
    owns_process(pid, &paths.app.join("xkeen-ui-ranger"))
        || owns_process(pid, &paths.app.join("xkeen-ui"))
}

fn read_pid(path: &Path) -> io::Result<Option<u32>> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(value.trim().parse::<u32>().ok()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
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
    let mut contents = format!("XKEEN_PORT={}\n", config.port);
    if let Some(bind_ip) = config.bind_ip {
        contents.push_str(&format!("XKEEN_BIND={bind_ip}\n"));
    }
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
    bind_ip: Option<Ipv4Addr>,
    mihomo_url: Option<String>,
    mihomo_secret: Option<String>,
}

impl Config {
    fn parse(bytes: Option<&[u8]>) -> Result<Self, Box<dyn Error>> {
        let mut port = None;
        let mut bind_ip = None;
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
                if let Some(value) = line.strip_prefix("XKEEN_BIND=") {
                    bind_ip = value.parse::<Ipv4Addr>().ok();
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
            bind_ip,
            mihomo_url,
            mihomo_secret,
        })
    }
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
            service: panel_service_path(&etc),
            config: etc.join("xkeen-ui.env"),
            pid: prefix.join("var/run/xkeen-ui.pid"),
            etc,
        }
    }

    fn share_parent(&self) -> &Path {
        &self.share
    }

    fn runtime_executable(&self) -> PathBuf {
        let runtime = self.app.join("xkeen-ui-ranger");
        if runtime.is_file() {
            runtime
        } else {
            // Previous versions remain manageable before their first update.
            self.app.join("xkeen-ui")
        }
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

fn panel_service_path(etc: &Path) -> PathBuf {
    let original = etc.join("init.d/S99xkeen-ui-panel");
    let separate = etc.join("init.d/S99xkeen-ui-ranger");
    if fs::read_to_string(&separate)
        .is_ok_and(|text| text.starts_with("#!/bin/sh\n# Managed by XKeen UI.\n"))
    {
        return separate;
    }
    // Retain our existing installations. A legacy panel may use the same
    // process/service name, so never overwrite or stop its init script.
    if original.exists()
        && !fs::read_to_string(&original)
            .is_ok_and(|text| text.starts_with("#!/bin/sh\n# Managed by XKeen UI.\n"))
    {
        separate
    } else {
        original
    }
}

fn validate_owned_paths(paths: &Paths) -> Result<(), Box<dyn Error>> {
    if paths.app.exists() && fs::symlink_metadata(&paths.app)?.file_type().is_symlink() {
        return Err("application path is a symlink; refusing to replace it".into());
    }
    if paths.service.exists() {
        let contents = fs::read_to_string(&paths.service)?;
        if !contents.starts_with("#!/bin/sh\n# Managed by XKeen UI.\n") {
            let message = format!(
                "service path {} already exists and is not managed by XKeen UI; existing service was preserved",
                paths.service.display()
            );
            return Err(message.into());
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
    use super::{
        choose_port, first_available_port, parse_install_options, preferred_install_port,
        validate_prefix, Config, InstallOptions, DEFAULT_PORT,
    };
    use std::net::TcpListener;
    use std::path::Path;

    #[test]
    fn update_preserves_loopback_binding_unless_explicitly_overridden() {
        let loopback = std::net::Ipv4Addr::LOCALHOST;
        assert_eq!(
            super::preferred_install_bind(Some(loopback), false),
            Some(loopback)
        );
        assert_eq!(super::preferred_install_bind(Some(loopback), true), None);
        assert_eq!(super::preferred_install_bind(None, false), None);
    }

    #[test]
    fn installed_runtime_has_a_distinct_name_and_legacy_runtime_still_resolves() {
        let prefix = std::env::temp_dir().join(format!("xkeen-runtime-{}", std::process::id()));
        let paths = super::Paths::new(&prefix);
        std::fs::create_dir_all(&paths.app).unwrap();
        let cli = paths.app.join("xkeen-ui");
        std::fs::write(&cli, b"test executable").unwrap();
        assert_eq!(paths.runtime_executable(), cli);
        super::prepare_runtime_binary(&paths.app).unwrap();
        assert_eq!(
            paths.runtime_executable(),
            paths.app.join("xkeen-ui-ranger")
        );
        assert_eq!(
            std::fs::read(paths.runtime_executable()).unwrap(),
            std::fs::read(cli).unwrap()
        );
        std::fs::remove_dir_all(prefix).unwrap();
    }

    #[test]
    fn foreign_panel_service_is_preserved_and_uses_a_separate_service_path() {
        let prefix = std::env::temp_dir().join(format!("xkeen-paths-{}", std::process::id()));
        let init = prefix.join("etc/init.d");
        std::fs::create_dir_all(&init).unwrap();
        let foreign = init.join("S99xkeen-ui-panel");
        let script = "#!/bin/sh\nPROCS=xkeen-ui-panel\nARGS=\"-p 1001\"\n";
        std::fs::write(&foreign, script).unwrap();
        let paths = super::Paths::new(&prefix);
        assert_eq!(paths.service, init.join("S99xkeen-ui-ranger"));
        assert!(super::validate_owned_paths(&paths).is_ok());
        assert_eq!(std::fs::read_to_string(&foreign).unwrap(), script);
        std::fs::write(&paths.service, "#!/bin/sh\n# Managed by XKeen UI.\n").unwrap();
        assert_eq!(super::Paths::new(&prefix).service, paths.service);
        std::fs::remove_file(&foreign).unwrap();
        assert_eq!(super::Paths::new(&prefix).service, paths.service);
        std::fs::write(&foreign, script).unwrap();
        std::fs::write(&paths.service, "#!/bin/sh\n# Unrelated service\n").unwrap();
        assert!(super::validate_owned_paths(&super::Paths::new(&prefix)).is_err());
        std::fs::remove_dir_all(prefix).unwrap();
    }

    #[test]
    fn existing_managed_panel_keeps_its_service_path() {
        let prefix = std::env::temp_dir().join(format!("xkeen-managed-{}", std::process::id()));
        let init = prefix.join("etc/init.d");
        std::fs::create_dir_all(&init).unwrap();
        let service = init.join("S99xkeen-ui-panel");
        std::fs::write(&service, "#!/bin/sh\n# Managed by XKeen UI.\n").unwrap();
        assert_eq!(super::Paths::new(&prefix).service, service);
        std::fs::remove_dir_all(prefix).unwrap();
    }

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
    fn configuration_reads_port_and_ignores_legacy_access_tokens() {
        let saved = Config::parse(Some(
            b"XKEEN_PORT=1234\nXKEEN_TOKEN=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n",
        ))
        .unwrap();
        assert_eq!(saved.port, 1234);
        assert_eq!(saved.bind_ip, None);
        assert_eq!(saved.mihomo_url, None);
        assert_eq!(Config::parse(None).unwrap().port, 1001);
    }

    #[test]
    fn automatic_port_selection_uses_1001_then_the_next_free_port() {
        let occupied = TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let port = occupied.local_addr().unwrap().port();
        assert!(first_available_port(port).unwrap() > port);
        assert!(choose_port(None, false).unwrap() >= DEFAULT_PORT);
    }

    #[test]
    fn reinstall_keeps_the_saved_port_and_new_install_uses_automatic_selection() {
        assert_eq!(preferred_install_port(None, true, 1002), Some(1002));
        assert_eq!(preferred_install_port(None, false, 1002), None);
        assert_eq!(preferred_install_port(Some(1001), true, 1002), Some(1001));
    }

    #[test]
    fn explicit_port_is_rejected_when_already_in_use() {
        let occupied = TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let port = occupied.local_addr().unwrap().port();
        assert_eq!(
            choose_port(Some(port), false).unwrap_err().kind(),
            std::io::ErrorKind::AddrInUse
        );
    }

    #[test]
    fn update_can_reuse_its_saved_port_after_stopping_the_old_process() {
        let listener = TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert_eq!(choose_port(Some(port), true).unwrap(), port);
        assert_eq!(
            choose_port(Some(port), false).unwrap_err().kind(),
            std::io::ErrorKind::AddrInUse
        );
    }
}
