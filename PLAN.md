# План XKeen UI

| ID | Задача | Статус | Критерий приёмки |
|---|---|---:|---|
| BOOT-01 | TypeScript frontend и Rust API на порту 1001 | [x] | UI typecheck/build и Rust fmt/tests/build проходят в GitHub Actions |
| UI-01 | Самостоятельная адаптивная панель по идеям скриншотов и видео | [~] | Самостоятельный тёмный интерфейс; dashboard, редактор YAML, selectors, connections и DNS lookup реализованы частично; DNS settings/settings/core-management остаются |
| SYS-01 | Simulation mode и Linux process probe | [~] | Simulation изолирован; чтение `/proc` не изменяет систему; управляющие действия Mihomo отделены и защищены подтверждением/auth/origin |
| API-01 | Версионируемые API-контракты и ошибки | [ ] | Контракты документированы, некорректные запросы имеют проверяемые ответы |
| AUTH-01 | Локальная авторизация и защита панели | [~] | Router API требует токен; изменяющие Mihomo requests проверяют точное совпадение Origin/Host; полноценные accounts/session и reverse-proxy сценарии ещё не реализованы |
| CORE-REPO-01 | Источники GitHub-релизов Xray/Mihomo в ⚙ | [~] | URL отдельно сохраняются; UI читает GitHub API и показывает ARM64 assets. Установка/обновление ядер и проверка checksum ещё не реализованы |
| XRAY-01 | Интеграция Xray и диагностики | [ ] | Состояние подтверждается API или штатной проверкой целевого ядра |
| MIHOMO-01 | Clash API: группы, selectors, connections и logs | [~] | Чтение proxies/connections/rules/version и переключение Selector подключены; фильтр и явное подтверждение закрытия одного/всех connections готовы; runtime-проверка управляющих действий на реальном ядре не выполнена |
| DNS-01 | Отдельные DNS Mihomo и Xray | [~] | Read-only Mihomo DNS lookup подключён; DNS settings, Xray DNS, validation, backup, apply, rollback не реализованы |
| CONFIG-01 | Редактор YAML/JSON и безопасное применение | [~] | Локальные CodeMirror-вкладки для списков XKeen, YAML Mihomo, JSON/JSONC Xray; изолированное хранение и экспорт; синтаксис и форматирование проверяются по формату. Валидация схем, backup/apply/rollback отсутствуют |
| UTIL-01 | Меню «Утилиты» в конфигурации | [~] | Шаблоны, проверка, форматирование и экспорт черновика доступны как реальные действия; импорт подключений, AmneziaWG, backup, geo scan и route test не показывать как работающие, пока не реализованы |
| DNS-03 | Handoff KeeneticOS/Mihomo и откат DNS/content filter | [!] | Внутренняя вкладка UI добавлена, переключатель недоступен. Требуются RCI snapshot/restore IPv4+IPv6 DNS, DoH/DoT, content filter и dns-override; выключение и отказ Mihomo должны возвращать исходное состояние. Проверять на mocks до любого POST в пользовательский роутер |
| INSTALL-01 | POSIX bootstrap и Rust installer/service lifecycle | [~] | Shell загружает архив и сверяет SHA-256; Rust реализует install/update/remove/service, marker владения директорией, backup/rollback и защищённый конфиг. CI ждёт текущие изменения |
| QUAL-01 | Rust 37–38%, TypeScript 55–60%, Shell 2–3% | GitHub Languages API | [~] | На текущем опубликованном коммите 58.0% TypeScript / 39.5% Rust / 2.4% Shell. Добавить meaningful TS coverage и перепроверить, не оптимизировать цифры искусственно |
| TARGET-01 | Подтвердить модель и архитектуру роутера | [x] | Entware AArch64/glibc 2.27; runtime binary проверен read-only на loopback |
| RELEASE-01 | Опубликовать исходники и совместимые артефакты | [~] | Исходный код опубликован; v0.2.0 — prerelease. Нужен стабильный ARM64 релиз и проверка latest download для curl installer |
| CI-01 | Linux CI для TS, Rust, Shell и router cross-build | [~] | CI `38613741494` для app-update-кода проходит frontend и backend; ожидать router-aarch64 и installer, затем проверить повторно после DNS UI |

Актуальная цель по решению пользователя: TypeScript 55–60%, Rust 37–38%; POSIX Shell используется только для установки XKeen UI (ориентир 2–3%). Это ориентир, а не причина создавать пустые модули или искусственный код. Публикуй фактический подсчёт LOC и отдельно поясняй долю установщика.
