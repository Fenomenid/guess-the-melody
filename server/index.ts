import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { GameEngine } from './game';
import { MusicService } from './music';
import { RoomStore } from './roomStore';
import type { RoomSettings, Track, TrackMetadata } from './types';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const clientOrigin = process.env.CLIENT_ORIGIN ?? (process.env.NODE_ENV === 'production' ? true : 'http://127.0.0.1:5173');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: clientOrigin,
    methods: ['GET', 'POST']
  }
});

const engine = new GameEngine();
const music = new MusicService();
const roomStore = new RoomStore();
const roomTracks = new Map<string, Track[]>();
const roomOptionTracks = new Map<string, TrackMetadata[]>();
const roundTimers = new Map<string, NodeJS.Timeout>();
const nextRoundTimers = new Map<string, NodeJS.Timeout>();

app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: '16kb' }));

app.get('/api/health', (_request, response) => {
  response.json({ data: { ok: true } });
});

app.get('/api/themes', (_request, response) => {
  response.json({ data: music.getThemes() });
});

app.get('/api/music/diagnostics', (_request, response) => {
  response.json({ data: music.diagnostics() });
});

app.use(express.static(path.join(process.cwd(), 'dist')));
app.get(/^\/(?!api).*/, (_request, response) => {
  response.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
});

io.on('connection', (socket) => {
  socket.on('create_room', async ({ playerId, playerName }: { playerId: string; playerName: string }, callback) => {
    try {
      const room = engine.createRoom({ playerId, playerName });
      socket.join(playerId);
      socket.join(room.code);
      await persistRooms();
      callback?.({ data: room });
      io.to(room.code).emit('room_state', room);
    } catch (error) {
      callback?.({ error: toClientError(error) });
    }
  });

  socket.on('join_room', async ({ code, playerId, playerName }: { code: string; playerId: string; playerName: string }, callback) => {
    try {
      const room = engine.joinRoom(code.toUpperCase(), { playerId, playerName });
      socket.join(playerId);
      socket.join(room.code);
      await persistRooms();
      callback?.({ data: room });
      io.to(room.code).emit('room_state', room);
    } catch (error) {
      callback?.({ error: toClientError(error) });
    }
  });

  socket.on('update_settings', async ({ code, settings }: { code: string; settings: unknown }, callback) => {
    try {
      const room = engine.updateSettings(code, parseSettings(settings));
      await persistRooms();
      callback?.({ data: room });
      io.to(room.code).emit('room_state', room);
    } catch (error) {
      callback?.({ error: toClientError(error) });
    }
  });

  socket.on('start_game', async ({ code }: { code: string }, callback) => {
    try {
      const preparingRoom = engine.markPreparing(code);
      await persistRooms();
      io.to(preparingRoom.code).emit('room_state', preparingRoom);

      const plannedRounds = preparingRoom.settings.winCondition === 'score' ? estimateRoundsForScore(preparingRoom.settings.targetScore) : preparingRoom.settings.rounds;
      const pool = await music.prepareTrackPool(
        {
          themeIds: preparingRoom.settings.themeIds,
          playlistUrls: preparingRoom.settings.playlistUrls,
          playlistUrl: preparingRoom.settings.playlistUrl
        },
        {
          playableLimit: Math.max(12, plannedRounds + 20),
          optionLimit: Math.max(220, plannedRounds * 18)
        }
      );
      roomTracks.set(preparingRoom.code, shuffle(pool.playableTracks));
      roomOptionTracks.set(preparingRoom.code, shuffle(pool.optionTracks));
      await startRound(preparingRoom.code);
      callback?.({ data: engine.getPublicRoom(preparingRoom.code) });
    } catch (error) {
      callback?.({ error: toClientError(error) });
    }
  });

  socket.on('submit_answer', async ({ code, playerId, optionId }: { code: string; playerId: string; optionId: string }, callback) => {
    try {
      const result = engine.submitAnswer(code, playerId, optionId);
      const room = engine.getPublicRoom(code);
      await persistRooms();
      callback?.({ data: { optionId: result.optionId } });
      io.to(room.code).emit('answer_received', { playerId });
      io.to(room.code).emit('room_state', room);
    } catch (error) {
      callback?.({ error: toClientError(error) });
    }
  });

  socket.on('kick_player', async ({ code, hostPlayerId, targetPlayerId }: { code: string; hostPlayerId: string; targetPlayerId: string }, callback) => {
    try {
      const room = engine.kickPlayer(code, hostPlayerId, targetPlayerId);
      await persistRooms();
      callback?.({ data: room });
      io.to(targetPlayerId).emit('kicked', { message: 'Хост удалил вас из комнаты' });
      io.to(room.code).emit('room_state', room);
    } catch (error) {
      callback?.({ error: toClientError(error) });
    }
  });

  socket.on('leave_room', async ({ code, playerId }: { code: string; playerId: string }, callback) => {
    try {
      const result = engine.leaveRoom(code, playerId);
      socket.leave(code.toUpperCase());
      await persistRooms();
      callback?.({ data: result.room ?? null });
      if (result.room) {
        io.to(result.room.code).emit('room_state', result.room);
      } else if (result.deletedRoomCode) {
        roomTracks.delete(result.deletedRoomCode);
        roomOptionTracks.delete(result.deletedRoomCode);
        clearRoundTimer(result.deletedRoomCode);
        clearNextRoundTimer(result.deletedRoomCode);
      }
    } catch (error) {
      callback?.({ error: toClientError(error) });
    }
  });

  socket.on('next_round', async ({ code }: { code: string }, callback) => {
    try {
      await startRound(code);
      callback?.({ data: engine.getPublicRoom(code) });
    } catch (error) {
      callback?.({ error: toClientError(error) });
    }
  });

  socket.on('reset_game', async ({ code }: { code: string }, callback) => {
    try {
      clearRoundTimer(code);
      clearNextRoundTimer(code);
      const room = engine.resetToLobby(code);
      roomTracks.delete(room.code);
      roomOptionTracks.delete(room.code);
      await persistRooms();
      callback?.({ data: room });
      io.to(room.code).emit('room_state', room);
    } catch (error) {
      callback?.({ error: toClientError(error) });
    }
  });
});

void bootstrap();

async function bootstrap(): Promise<void> {
  const rooms = await roomStore.loadRooms();
  if (rooms.length > 0) {
    engine.importRooms(rooms);
  }

  httpServer.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}`);
  });
}

async function startRound(code: string): Promise<void> {
  clearRoundTimer(code);
  clearNextRoundTimer(code);
  const room = engine.getPublicRoom(code);
  const tracks = roomTracks.get(room.code);
  const optionTracks = roomOptionTracks.get(room.code) ?? tracks;
  if (!tracks) {
    throw new Error('No track pool prepared for room');
  }

  engine.startNextRound(room.code, tracks, optionTracks);
  const updated = engine.getPublicRoom(room.code);
  await persistRooms();
  io.to(room.code).emit('round_started', updated);
  io.to(room.code).emit('room_state', updated);

  const timer = setTimeout(() => {
    const revealed = engine.revealRound(room.code);
    void persistRooms();
    io.to(room.code).emit('round_result', revealed);
    io.to(room.code).emit('room_state', revealed);
    scheduleNextRound(revealed.code);
    roundTimers.delete(room.code);
  }, Math.max(0, (updated.currentQuestion?.endsAt ?? Date.now() + room.settings.questionDurationMs) - Date.now()));

  roundTimers.set(room.code, timer);
}

function scheduleNextRound(code: string): void {
  clearNextRoundTimer(code);
  const room = engine.getPublicRoom(code);
  if (room.status !== 'round-result') {
    return;
  }

  const timer = setTimeout(() => {
    nextRoundTimers.delete(room.code);
    void startRound(room.code).catch((error) => {
      io.to(room.code).emit('room_state', engine.getPublicRoom(room.code));
      console.warn(toClientError(error));
    });
  }, 10_000);

  nextRoundTimers.set(room.code, timer);
}

function clearRoundTimer(code: string): void {
  const timer = roundTimers.get(code.toUpperCase());
  if (timer) {
    clearTimeout(timer);
    roundTimers.delete(code.toUpperCase());
  }
}

function clearNextRoundTimer(code: string): void {
  const timer = nextRoundTimers.get(code.toUpperCase());
  if (timer) {
    clearTimeout(timer);
    nextRoundTimers.delete(code.toUpperCase());
  }
}

function parseSettings(value: unknown): Partial<RoomSettings> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const raw = value as Record<string, unknown>;
  return {
    themeId: typeof raw.themeId === 'string' ? raw.themeId : undefined,
    themeIds: Array.isArray(raw.themeIds) ? raw.themeIds.filter((item): item is string => typeof item === 'string') : undefined,
    playlistUrl: typeof raw.playlistUrl === 'string' ? raw.playlistUrl : undefined,
    playlistUrls: Array.isArray(raw.playlistUrls) ? raw.playlistUrls.filter((item): item is string => typeof item === 'string') : undefined,
    winCondition: raw.winCondition === 'score' || raw.winCondition === 'rounds' ? raw.winCondition : undefined,
    rounds: typeof raw.rounds === 'number' ? raw.rounds : undefined,
    targetScore: typeof raw.targetScore === 'number' ? raw.targetScore : undefined,
    questionDurationMs: typeof raw.questionDurationMs === 'number' ? raw.questionDurationMs : undefined,
    allowAnswerChange: typeof raw.allowAnswerChange === 'boolean' ? raw.allowAnswerChange : undefined
  };
}

function estimateRoundsForScore(targetScore: number): number {
  return Math.max(8, Math.min(100, Math.ceil(targetScore / 650) + 4));
}

function toClientError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected server error';
}

async function persistRooms(): Promise<void> {
  try {
    await roomStore.saveRooms(engine.exportRooms());
  } catch (error) {
    console.warn(toClientError(error));
  }
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}
