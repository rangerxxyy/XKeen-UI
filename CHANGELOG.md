# Changelog

## v0.6.0 — 2026-10-18

- **Навигация:** разместить «Рулсеты» и «Подписки» справа от разделов; порядок разделов — «Селекторы», «Соединения», «Конфигурация», DNS.
- **Рулсеты:** исключить proxy-groups из списка провайдеров правил и корректно читать inline-конфигурации rule-set.
- **Обновление UI:** заменить значок на белую иконку коробок.
- **Подсказки:** заменить стандартные браузерные плашки единым тематическим tooltip с клавиатурным фокусом.
- **Пинг:** увеличить цифры до 18px, чтобы значение читалось отдельно от иконки.
- **Проверка:** frontend-тесты, typecheck, production build, backend tests/lifecycle и ARM64 musl cross-build проходят в CI. Проверку RSS, latency, DNS и live-подписок на роутере должен выполнить владелец устройства.

## v0.5.8 — 2026-10-18

- **Подписки:** добавить управление proxy-providers Mihomo с поиском, числом узлов, типом источника, трафиком, сроком действия, временем обновления, просмотром узлов и обновлением одного или всех провайдеров.
- **Импорт прокси:** оставить HTTPS-ссылки подписок в штатном сценарии генерации `proxy-provider` и применения к выбранным группам Mihomo.
- **Рулсеты:** добавить просмотр файлов rule-set из конфигурации Mihomo, включая локальные файлы и кешированные MRS с ограничением размера.
- **Селекторы и обновления:** уточнить цветовые уровни пинга, выровнять стрелки маршрутов, улучшить FAQ-подсказки и привести диалоги обновления ядер и панели к единому виду.
- **Проверка:** локально прошли 279 тестов, typecheck и production build; GitHub CI прошёл frontend, installer, backend lifecycle и AArch64 cross-build. Реальное обновление подписки, DNS handoff/rollback, RAM и задержку переключения нужно проверить на роутере.

## v0.5.7 — 2026-10-18

- **Selectors:** keep the selected proxy responsive while selector requests are serialized, close active connections associated with the switched group after a selection change, and make each node's ping brighter and easier to read at the card's lower-right corner.
- **Connections:** display the selector's proxy icons at the 18px size used by the upstream reference.
- **Configuration:** place the event journal below the editor so the page can scroll to it; separate and outline the primary `config` tab; remove the obsolete core-switch explanation and Done button.
- **Status and utilities:** align the status controls and utility menu with the requested layout, and keep recovery backups available internally while removing the backups menu entry.
- **Navigation:** use the requested order: Selectors, Connections, DNS, Configuration.
- **Validation:** all four GitHub CI jobs passed on the candidate code. Target-router RAM/latency measurements and live DNS/subscription checks remain to be performed by the user.

## v0.5.6 — 2026-10-18

- **Selectors:** enlarge and brighten ping feedback, keep it aligned to the card edge, and remove the extra selector-list space. Proxy selection now uses one Mihomo request instead of a separate inventory request followed by the switch.
- **DNS:** remove manual status refresh, retain status between visits, grow resolver textareas with their contents, and keep transfer warnings behind the confirmation step.
- **Connections:** keep the selector proxy icons and improve table readability and close controls.
- **Configuration:** use the upstream YAML palette and indentation guides, put DNS after Configuration, render release notes safely, and keep edit/apply controls readable.
- **Status bar:** align and outline the service controls and clarify the running/stopped indicators.
- **Core management:** simplify release-note rendering, preserve safe links, remove raw embedded image markup from release notes, and use a bounded Tokio worker pool for the router backend.
- **Utilities:** put proxy addition, templates, AmneziaWG import, and documentation links in the requested order; remove the backups menu entry.
- **Status:** show the stopped state in red and keep the green running pulse at a low-motion two-second cycle. Preserve the router's nominal 512 MB total when displaying memory.
- **Validation:** frontend tests, typecheck, production build, and diff whitespace checks pass. Router RSS and live selector timing still need a post-install measurement.
