# XKeen UI

## Быстрый запуск

В терминале роутера Keenetic с Entware выполните одну команду:

```sh
curl -fsSL https://raw.githubusercontent.com/rangerxxyy/XKeen-UI/main/install.sh | sh
```

В меню выберите установку, обновление или удаление. Установщик скачивает последний ARM64-пакет через настроенные GitHub-прокси, проверяет SHA-256 и сохраняет предыдущую версию при обновлении. Панель доступна на порту `1001`.

Если прямой адрес GitHub недоступен, запустите тот же установщик через зеркало:

```sh
curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/rangerxxyy/XKeen-UI/main/install.sh | sh
```

Прокси загрузки релизов по умолчанию: `gh-proxy.com` и `ghfast.top`. Их список можно изменить в настройках обновлений панели.
