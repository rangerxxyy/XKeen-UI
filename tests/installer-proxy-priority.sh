#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT HUP INT TERM
mkdir -p "$TEMP/bin" "$TEMP/package/web"

cat >"$TEMP/bin/uname" <<'EOF'
#!/bin/sh
printf 'aarch64\n'
EOF
cat >"$TEMP/bin/curl" <<'EOF'
#!/bin/sh
set -eu
url=
output=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    http://*|https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
printf '%s\n' "$url" >>"$XKEEN_TEST_URLS"
case "$url" in
  https://github.com/*/xkeen-ui-linux-aarch64.tar.gz)
    [ "${XKEEN_TEST_FAIL_DIRECT:-0}" = 1 ] && exit 22
    cp "$XKEEN_TEST_ARCHIVE" "$output" ;;
  https://github.com/*/SHA256SUMS)
    [ "${XKEEN_TEST_FAIL_DIRECT:-0}" = 1 ] && exit 22
    cp "$XKEEN_TEST_SUMS" "$output" ;;
  https://gh-proxy.com/https://github.com/*/xkeen-ui-linux-aarch64.tar.gz)
    [ "${XKEEN_TEST_FAIL_FIRST_PROXY:-0}" = 1 ] && exit 22
    cp "$XKEEN_TEST_ARCHIVE" "$output" ;;
  https://gh-proxy.com/https://github.com/*/SHA256SUMS)
    [ "${XKEEN_TEST_FAIL_FIRST_PROXY:-0}" = 1 ] && exit 22
    cp "$XKEEN_TEST_SUMS" "$output" ;;
  https://ghfast.top/https://github.com/*/xkeen-ui-linux-aarch64.tar.gz)
    cp "$XKEEN_TEST_ARCHIVE" "$output" ;;
  https://ghfast.top/https://github.com/*/SHA256SUMS)
    cp "$XKEEN_TEST_SUMS" "$output" ;;
  *) exit 22 ;;
esac
EOF
cat >"$TEMP/package/xkeen-ui" <<'EOF'
#!/bin/sh
exit 0
EOF
printf '<!doctype html>\n' >"$TEMP/package/web/index.html"
chmod +x "$TEMP/bin/uname" "$TEMP/bin/curl" "$TEMP/package/xkeen-ui"
tar -czf "$TEMP/xkeen-ui-linux-aarch64.tar.gz" -C "$TEMP/package" .
ARCHIVE_SHA=$(sha256sum "$TEMP/xkeen-ui-linux-aarch64.tar.gz" | awk '{print $1}')
printf '%s  xkeen-ui-linux-aarch64.tar.gz\n' "$ARCHIVE_SHA" >"$TEMP/SHA256SUMS"
: >"$TEMP/urls.txt"

PATH="$TEMP/bin:$PATH" \
XKEEN_TEST_URLS="$TEMP/urls.txt" \
XKEEN_TEST_ARCHIVE="$TEMP/xkeen-ui-linux-aarch64.tar.gz" \
XKEEN_TEST_SUMS="$TEMP/SHA256SUMS" \
  sh "$ROOT/install.sh" install --prefix "$TEMP/prefix"

FIRST_URL=$(sed -n '1p' "$TEMP/urls.txt")
case "$FIRST_URL" in
  https://github.com/*/releases/latest/download/xkeen-ui-linux-aarch64.tar.gz) ;;
  *) printf 'Expected direct GitHub first, got: %s\n' "$FIRST_URL" >&2; exit 1 ;;
esac
if grep -q 'api.github.com' "$TEMP/urls.txt"; then
  printf 'Latest install should download release assets without querying the GitHub API.\n' >&2
  exit 1
fi
if [ "$(wc -l <"$TEMP/urls.txt" | tr -d '[:space:]')" -ne 2 ]; then
  printf 'Latest installation should fetch only the archive and its checksum.\n' >&2
  exit 1
fi

: >"$TEMP/urls.txt"
PATH="$TEMP/bin:$PATH" \
XKEEN_TEST_URLS="$TEMP/urls.txt" \
XKEEN_TEST_ARCHIVE="$TEMP/xkeen-ui-linux-aarch64.tar.gz" \
XKEEN_TEST_SUMS="$TEMP/SHA256SUMS" \
XKEEN_TEST_FAIL_DIRECT=1 \
XKEEN_TEST_FAIL_FIRST_PROXY=1 \
  sh "$ROOT/install.sh" update --prefix "$TEMP/prefix" --version v0.2.23
FIRST_PINNED_URL=$(sed -n '1p' "$TEMP/urls.txt")
case "$FIRST_PINNED_URL" in
  https://github.com/*/releases/download/v0.2.23/xkeen-ui-linux-aarch64.tar.gz) ;;
  *) printf 'Expected pinned direct GitHub asset path, got: %s\n' "$FIRST_PINNED_URL" >&2; exit 1 ;;
esac
SECOND_PINNED_URL=$(sed -n '2p' "$TEMP/urls.txt")
case "$SECOND_PINNED_URL" in
  https://gh-proxy.com/https://github.com/*/releases/download/v0.2.23/xkeen-ui-linux-aarch64.tar.gz) ;;
  *) printf 'Expected first proxy fallback, got: %s\n' "$SECOND_PINNED_URL" >&2; exit 1 ;;
esac
THIRD_PINNED_URL=$(sed -n '3p' "$TEMP/urls.txt")
case "$THIRD_PINNED_URL" in
  https://ghfast.top/https://github.com/*/releases/download/v0.2.23/xkeen-ui-linux-aarch64.tar.gz) ;;
  *) printf 'Expected fallback to ghfast.top, got: %s\n' "$THIRD_PINNED_URL" >&2; exit 1 ;;
esac
if [ "$(wc -l <"$TEMP/urls.txt" | tr -d '[:space:]')" -ne 6 ]; then
  printf 'Expected one direct plus two proxy attempts for archive and checksum.\n' >&2
  exit 1
fi
printf 'Installer used GitHub directly, then bounded proxy fallbacks when simulated failures occurred.\n'
