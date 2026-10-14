#!/bin/sh
# POSIX ash/Entware installer for XKeen UI release archives.
set -u
REPOSITORY=${XKEEN_REPOSITORY:-rangerxxyy/XKeen-UI}
PORT=${XKEEN_PORT:-1001}
PREFIX=${XKEEN_PREFIX:-/opt}
ACTION=menu

say() { printf '%s\n' "$*"; }
fail() { say "Ошибка: $*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    install|update|remove) ACTION=$1 ;;
    --port) [ "$#" -ge 2 ] || fail 'укажите порт'; PORT=$2; shift ;;
    --prefix) [ "$#" -ge 2 ] || fail 'укажите каталог'; PREFIX=$2; shift ;;
    -h|--help) say 'install.sh [install|update|remove] [--port PORT] [--prefix DIR]'; exit 0 ;;
    *) fail "неизвестный аргумент: $1" ;;
  esac
  shift
done
case "$PORT" in ''|*[!0-9]*) fail 'порт должен быть числом от 1 до 65535' ;; esac
[ "$PORT" -ge 1 ] 2>/dev/null && [ "$PORT" -le 65535 ] 2>/dev/null || fail 'порт должен быть числом от 1 до 65535'
case "$PREFIX" in /*) ;; *) fail 'путь установки должен быть абсолютным' ;; esac
case "$PREFIX" in *[!A-Za-z0-9_./-]*|*..*) fail 'путь установки содержит недопустимые символы' ;; esac
APP_DIR=$PREFIX/share/xkeen-ui
ETC_DIR=$PREFIX/etc
CONFIG_FILE=$ETC_DIR/xkeen-ui.env
SERVICE_FILE=$ETC_DIR/init.d/S99xkeen-ui
ACCESS_TOKEN=

confirm() {
  printf '%s [y/N]: ' "$1"
  if [ -r /dev/tty ]; then IFS= read -r answer </dev/tty || exit 1
  elif [ -t 0 ]; then IFS= read -r answer || exit 1
  else fail 'для подтверждения нужен активный терминал'; fi
  case "$answer" in y|Y|yes|YES|д|Д|да|ДА) return 0 ;; *) say 'Операция отменена.'; exit 0 ;; esac
}
detect_arch() {
  machine=$(uname -m 2>/dev/null) || fail 'не удалось определить архитектуру'
  case "$machine" in
    aarch64|arm64) printf '%s' aarch64 ;;
    armv7l|armv7) printf '%s' armv7 ;;
    armv6l) printf '%s' armv6 ;;
    mipsel|mipsel*) printf '%s' mipsel ;;
    x86_64|amd64) printf '%s' x86_64 ;;
    *) fail "архитектура $machine пока не включена в release" ;;
  esac
}
menu() {
  while :; do
    printf '\n XKeen UI v0.1.0\n ─────────────────────────\n 1. Установить / переустановить UI\n 2. Обновить UI\n 3. Полностью удалить UI\n 4. Выход\n\nВыберите действие: '
    IFS= read -r choice || exit 0
    case "$choice" in
      1) install_app ;;
      2) update_app ;;
      3) remove_app ;;
      4|0|'') exit 0 ;;
      *) say 'Введите 1, 2, 3 или 4.' ;;
    esac
  done
}
download_release() {
  has curl || fail 'не найдена команда curl'
  has tar || fail 'не найдена команда tar'
  has sha256sum || fail 'не найдена sha256sum; невозможно проверить архив'
  has awk || fail 'не найдена команда awk'
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/xkeen-ui.XXXXXX") || fail 'не удалось создать временный каталог'
  trap 'rm -rf "$WORK"' 0
  trap 'exit 1' HUP INT TERM
  arch=$(detect_arch)
  archive="xkeen-ui-linux-${arch}.tar.gz"
  base="https://github.com/$REPOSITORY/releases/latest/download"
  curl -fL --retry 2 --connect-timeout 15 "$base/$archive" -o "$WORK/$archive" || fail 'не удалось получить release'
  curl -fL --retry 2 --connect-timeout 15 "$base/SHA256SUMS" -o "$WORK/SHA256SUMS" || fail 'не удалось получить SHA256SUMS'
  expected=$(awk -v file="$archive" '$2 == file || $2 == "*" file {print $1; exit}' "$WORK/SHA256SUMS")
  [ -n "$expected" ] || fail "в SHA256SUMS нет записи для $archive"
  actual=$(sha256sum "$WORK/$archive" | awk '{print $1}')
  [ "$actual" = "$expected" ] || fail 'контрольная сумма не совпала'
  mkdir "$WORK/unpacked" || fail 'не удалось создать каталог распаковки'
  tar -xzf "$WORK/$archive" -C "$WORK/unpacked" || fail 'не удалось распаковать release'
  [ -x "$WORK/unpacked/xkeen-ui" ] || fail 'в архиве отсутствует исполняемый файл'
  [ -f "$WORK/unpacked/web/index.html" ] || fail 'в архиве отсутствует frontend'
}
write_service() {
  mkdir -p "$ETC_DIR/init.d" "$PREFIX/var/run" || fail 'не удалось создать каталоги службы'
  cat > "$SERVICE_FILE" <<'SERVICE'
#!/bin/sh
PREFIX=/opt
APP_DIR=$PREFIX/share/xkeen-ui
CONFIG=$PREFIX/etc/xkeen-ui.env
PIDFILE=$PREFIX/var/run/xkeen-ui.pid
PORT=1001
TOKEN=
if [ -r "$CONFIG" ]; then
  configured_port=$(sed -n 's/^XKEEN_PORT=//p' "$CONFIG" | sed -n '1p')
  case "$configured_port" in ''|*[!0-9]*) ;; *) PORT=$configured_port ;; esac
  TOKEN=$(sed -n 's/^XKEEN_TOKEN=//p' "$CONFIG" | sed -n '1p')
fi
case "$TOKEN" in *[!a-f0-9]*|'') echo 'Нет действительного XKEEN_TOKEN'; exit 1 ;; esac
owns_pid() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ -r "/proc/$1/exe" ] || return 1
  executable=$(readlink "/proc/$1/exe" 2>/dev/null) || return 1
  [ "$executable" = "$APP_DIR/xkeen-ui" ]
}
start() {
  if [ -r "$PIDFILE" ]; then
    pid=$(cat "$PIDFILE")
    if owns_pid "$pid"; then echo 'XKeen UI уже запущен'; return 0; fi
    rm -f "$PIDFILE"
  fi
  mkdir -p "$(dirname "$PIDFILE")" || return 1
  XKEEN_PORT=$PORT XKEEN_MODE=router XKEEN_TOKEN=$TOKEN XKEEN_WEB_ROOT="$APP_DIR/web" "$APP_DIR/xkeen-ui" >/dev/null 2>&1 &
  echo $! > "$PIDFILE"; sleep 1
  kill -0 "$(cat "$PIDFILE")" 2>/dev/null || { rm -f "$PIDFILE"; echo 'Не удалось запустить'; return 1; }
  echo "XKeen UI запущен на порту $PORT"
}
stop() {
  [ -r "$PIDFILE" ] || { echo 'XKeen UI не запущен'; return 0; }
  pid=$(cat "$PIDFILE")
  if ! owns_pid "$pid"; then rm -f "$PIDFILE"; echo 'Удалена устаревшая запись PID'; return 0; fi
  kill "$pid" 2>/dev/null || return 1
  attempts=0
  while owns_pid "$pid" && [ "$attempts" -lt 5 ]; do sleep 1; attempts=$((attempts + 1)); done
  if owns_pid "$pid"; then echo 'Процесс не остановился; PID сохранён'; return 1; fi
  rm -f "$PIDFILE"; echo 'XKeen UI остановлен'
}
status() { [ -r "$PIDFILE" ] && owns_pid "$(cat "$PIDFILE")" && echo 'XKeen UI запущен' || echo 'XKeen UI остановлен'; }
case "${1:-status}" in start) start ;; stop) stop ;; restart) stop; start ;; status) status ;; *) exit 2 ;; esac
SERVICE
  if [ "$PREFIX" != /opt ]; then sed "s|/opt|$PREFIX|g" "$SERVICE_FILE" > "$SERVICE_FILE.tmp" && mv "$SERVICE_FILE.tmp" "$SERVICE_FILE" || fail 'не удалось настроить службу'; fi
  chmod 755 "$SERVICE_FILE" || fail 'не удалось установить права службы'
}
install_app() {
  confirm "Установить XKeen UI в $APP_DIR на порту $PORT?"
  [ -w "$PREFIX" ] || fail "нет прав записи в $PREFIX; запустите от root"
  has readlink || fail 'не найдена readlink; безопасная проверка процесса недоступна'
  has od || fail 'не найдена od для безопасного создания ключа панели'
  has dd || fail 'не найдена dd для безопасного создания ключа панели'
  has tr || fail 'не найдена tr для безопасного создания ключа панели'
  if [ -r "$CONFIG_FILE" ]; then ACCESS_TOKEN=$(sed -n 's/^XKEEN_TOKEN=//p' "$CONFIG_FILE" | sed -n '1p'); fi
  case "$ACCESS_TOKEN" in *[!a-f0-9]*|'') ACCESS_TOKEN= ;; esac
  if [ -z "$ACCESS_TOKEN" ]; then ACCESS_TOKEN=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n'); fi
  [ "${#ACCESS_TOKEN}" -eq 64 ] || fail 'не удалось создать безопасный ключ доступа'
  download_release
  mkdir -p "$PREFIX/share" "$ETC_DIR" || fail 'не удалось создать каталоги'
  if [ -d "$APP_DIR" ]; then stamp=$(date +%Y%m%d%H%M%S 2>/dev/null || echo backup); mv "$APP_DIR" "$APP_DIR.backup.$stamp" || fail 'не удалось сохранить текущую версию'; fi
  mv "$WORK/unpacked" "$APP_DIR" || fail 'не удалось установить файлы'
  (umask 077; printf 'XKEEN_PORT=%s\nXKEEN_TOKEN=%s\n' "$PORT" "$ACCESS_TOKEN" > "$CONFIG_FILE.tmp") && chmod 600 "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE" || fail 'не удалось сохранить настройки доступа'
  write_service
  "$SERVICE_FILE" start || fail 'файлы размещены, но запуск службы не прошёл; предыдущая версия сохранена'
  say "Ключ доступа (сохраните его): $ACCESS_TOKEN"
  say "Готово: http://<IP-роутера>:$PORT"
}
update_app() {
  [ -d "$APP_DIR" ] || fail 'XKeen UI не установлен'
  has readlink || fail 'не найдена readlink; безопасная проверка процесса недоступна'
  confirm 'Обновить XKeen UI до последнего release?'
  if [ -r "$CONFIG_FILE" ]; then saved_port=$(sed -n 's/^XKEEN_PORT=//p' "$CONFIG_FILE" | sed -n '1p'); case "$saved_port" in ''|*[!0-9]*) ;; *) PORT=$saved_port ;; esac; fi
  download_release
  "$SERVICE_FILE" stop || fail 'не удалось остановить службу'
  stamp=$(date +%Y%m%d%H%M%S 2>/dev/null || echo backup)
  mv "$APP_DIR" "$APP_DIR.backup.$stamp" || fail 'не удалось сохранить текущую версию'
  if mv "$WORK/unpacked" "$APP_DIR"; then write_service; if "$SERVICE_FILE" start; then say 'Обновление запущено; backup сохранён.'; return 0; fi; fi
  rm -rf "$APP_DIR"; mv "$APP_DIR.backup.$stamp" "$APP_DIR" || fail 'автооткат не удался; backup сохранён рядом'
  write_service; "$SERVICE_FILE" start || true
  fail 'новая версия не запустилась; предыдущая версия восстановлена'
}
remove_app() {
  [ -d "$APP_DIR" ] || fail 'каталог приложения не найден'
  confirm 'Удалить панель? Конфигурация и backup-каталоги останутся.'
  [ -x "$SERVICE_FILE" ] && "$SERVICE_FILE" stop || true
  rm -rf "$APP_DIR"; rm -f "$SERVICE_FILE"
  say 'Файлы панели удалены; конфигурация и резервные копии сохранены.'
}
case "$ACTION" in menu) menu ;; install) install_app ;; update) update_app ;; remove) remove_app ;; esac
