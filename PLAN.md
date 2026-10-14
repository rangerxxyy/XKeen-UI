# План XKeen UI

| ID | Задача | Статус | Критерий приёмки |
|---|---|---:|---|
| BOOT-01 | TypeScript frontend и Rust API на порту 1001 | [~] | UI typecheck/build проходят; Rust tests/build ждут Linux CI, т.к. Windows linker отсутствует |
| UI-01 | Самостоятельная адаптивная панель по идеям скриншотов и видео | [~] | Каркас и конфигурационный экран готовы; остальные runtime-разделы требуют API |
| SYS-01 | Simulation mode и read-only Linux process probe | [~] | Simulation не трогает систему; недоступные статусы не подменяются |
| API-01 | Версионируемые API-контракты и ошибки | [ ] | Контракты документированы, некорректные запросы имеют проверяемые ответы |
| AUTH-01 | Локальная авторизация и защита панели | [~] | Router read-only status API требует token; полноценная модель login/session/CSRF не реализована |
| XRAY-01 | Интеграция Xray и диагностики | [ ] | Состояние подтверждается API или штатной проверкой целевого ядра |
| MIHOMO-01 | Clash API: группы, selectors, connections и logs | [ ] | Действия подтверждаются фактическим runtime-состоянием |
| DNS-01 | Отдельные DNS Mihomo и Xray | [ ] | Валидация, backup, apply, rollback проверены |
| CONFIG-01 | Редактор YAML/JSON и безопасное применение | [~] | Локальный CodeMirror YAML-черновик, подсветка, форматирование и синтаксическая проверка готовы; Mihomo schema validation, backup/apply/rollback отсутствуют |
| INSTALL-01 | POSIX installer, service, update/remove | [~] | ash/shellcheck, подтверждения, checksum, backup и отказоустойчивость |
| TARGET-01 | Подтвердить модель и архитектуру роутера | [ ] | Зафиксированы точные сведения об Entware и target triple |
| RELEASE-01 | Опубликовать исходники и совместимые артефакты | [ ] | Visibility выбрана, build прошёл для target, checksums доступны |
| CI-01 | Linux CI для TS, Rust и Shell | [~] | workflow создан; требуется первый успешный запуск в GitHub |

Соблюдай примерное распределение собственного исполняемого кода: TypeScript 60–65%, Rust 30–32%, POSIX Shell 2–3%. Это ориентир, а не причина создавать пустые модули или искусственный код.
