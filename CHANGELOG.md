# Changelog

## v0.5.6 — 2026-10-18

- **Selectors:** enlarge and brighten ping feedback, keep it aligned to the card edge, and remove the extra selector-list space. Proxy selection now uses one Mihomo request instead of a separate inventory request followed by the switch.
- **DNS:** remove manual status refresh, retain status between visits, grow resolver textareas with their contents, and keep transfer warnings behind the confirmation step.
- **Connections:** keep the selector proxy icons and improve table readability and close controls.
- **Configuration:** use the upstream YAML palette and indentation guides, put DNS after Configuration, render release notes safely, and keep edit/apply controls readable.
- **Core management:** simplify release-note rendering, preserve safe links, remove raw embedded image markup from release notes, and use a bounded Tokio worker pool for the router backend.
- **Utilities:** put proxy addition, templates, AmneziaWG import, and documentation links in the requested order; remove the backups menu entry.
- **Status:** show the stopped state in red and keep the green running pulse at a low-motion two-second cycle. Preserve the router's nominal 512 MB total when displaying memory.
- **Validation:** frontend tests, typecheck, production build, and diff whitespace checks pass. Router RSS and live selector timing still need a post-install measurement.
