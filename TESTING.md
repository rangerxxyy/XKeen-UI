# Проверка XKeen UI 0.1.0

## Frontend

Из каталога проекта:

```powershell
pnpm install
pnpm typecheck
pnpm build
```

Открой Vite dev URL, обычно `http://localhost:5173`. Проверь навигацию, настройки, состояние API при отключённом backend, responsive layout на ширине 375 px и отсутствие обязательных CDN-запросов.

## Rust API

```powershell
cd backend
$env:XKEEN_MODE = 'simulation'
$env:XKEEN_PORT = '1001'
cargo test
cargo run
```

В другом PowerShell:

```powershell
Invoke-RestMethod http://localhost:1001/health
Invoke-RestMethod http://localhost:1001/api/v1/status | ConvertTo-Json -Depth 5
```

В simulation mode состояния служб должны быть `unknown`; режим не должен обращаться к реальным службам и конфигурациям. Дополнительно проверить отсутствие токена: simulation API должен работать без него; router mode должен завершаться с сообщением об обязательном `XKEEN_TOKEN`; корректный и некорректный bearer key должны давать HTTP 200 и HTTP 401 соответственно.

## Роутер: безопасная read-only проверка

На пользовательском KeeneticOS/Entware AArch64 с glibc 2.27 проверено:

- test binary собран с dynamic loader из `/opt/lib`;
- отдельный процесс запущен с `XKEEN_BIND=127.0.0.1` на временном порту 18473;
- `GET /health` отвечает `200`;
- `GET /api/v1/status` без токена отклоняется, с временным bearer-токеном возвращает статус;
- frontend успешно отдаётся по HTTP;
- тестовый процесс завершён, временная папка удалена, порт закрыт.

Установщик, создание init-службы и управляющие операции на роутере не запускались. Runtime-действия для Mihomo/Xray, DNS, маршрутов и конфигурации остаются вне этой проверки. До установки на устройство подготовить отдельный план, подтверждение пользователя и проверенный rollback. Не публиковать release или команду установки до решения пользователя.
