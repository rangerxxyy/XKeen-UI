# План XKeen UI

| ID | Задача | Статус | Критерий приёмки |
|---|---|---:|---|
| BOOT-01 | TypeScript frontend и Rust API на порту 1001 | [x] | UI typecheck/build и Rust fmt/tests/build проходят в GitHub Actions |
| UI-01 | Самостоятельная адаптивная панель по идеям скриншотов и видео | [~] | Самостоятельный тёмный интерфейс; dashboard, редактор YAML, selectors, connections и DNS lookup реализованы частично; DNS settings/settings/core-management остаются |
| SYS-01 | Simulation mode и Linux process probe | [~] | Simulation изолирован; чтение `/proc` не изменяет систему; управляющие действия Mihomo отделены и защищены подтверждением/auth/origin |
| API-01 | Версионируемые API-контракты и ошибки | [ ] | Контракты документированы, некорректные запросы имеют проверяемые ответы |
| AUTH-01 | Локальная авторизация и защита панели | [~] | Router API требует токен; изменяющие Mihomo requests проверяют точное совпадение Origin/Host; полноценные accounts/session и reverse-proxy сценарии ещё не реализованы |
| CORE-REPO-01 | Источники GitHub-релизов Xray/Mihomo в ⚙ | [~] | URL отдельно сохраняются; UI читает GitHub API и показывает ARM64 assets. Rust updater проверяет asset, SHA-256 и ELF/AArch64, сохраняет backup и умеет rollback; реальные пользовательские ядра не обновлялись |
| APP-UPD-01 | Обновление XKeen UI из панели и показ CPU | [~] | Проверка обновлений предлагает установку стабильного релиза; backend запускает штатный `install.sh update`; статус показывает CPU по дельте `/proc/stat`. Требуются Rust CI и установка тестовой сборки на роутер |
| XRAY-01 | Интеграция Xray и диагностики | [ ] | Состояние подтверждается API или штатной проверкой целевого ядра |
| MIHOMO-01 | Clash API: группы, selectors, connections и logs | [~] | Чтение proxies/connections/rules/version и переключение Selector подключены; фильтр и явное подтверждение закрытия одного/всех connections готовы; runtime-проверка управляющих действий на реальном ядре не выполнена |
| XKEEN-CTRL-01 | Start/stop/restart XKeen | [~] | Команды выполняются без удержания HTTP-потока у фонового процесса; сервисные операции сериализуются с обновлениями и подтверждают фактическое состояние. Требуется проверка после установки на роутер |
| DNS-01 | DNS Mihomo и Xray | [~] | Read-only Mihomo DNS lookup и системная DNS-диагностика подключены; DNS настройки Xray не реализованы |
| CONFIG-01 | Редактор YAML/JSON и безопасное применение | [~] | Локальные CodeMirror-вкладки для списков XKeen, YAML Mihomo, JSON/JSONC Xray; изолированное хранение и экспорт; синтаксис и форматирование проверяются по формату. Валидация схем, backup/apply/rollback отсутствуют |
| UTIL-01 | Меню «Утилиты» в конфигурации | [~] | Шаблоны, проверка, форматирование и экспорт черновика доступны как реальные действия; импорт подключений, AmneziaWG, backup, geo scan и route test не показывать как работающие, пока не реализованы |
| DNS-03 | Handoff KeeneticOS/Mihomo и откат DNS/content filter | [~] | Добавлены status API, подтверждение передачи, проверка конфига Mihomo, резерв текущих статических IPv4 nameserver и rollback. Реальная передача DNS не включалась; IPv6, DoH/DoT и фильтр контента не сохраняются и не восстанавливаются, поэтому состояние честно обозначено как частичное |
| INSTALL-01 | POSIX bootstrap и Rust installer/service lifecycle | [x] | Shell загружает стабильный ARM64 архив и сверяет SHA-256; Rust реализует install/update/remove/service, marker владения директорией, backup/rollback и защищённый конфиг. Изолированный lifecycle CI проходит. Текущий main добавляет оформленное меню |
| QUAL-01 | Rust 37–38%, TypeScript 55–60%, Shell 2–3% | GitHub Languages API | [~] | Текущий main: около 53.6% TypeScript / 44.2% Rust / 2.1% Shell. TypeScript ниже и Rust выше целевого диапазона; доли отражают фактический исходный код, не подгонять искусственно |
| TARGET-01 | Подтвердить модель и архитектуру роутера | [x] | Entware AArch64/glibc 2.27; runtime binary проверен read-only на loopback |
| RELEASE-01 | Опубликовать исходники и совместимые артефакты | [~] | v0.2.2 опубликован, но найден дефект archive executable bit; исправление в установщике и сборке v0.2.3 ожидает полного CI |
| CI-01 | Linux CI для TS, Rust, Shell и router cross-build | [x] | CI `38618811134` для `2162ffb` полностью прошёл: frontend, backend fmt/tests/build/lifecycle, installer ShellCheck/syntax и AArch64 cross-build |

Актуальная цель по решению пользователя: TypeScript 55–60%, Rust 37–38%; POSIX Shell используется только для установки XKeen UI (ориентир 2–3%). Это ориентир, а не причина создавать пустые модули или искусственный код. Публикуй фактический подсчёт LOC и отдельно поясняй долю установщика.
