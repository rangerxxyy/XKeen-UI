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

## Устройство

Не запускать installer до подтверждения модели/архитектуры, публикации release checksum и отдельного плана проверки. Реальное устройство этой версией не тестировалось. После установки сохранить выведенный bearer key; он не публикуется в README и не попадает в application logs.
