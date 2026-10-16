# XKeen UI settings and visual refactor

## Goal

Improve readability, alignment, and predictable behavior across settings, DNS, connections, and the Mihomo configuration editor while preserving current API and DOM hooks.

## Constraints

- Preserve existing IDs, data attributes, and classes used by handlers and API behavior.
- Keep dependencies unchanged; use the existing TypeScript, Rust, CodeMirror, and plain CSS stack.
- Keep router-changing operations behind existing validation, confirmation, backup, and rollback paths.
- Store browser presentation/preferences in localStorage; keep core sources in their existing router-side settings API. Automatic checks run only while the panel is open.
- Do not add nonfunctional controls for GUI mode or plugins: the supplied images show only their tab labels and no behavior or fields.
- Preserve the project's independent design; screenshots inform usability and color tokens, not pixel copying.

## Experience changes

- Establish a compact typography and spacing scale and use consistent flex/grid alignment for headers, icons, labels, controls, and metadata.
- Improve DNS cards, form labels, contrast, field sizing, and secondary guidance while retaining DNS handoff warnings and existing forms.
- Align connection rows and application glyphs without changing their semantics or selectors.
- Align the CodeMirror palette with the supplied dark navy editor reference and use matching blue/green accents for status and actions.
- Expand settings with General, Mihomo, and Updates areas backed by explicit browser preferences and existing core-source persistence. Keep existing `settings-general`, `settings-sources`, `settings-content`, source input IDs and save action.
- Implement only preference behaviors supported by existing application pathways; any new backend request parameters must be validated and have bounded values.
- Keep modal transitions within 150–250ms and honor reduced-motion preferences; avoid changing content height during tab switches.

## Non-goals

- Replacing CSS with inline styles or injecting styles from TypeScript.
- Adding a plugin system or a new GUI mode without product behavior to support it.
- Changing router DNS, proxy, or service behavior outside existing safe operations.
- Publishing a release as part of this task.

## Video evidence

The local MP4 path could not be opened directly, but the user later supplied a YouTube link to the same 4:18 recording. The recording was visually reviewed from beginning to end in short seek intervals. It shows selectors/connections, DNS settings and handoff confirmation, YAML template import/editor, the Mihomo update dialog, and the Mihomo settings tab. YouTube reports subtitles unavailable, so this review is visual rather than a transcript/audio review.

## Implementation evidence (2026-10-16)

- `pnpm build` succeeded after implementation.
- `rustfmt --edition 2021 --check backend/src/main.rs backend/src/mihomo.rs` succeeded.
- `cargo check --locked` could not complete because the local MSVC toolchain is missing `link.exe`; backend compilation remains pending Linux CI or a Windows C++ linker.
- Browser inspection covered settings General/Mihomo/Updates, DNS layout, and the YAML editor. Router-only data returned HTTP 500 because the Vite page was opened without the router backend; no router behavior was exercised.
- A 390px browser viewport exposed page overflow from full-size release buttons and compressed journal controls. Mobile release buttons now use accessible icon controls, the journal toolbar has a full-width filter and stable action columns, and the config navigation fits without page overflow. The document width was observed at 390px for a 390px viewport.
- XKeen lifecycle requests now write requested and completed entries to the existing UI journal; the header shows an animated start spinner and refreshes actual service status after a failed control request.
- `pnpm test -- --reporter=dot` passes 104/104 tests after restoring the connection renderer's legacy default (source IP unless source-name display is explicitly enabled).
