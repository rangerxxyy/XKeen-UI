# XKeen UI v0.4.0

## Highlights

- Browse Mihomo configuration backups from the editor and restore a selected backup. The backend accepts only generated backup names, limits the listing and file size, validates with Mihomo, saves the current configuration first, and uses the existing restart and rollback flow.
- Make router journal entries easier to scan by hiding internal metadata, separating severity and timestamp, pausing routine refresh, and copying only filtered visible entries.
- Warn when Mihomo uses `fake-ip` with the default or explicit `blacklist` filter mode, with a link to the Mihomo documentation. The panel does not modify DNS settings automatically.
- Clarify that closing a connection closes the active Mihomo socket; an application may reconnect and create a new row.
- Keep installation and update behavior isolated from an existing XKeen UI service, and provide the one-line `curl https://raw.githubusercontent.com/rangerxxyy/XKeen-UI/main/install.sh | sh` command.

## Validation

- 200 frontend tests pass.
- TypeScript and Vite production build pass.
- Linux backend tests, installer lifecycle checks, shell checks, and the AArch64 package build are verified in GitHub Actions for the release commit.

## Known limitations

- The API does not provide account or session authentication. Keep the panel on the trusted LAN or behind a VPN/authenticated gateway; do not expose it directly through KeenDNS or the public internet.
- Geo database scanning, route testing, plugin-based multi-router config application, and HTTP subscription preview are not included in this release.
