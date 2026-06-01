# Guess the Melody

Веб-игра "Угадай мелодию" с комнатами, лобби и треками из Яндекс Музыки.

## Локальный запуск

```powershell
cd "C:\VS Code Projects\guess-the-melody"
npm.cmd install
$env:YANDEX_MUSIC_USE_DEMO="false"
$env:YANDEX_MUSIC_ALLOW_FULL_TRACK_FALLBACK="false"
npm.cmd run dev
```

Открыть: http://127.0.0.1:5173

## Production-проверка локально

```powershell
cd "C:\VS Code Projects\guess-the-melody"
npm.cmd run build
$env:YANDEX_MUSIC_USE_DEMO="false"
$env:YANDEX_MUSIC_ALLOW_FULL_TRACK_FALLBACK="false"
npm.cmd start
```

Открыть: http://127.0.0.1:3001

## Проверка Яндекс Музыки на Render

После деплоя открой:

```text
https://guess-the-melody.onrender.com/api/music/diagnostics
```

Что смотреть:

- `forceDemo: false` - демо-режим выключен.
- `tokenConfigured: false` - токен не задан, это нормально для проверки без авторизации.
- `allowFullTrackFallback: false` - обычные полные треки не используются как fallback.
- `lastFallbackReason` - причина, почему сервер ушел в demo fallback.

Если `lastFallbackReason` пустой, но в игре все равно fallback, запусти комнату и снова обнови diagnostics. Причина появляется после попытки загрузить треки.

Если там видно `Yandex returned 0 playable tracks...` или ошибки `Yandex Music request failed`, значит Render достает метаданные, но не может получить playable trailer-аудио без токена либо Яндекс ограничивает запросы с серверного окружения Render.

## Render env

Минимально:

```text
YANDEX_MUSIC_USE_DEMO=false
YANDEX_MUSIC_ALLOW_FULL_TRACK_FALLBACK=false
```

Опционально, если без авторизации trailer-аудио не отдается:

```text
YANDEX_MUSIC_TOKEN=...
```

Upstash Redis нужен только для сохранения комнат после сна free-инстанса Render. На доступность Яндекс Музыки он не влияет.
