# Архитектура XKeen UI

## Фактическое устройство первой версии

```text
Браузер (TypeScript + Vite)
  ├─ typed API client ── GET /health
  │                  └─ GET /api/v1/status ── Bearer token в режиме роутера
  └─ CodeMirror YAML-черновик ── sessionStorage текущей вкладки

Rust / Axum :1001
  ├─ /health — доступность HTTP-процесса
  ├─ /api/v1/status — типизированный статус; в router mode читает только /proc
  └─ release/web — статические файлы интерфейса

POSIX ash installer
  ├─ загружает опубликованный target archive и SHA256SUMS
  ├─ сравнивает SHA-256 перед распаковкой
  └─ создаёт Entware init.d service и закрытый конфиг с токеном
```

Frontend не содержит обязательного внешнего CDN. API payload рассматривается как `unknown` и проверяется перед использованием в UI. Для локального simulation mode сведения о службах и памяти не считываются с хоста. Router mode ограничен Linux; на текущем срезе он проверяет наличие процессов и системные метрики, но не запускает и не меняет конфигурацию ядер.

## Модули

- `src/api.ts`: HTTP transport, HTTP/JSON ошибки, bearer token в tab-scoped `sessionStorage`, runtime-проверка ответа `SystemStatus`.
- `src/main.ts`: компоновка панели, навигация, статусы API, диалоги входа и настроек.
- `src/yaml-editor.ts`: CodeMirror 6, локальный черновик, YAML 1.2 parser, форматирование и скачивание. Никаких запросов на backend от редактора нет.
- `src/style.css`: локальная дизайн-система, компоненты и responsive-переходы.
- `backend/src/main.rs`: Axum routes, авторизация status API, сериализуемые контракты, Linux process/memory/load readers и simulation mode.
- `install.sh`: target lookup, release/checksum verification, безопасное подтверждение install/update/remove и init.d оболочка. Источник истинного управления в будущем — Rust, а не произвольная команда из веб-формы.

## Контракты и ошибки

| Endpoint | Доступ | Назначение |
|---|---|---|
| `GET /health` | Без токена, только состояние HTTP-сервера | Проверка доступности API |
| `GET /api/v1/status` | Read-only | Версия UI, режим, порт, uptime, platform, память, load average, CPU по дельте `/proc/stat` и статусы процессов |
| `POST /api/v1/app/update` | Router mode, same-origin | Запускает штатное обновление UI через `install.sh update`; интерфейс ждёт смены версии после перезапуска |

Ошибки HTTP остаются ошибками, а неполный или неправильно типизированный JSON отвергается клиентом. `unknown`/`unavailable` не превращаются в положительный статус. Нынешний status API read-only.

## Безопасные границы

- В router mode установка создаёт 256-битный hex access token; конфигурация доступна только владельцу (`0600`), token не попадает в query string.
- Изменяющие запросы проверяют совпадение Origin/Host; отдельная пользовательская авторизация пока не реализована.
- Simulation mode не сканирует host-процессы и не читает системную память.
- Редактор не имеет кнопки «Применить»: он валидирует синтаксис и сохраняет только черновик вкладки. Mihomo schema compatibility отдельно не проверяется.
- Установщик подтверждает действия, проверяет checksum перед распаковкой, хранит прошлый каталог и не подгружает конфиг как shell-код.
- Release, target triples, контрольные суммы и установка на роутер ещё не проверены; команда из README пока является шаблоном до публикации совместимого release.

## Следующий безопасный этап

1. Зафиксировать точную модель роутера, Entware ABI/архитектуру, версии Mihomo и Xray, и пути конфигураций.
2. Подключить loopback Mihomo read-only adapter с ограничением host, запросов/ответов, таймаутом и типизированной деградацией. Только после этого селекторы, соединения и версия ядра смогут показывать реальные сведения.
3. Спроектировать раздельные Mihomo DNS и Xray DNS-модули по схемам конкретных версий.
4. Для config apply сначала реализовать path allowlist, версионную схему, validate, эксклюзивную блокировку, атомарный backup/write, безопасный перезапуск и подтверждённый rollback. Не применять непроверенный черновик к роутеру.
5. Разделить backend по доменным модулям после появления реальных adapters, не создавать пустые файлы ради структуры.
6. Выполнить CI и сборки только для зафиксированных target triples, затем подготовить release assets и SHA256SUMS.

## Сборка

Frontend: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`. Rust: `cargo fmt --check`, `cargo test --locked`, `cargo build --release --locked`. Installer проверяется POSIX `sh -n` и ShellCheck; перед первым release дополнительно нужен интеграционный прогон в изолированной Entware/ash-среде.
