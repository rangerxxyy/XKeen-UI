# План XKeen UI

| ID | Задача | Статус | Критерий приёмки |
|---|---|---:|---|
| BOOT-01 | TypeScript frontend и Rust API на порту 1001 | [x] | UI typecheck/build и Rust fmt/tests/build проходят в GitHub Actions |
| UI-01 | Самостоятельная адаптивная панель по идеям скриншотов и видео | [~] | Самостоятельный тёмный интерфейс; dashboard, редактор YAML, selectors, connections и DNS lookup реализованы частично; DNS settings/settings/core-management остаются |
| SYS-01 | Simulation mode и Linux process probe | [~] | Simulation изолирован; чтение `/proc` не изменяет систему; управляющие действия Mihomo отделены и защищены подтверждением/auth/origin |
| API-01 | Версионируемые API-контракты и ошибки | [ ] | Контракты документированы, некорректные запросы имеют проверяемые ответы |
| AUTH-01 | Локальная авторизация и защита панели | [~] | Router API требует токен; изменяющие Mihomo requests проверяют точное совпадение Origin/Host; полноценные accounts/session и reverse-proxy сценарии ещё не реализованы |
| XRAY-01 | Интеграция Xray и диагностики | [ ] | Состояние подтверждается API или штатной проверкой целевого ядра |
| MIHOMO-01 | Clash API: группы, selectors, connections и logs | [~] | Чтение proxies/connections/rules/version и переключение Selector подключены; фильтр и явное подтверждение закрытия одного/всех connections готовы; runtime-проверка управляющих действий на реальном ядре не выполнена |
| DNS-01 | Отдельные DNS Mihomo и Xray | [~] | Read-only Mihomo DNS lookup подключён; DNS settings, Xray DNS, validation, backup, apply, rollback не реализованы |
| CONFIG-01 | Редактор YAML/JSON и безопасное применение | [~] | Локальные CodeMirror-вкладки config/ip_exclude/port_exclude/port_proxying/xkeen; изолированное хранение и экспорт; YAML syntax check/format для config. JSON/JSONC, Mihomo schema validation, backup/apply/rollback отсутствуют |
| INSTALL-01 | POSIX installer, service, update/remove | [~] | ash/shellcheck, подтверждения, checksum, backup и отказоустойчивость |
| TARGET-01 | Подтвердить модель и архитектуру роутера | [x] | Entware AArch64/glibc 2.27; runtime binary проверен read-only на loopback |
| RELEASE-01 | Опубликовать исходники и совместимые артефакты | [~] | Исходный код опубликован; release намеренно не создан, установочная инструкция не публикуется |
| CI-01 | Linux CI для TS, Rust, Shell и router cross-build | [x] | GitHub Actions прошёл; AArch64 Entware test artifact собран |

Актуальная цель по решению пользователя: TypeScript 55–60%, Rust 38–40%; POSIX Shell используется только для установки XKeen UI (ориентир 2–3%). Это ориентир, а не причина создавать пустые модули или искусственный код. Публикуй фактический подсчёт LOC и отдельно поясняй долю установщика.
