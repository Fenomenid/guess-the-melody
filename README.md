# Guess the Melody

Real-time web party game for guessing music in shared rooms. The server builds rounds from Yandex Music sources, synchronizes playback through Socket.IO, scores players by speed, and shows live events, round analytics, and a final podium.

## Features

- Rooms without registration, joinable by code or link.
- Separate main, display, and player views:
  - `/room/<CODE>` — normal game view.
  - `/room/<CODE>/display` — shared screen or TV.
  - `/room/<CODE>/player` — compact phone controller.
- Built-in Yandex Music themes plus custom playlists, albums, and artists.
- Multiple sources can be mixed in one game.
- Answer modes: track title, artist, or mixed.
- Win conditions: number of rounds or target score.
- Easy and hard audio modes with configurable timers.
- Optional answer changes with a score penalty.
- Automatic transition between rounds or manual host control.
- Host kick with confirmation, including during a game.
- Disconnected players remain visible until removed or the room is reset.
- Safe live achievements during a question and result achievements after reveal.
- Answer-change journey with correct/wrong coloring.
- Correct-answer streaks, animated ranking movement, position history graphs, and geometric avatars.
- Round drama cards: new leader, biggest fall, and most indecisive player.
- Responsive final screen with a compact Full HD layout and expandable ranking.

## Revansh Mode

Revansh is an optional comeback mode:

- Players earn energy for correct answers.
- A large unique lead automatically sends a Jammer to the leader.
- Jammer hides two answer slots from the leader.
- The leader can spend energy on Countermeasure and predict one hidden slot.
- A successful prediction reveals one slot and returns energy.
- Chasing players can spend energy on Timecut, reducing the leader's answer time by half, with a minimum of five seconds.
- The last-place correct-answer boost can award a score multiplier.
- Attacks are visualized in the ranking with animated effects.

## Tech Stack

- React 19
- Vite
- TypeScript
- Express
- Socket.IO
- Vitest
- Optional Upstash Redis persistence

## Local Development

Requirements:

- Node.js 20 or newer.
- npm.

Install dependencies:

```powershell
npm.cmd install
```

Copy `.env.example` to `.env` and adjust it if needed:

```powershell
Copy-Item .env.example .env
```

Start the Vite client and API server:

```powershell
npm.cmd run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Production

Build the client and server:

```powershell
npm.cmd run build
```

Start the compiled Express server:

```powershell
npm.cmd start
```

The production server serves both the API and the built frontend from `dist`.

Default URL:

```text
http://127.0.0.1:3001
```

For Render or another Node host, use:

```text
Build command: npm install && npm run build
Start command: npm start
```

The host must support WebSocket connections. Set `PORT` only when the platform does not provide it automatically.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP server port. |
| `HOST` | `0.0.0.0` | HTTP bind address. |
| `CLIENT_ORIGIN` | `http://127.0.0.1:5173` in development | Allowed Socket.IO and CORS origin. Production defaults to accepting the serving origin. |
| `YANDEX_MUSIC_TOKEN` | empty | Optional Yandex Music account token for requests that require it. |
| `YANDEX_MUSIC_USE_DEMO` | `false` | Use demo tracks instead of external Yandex sources. |
| `YANDEX_MUSIC_ALLOW_FULL_TRACK_FALLBACK` | `false` | Allow full-track fallback when a preview is unavailable. |
| `AUDIO_DELIVERY_MODE` | `direct` | `direct` sends Yandex audio URLs to clients; `cache` downloads audio to the game server first. |
| `AUDIO_CACHE_MAX_BYTES` | `8000000` | Maximum cached size of one audio file. |
| `ROUND_AUDIO_WARMUP_MS` | `1750` for direct, `750` for cache | Delay before a round starts, allowing clients to prepare audio. |
| `UPSTASH_REDIS_REST_URL` | empty | Optional Upstash Redis REST endpoint. |
| `UPSTASH_REDIS_REST_TOKEN` | empty | Optional Upstash Redis REST token. |

When both Upstash variables are configured, room snapshots are stored for 72 hours and restored after a server restart. Without Redis, rooms live only in server memory.

## Audio Delivery

### Direct mode

```text
AUDIO_DELIVERY_MODE=direct
```

Clients load audio directly from the upstream Yandex URL. This reduces server bandwidth but makes playback dependent on each player's network path to Yandex.

### Cache mode

```text
AUDIO_DELIVERY_MODE=cache
```

The server downloads playable audio before the game and serves it through `/api/audio/:id`. This gives all players the same host and can help when individual networks have trouble reaching Yandex, but it increases server bandwidth and memory usage.

The cache:

- accepts only HTTPS upstream URLs;
- supports HTTP range requests;
- deduplicates identical upstream audio;
- removes room references when a room is cleared.

## Supported Yandex Music Sources

- User playlist:
  `https://music.yandex.ru/users/<user>/playlists/<id>`
- Public playlist:
  `https://music.yandex.ru/playlists/<uuid>`
- Album:
  `https://music.yandex.ru/album/<id>`
- Artist:
  `https://music.yandex.ru/artist/<id>`
  or `https://music.yandex.ru/artist/<id>/tracks`

Up to ten custom sources can be normalized for one room. The server mixes source candidates, prepares playable tracks, and separately builds a larger answer-option pool.

## Game Flow

1. A player creates a room and becomes host.
2. Other players join through the room code, normal link, or phone view.
3. The host selects music sources and game settings.
4. The server prepares playable audio and answer candidates.
5. Each round starts after a short synchronized warmup.
6. Players choose an answer; selected option details and correctness stay hidden until reveal.
7. The result screen shows the track, points, answer journey, achievements, ranking changes, and round drama.
8. The game ends at the configured round count or target score.
9. The final screen shows the podium, up to eight ranking rows by default, match moments, and expandable remaining players.

## API and Diagnostics

- `GET /api/health` — server health.
- `GET /api/themes` — built-in themes.
- `GET /api/music/playlists/search?q=<query>&page=0&limit=10` — playlist search.
- `GET /api/music/diagnostics` — music provider status and active audio delivery mode.
- `GET /api/music/probe?difficulty=easy&limit=5` — test playable Yandex audio.
- `GET /api/audio/:id` — cached audio endpoint when cache mode is enabled.

Run the trailer probe from the command line:

```powershell
npm.cmd run probe:trailers
```

For browser-side audio problems, capture the Network tab or a HAR file and inspect:

- response status and timing for the audio request;
- whether range requests return `206 Partial Content`;
- stalled or cancelled requests;
- the active mode returned by `/api/music/diagnostics`;
- browser autoplay errors shown by the in-game retry notice.

## Tests and Verification

Run all tests:

```powershell
npm.cmd test
```

Run the full production build, including TypeScript checks:

```powershell
npm.cmd run build
```

## Repository Layout

```text
src/
  main.tsx                 React application and Socket.IO client
  styles.css               responsive UI and animations
  audioScheduling.ts       synchronized browser audio startup
  answerJourney.ts         answer-change presentation
  finalStageLayout.ts      final ranking visibility rules
  rankingVisuals.ts        avatars and attack visualization data
server/
  index.ts                 Express routes, Socket.IO events, timers
  game.ts                  rooms, scoring, Revansh, achievements
  types.ts                 shared server domain types
  music.ts                 Yandex Music loading and source parsing
  audioDelivery.ts         direct/cache delivery selection
  audioCache.ts            in-memory audio cache and range responses
  roomStore.ts             optional Upstash room persistence
  roundPlanning.ts         track-pool and synchronized-start planning
scripts/
  probe-yandex-trailers.ts
  write-server-package.cjs
```

## Operational Notes

- Browser autoplay rules may block the first audio start; use the in-game retry control.
- Direct Yandex URLs can behave differently across providers, VPNs, or corporate networks.
- Cache mode is useful for network consistency but must be sized for the host's memory and outbound traffic limits.
- A restarted server cannot restore prepared audio pools. Persisted rooms are restored safely, but unfinished matches return to the lobby.
- Never commit `YANDEX_MUSIC_TOKEN` or Upstash credentials.
