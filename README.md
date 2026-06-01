# Guess the Melody

Web party game for guessing songs in shared rooms with Yandex Music sources.

## Features

- Shared rooms without registration.
- Yandex Music themes, charts, playlists, and album links.
- Up to 100 rounds or a target score up to 200000.
- Up to 10 custom playlist/album links per game.
- Optional answer changing until the round ends.
- Automatic next round start after the result screen.
- Round results and a final podium page.
- Long games start from a small playable pool and continue loading more tracks in the background.

## Local Development

Run from the project directory:

```powershell
npm.cmd install
$env:YANDEX_MUSIC_USE_DEMO="false"
$env:YANDEX_MUSIC_ALLOW_FULL_TRACK_FALLBACK="false"
npm.cmd run dev
```

Open: http://127.0.0.1:5173

## Local Production Check

Run from the project directory:

```powershell
npm.cmd run build
$env:YANDEX_MUSIC_USE_DEMO="false"
$env:YANDEX_MUSIC_ALLOW_FULL_TRACK_FALLBACK="false"
npm.cmd start
```

Open: http://127.0.0.1:3001

## Render Yandex Music Diagnostics

After deployment, open the diagnostics endpoint on your deployed service:

```text
https://<your-render-service>/api/music/diagnostics
```

Useful fields:

- `forceDemo: false` means demo mode is disabled.
- `tokenConfigured: false` means no Yandex token is configured. This is expected when testing public access.
- `allowFullTrackFallback: false` means full tracks are not used as a fallback.
- `lastFallbackReason` explains why the server switched to demo fallback after a track-loading attempt.

If `lastFallbackReason` is empty, create a room, start a game, then refresh diagnostics. The reason is recorded only after the server tries to load tracks.

If Render returns `Yandex Music request failed: 451`, Yandex is refusing the request from Render's server environment, usually because of region/IP restrictions. Local runs can still work because they use your own network and location.

## Render Environment

Minimum:

```text
YANDEX_MUSIC_USE_DEMO=false
YANDEX_MUSIC_ALLOW_FULL_TRACK_FALLBACK=false
```

Optional, if public trailer audio is not available from the deployed server:

```text
YANDEX_MUSIC_TOKEN=...
```

Upstash Redis is only for keeping rooms after a free Render instance sleeps. It does not affect Yandex Music availability.

## Music Sources

In the lobby, the host can combine built-in themes with custom Yandex Music links.

Supported custom links:

- `https://music.yandex.ru/users/<user>/playlists/<id>`
- `https://music.yandex.ru/playlists/<uuid>`
- `https://music.yandex.ru/album/<id>`

When several links are added, the server mixes candidate tracks across sources before selecting playable previews, so one large playlist should not dominate smaller ones. If one source fails, the server logs it and continues with the remaining sources.

If a round starts but the browser does not play audio, use the on-screen retry button. Browser autoplay rules or an expired remote audio URL can still block playback for an individual client.
