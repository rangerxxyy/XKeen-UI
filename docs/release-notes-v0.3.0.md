# XKeen UI v0.3.0

## Mihomo subscription providers

- Added support for HTTP(S) Mihomo subscription URLs in «Добавить подключение».
- Added editable provider name, subscription refresh interval, health check, HTTP headers, connection filters, and UDP override.
- Added Settings/YAML preview, copy-to-clipboard, insertion at the beginning or end of `proxy-providers`, and replacement of an existing provider while keeping its name and group references.
- Subscription contents are fetched by Mihomo at runtime; the UI only writes the provider URL and options into the local configuration draft.
- Existing single-node URI import remains available.

## Interface

- Refined typography, contrast, form outlines, labels, helper text, and responsive layout in the add-connection dialog.

## Verification

- 147 frontend tests passed.
- TypeScript typecheck and production build passed.
- Browser preview verified subscription settings, generated YAML, and insertion into the local draft.
