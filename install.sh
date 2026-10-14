#!/bin/sh
# Minimal Entware bootstrap; lifecycle, permissions, rollback and service control live in Rust.
set -eu
REPOSITORY=${XKEEN_REPOSITORY:-rangerxxyy/XKeen-UI}
PREFIX=${XKEEN_PREFIX:-/opt}
if [ "$#" -eq 0 ] && [ -r /dev/tty ]; then
  printf '\033[2J\033[H'
  printf '\033[38;5;141m'
  cat <<'BANNER'
   _  __  __ __                       __  __ ____
  | |/ / / //_/___   ___   ____      / / / //  _/
  |   / / ,<  / _ \ / _ \ / __ \    / / / / / /
 /   | / /| |/ __// __// / / / /_/ /_/ /
/_/|_|/_/ |_|\___/\___//_/ /_/ \____//___/
BANNER
  machine=$(uname -m 2>/dev/null || printf unknown)
  case "$machine" in aarch64|arm64) machine=arm64-v8a ;; esac
  printf '\033[38;5;51mАрхитектура: %s\033[0m\n' "$machine"
  if [ -x "$PREFIX/share/xkeen-ui/xkeen-ui" ]; then
    panel_status=$("$PREFIX/share/xkeen-ui/xkeen-ui" service status --prefix "$PREFIX" 2>/dev/null || true)
    case "$panel_status" in
      *остановлен*) panel_status=остановлена ;;
      *запущен*) panel_status=запущена ;;
      *) panel_status=неизвестно ;;
    esac
  else
    panel_status=не_установлена
  fi
  printf '\033[38;5;51mСтатус панели: %s\033[0m\n' "$panel_status"
  printf '\n  1. Установить / переустановить\n  2. Обновить\n  3. Удалить\n  0. Выход\n\n> '
  IFS= read -r choice < /dev/tty || exit 0
  case "$choice" in
    1) set -- install ;;
    2) set -- update ;;
    3) set -- remove ;;
    0|'') exit 0 ;;
    *) printf 'Неизвестный пункт меню.\n' >&2; exit 2 ;;
  esac
fi
ACTION=${1:-install}
APP_DIR=$PREFIX/share/xkeen-ui
shift || true
PORT=

fail() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) [ "$#" -ge 2 ] || fail 'укажите порт'; PORT=$2; shift ;;
    --prefix) [ "$#" -ge 2 ] || fail 'укажите каталог'; PREFIX=$2; APP_DIR=$PREFIX/share/xkeen-ui; shift ;;
    -h|--help) printf 'install.sh [install|update|remove] [--port PORT] [--prefix DIR]\n'; exit 0 ;;
    *) fail "неизвестный аргумент: $1" ;;
  esac
  shift
done
case "$PREFIX" in /*) ;; *) fail 'путь установки должен быть абсолютным' ;; esac
case "$PREFIX" in *..*|*[!A-Za-z0-9_./-]*) fail 'путь установки содержит недопустимые символы' ;; esac
case "$REPOSITORY" in */*) ;; *) fail 'репозиторий должен иметь формат владелец/репозиторий' ;; esac
case "$REPOSITORY" in */*/*|*..*|*[!A-Za-z0-9_./-]*) fail 'некорректный GitHub-репозиторий' ;; esac
case "$PORT" in '' ) ;; *[!0-9]*) fail 'порт должен быть числом от 1 до 65535' ;; esac
if [ -n "$PORT" ] && { [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; }; then
  fail 'порт должен быть числом от 1 до 65535'
fi
case "$ACTION" in install|update) ;; remove) [ -x "$APP_DIR/xkeen-ui" ] || fail 'XKeen UI не установлен'; exec "$APP_DIR/xkeen-ui" remove --prefix "$PREFIX" ;; *) fail 'действие: install, update или remove' ;; esac

has curl || fail 'не найдена команда curl'
has tar || fail 'не найдена команда tar'
has sha256sum || fail 'не найдена sha256sum; проверка архива обязательна'
has awk || fail 'не найдена команда awk'
machine=$(uname -m 2>/dev/null) || fail 'не удалось определить архитектуру'
case "$machine" in aarch64|arm64) ARCH=aarch64 ;; *) fail "архитектура $machine пока не включена в release" ;; esac
WORK=$(mktemp -d "${TMPDIR:-/tmp}/xkeen-ui.XXXXXX") || fail 'не удалось создать временный каталог'
trap 'rm -rf "$WORK"' 0
trap 'exit 1' HUP INT TERM
ARCHIVE="xkeen-ui-linux-$ARCH.tar.gz"
RELEASE_JSON=$(curl -fsSL --retry 2 --connect-timeout 15 --max-filesize 1048576 "https://api.github.com/repos/$REPOSITORY/releases/latest") || fail 'не удалось определить стабильный release'
VERSION=$(printf '%s\n' "$RELEASE_JSON" | sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"\([A-Za-z0-9._-][A-Za-z0-9._-]*\)"[,]\{0,1\}$/\1/p' | sed -n '1p')
[ -n "$VERSION" ] || fail 'GitHub не вернул tag стабильного release'
case "$VERSION" in *[!A-Za-z0-9._-]*) fail 'GitHub вернул некорректный tag release' ;; esac
BASE="https://github.com/$REPOSITORY/releases/download/$VERSION"
curl -fsSL --retry 2 --connect-timeout 15 --max-filesize 52428800 "$BASE/$ARCHIVE" -o "$WORK/$ARCHIVE" || fail 'не удалось получить release'
curl -fsSL --retry 2 --connect-timeout 15 "$BASE/SHA256SUMS" -o "$WORK/SHA256SUMS" || fail 'не удалось получить SHA256SUMS'
EXPECTED=$(awk -v file="$ARCHIVE" '$2 == file || $2 == "*" file {print $1; exit}' "$WORK/SHA256SUMS")
[ -n "$EXPECTED" ] || fail "в SHA256SUMS нет записи для $ARCHIVE"
ACTUAL=$(sha256sum "$WORK/$ARCHIVE" | awk '{print $1}')
[ "$ACTUAL" = "$EXPECTED" ] || fail 'контрольная сумма не совпала'
mkdir "$WORK/unpacked" || fail 'не удалось создать каталог распаковки'
tar -xzf "$WORK/$ARCHIVE" -C "$WORK/unpacked" || fail 'не удалось распаковать release'
[ -x "$WORK/unpacked/xkeen-ui" ] || fail 'в архиве отсутствует исполняемый файл'
[ -f "$WORK/unpacked/web/index.html" ] || fail 'в архиве отсутствует frontend'
set -- "$ACTION" --prefix "$PREFIX" --package-dir "$WORK/unpacked"
[ -z "$PORT" ] || set -- "$@" --port "$PORT"
"$WORK/unpacked/xkeen-ui" "$@"
