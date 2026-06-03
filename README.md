# Guess the Melody

Web party game for guessing songs together in shared rooms. The app uses Yandex Music sources, creates short music rounds, scores answers by speed, and ends with a podium and match moments.

## What It Does

- Creates shareable game rooms without registration.
- Lets the host combine built-in Yandex Music themes with playlist or album links.
- Supports rounds-based games and score-target games.
- Supports three answer modes: track titles, artists, and mixed answers.
- Has easy and hard audio modes.
- Scores correct answers by speed and can penalize answer changes.
- Shows safe live achievements during the round and reveal achievements after the answer is known.
- Shows final match moments built from the full round history.
- Keeps room state on the server and restores rooms through the configured room store.

## Tech Stack

- React 19
- Vite
- TypeScript
- Express
- Socket.IO
- Vitest

## Local Development

Install dependencies:

```powershell
npm.cmd install
```

Start the client and server in development mode:

```powershell
npm.cmd run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Production Build

Build the client and server:

```powershell
npm.cmd run build
```

Start the built server:

```powershell
npm.cmd start
```

Open:

```text
http://127.0.0.1:3001
```

## Tests

Run the test suite:

```powershell
npm.cmd test
```

## Configuration

Common environment variables:

```text
YANDEX_MUSIC_USE_DEMO=false
YANDEX_MUSIC_ALLOW_FULL_TRACK_FALLBACK=false
YANDEX_MUSIC_TOKEN=optional_token_for_account_limited_requests
```

Demo mode can be useful for local checks without relying on external music availability.

## Music Sources

The host can select built-in quick themes and add custom Yandex Music links.

Supported custom links:

- `https://music.yandex.ru/users/<user>/playlists/<id>`
- `https://music.yandex.ru/playlists/<uuid>`
- `https://music.yandex.ru/album/<id>`

When several sources are selected, the server mixes candidate tracks across sources before choosing playable round tracks and answer options.

## Game Flow

1. A player creates a room and becomes the host.
2. Other players join by room code or room link.
3. The host configures sources, difficulty, answer mode, win condition, timer, and answer-change behavior.
4. The server prepares a track pool and starts a round.
5. Players listen to the audio preview and choose an answer.
6. The round reveal shows the correct track, points, and round achievements.
7. The game continues until the selected win condition is reached.
8. The final screen shows the winner, podium, score rows, and match moments.

## Useful Endpoints

- `GET /api/health` - server health check.
- `GET /api/themes` - built-in theme list.
- `GET /api/music/playlists/search?q=<query>` - Yandex Music playlist search.
- `GET /api/music/diagnostics` - music provider diagnostics.
- `GET /api/music/probe?difficulty=easy&limit=5` - playable audio probe.

## Repository Layout

```text
src/
  main.tsx        React app and Socket.IO client flow
  styles.css      visual system and responsive layout
server/
  index.ts        Express and Socket.IO server
  game.ts         room state, rounds, scoring, achievements
  music.ts        Yandex Music source loading and fallback handling
  roomStore.ts    room persistence abstraction
scripts/
  write-server-package.cjs
  probe-yandex-trailers.ts
```

## Notes

If audio does not start in a browser, use the in-game retry control. Browser autoplay rules or expired remote audio URLs can still block playback for an individual client.
