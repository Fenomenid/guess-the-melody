import {
  Copy,
  Crown,
  Brain,
  DoorOpen,
  KeyRound,
  LoaderCircle,
  LogIn,
  Medal,
  Moon,
  Music2,
  Play,
  Plus,
  Radio,
  Repeat2,
  RotateCcw,
  Skull,
  Sparkles,
  Sun,
  Target,
  Timer,
  Trophy,
  UserMinus,
  Users,
  Volume2,
  VolumeX,
  Zap,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

type Theme = {
  id: string;
  title: string;
  description: string;
  source: 'demo' | 'yandex';
};

type Player = {
  id: string;
  name: string;
  score: number;
  correctAnswers: number;
  connected: boolean;
  isHost: boolean;
  lastAnswer?: { hasAnswered: true; responseMs: number; answerChanges: number } | { optionId: string; isCorrect: boolean; responseMs: number; points: number; answerChanges: number };
};

type Achievement = {
  id: string;
  icon: string;
  title: string;
  description: string;
  recipient?: string;
  tone: 'safe' | 'good' | 'bad' | 'chaos';
};

type MatchMoment = Achievement & {
  round: number;
};

type PlaylistSource = {
  url: string;
  name: string;
};

type PlaylistSearchItem = PlaylistSource & {
  id: string;
  description?: string;
};

type Room = {
  code: string;
  status: 'lobby' | 'preparing' | 'question' | 'round-result' | 'finished';
  settings: {
    themeId: string;
    themeIds: string[];
    playlistUrl?: string;
    playlistUrls?: string[];
    playlistSources?: PlaylistSource[];
    difficulty: 'easy' | 'hard';
    winCondition: 'rounds' | 'score';
    rounds: number;
    targetScore: number;
    questionDurationMs: number;
    allowAnswerChange: boolean;
    achievementsEnabled: boolean;
  };
  players: Player[];
  currentQuestion?: {
    id: string;
    round: number;
    audioUrl: string;
    coverUrl?: string;
    sourceName?: string;
    options: Array<{ id: string; title: string }>;
    durationMs: number;
    startedAt: number;
    endsAt: number;
  };
  correctTrack?: {
    id: string;
    title: string;
    artist: string;
    coverUrl?: string;
    trackUrl?: string;
    sourceName?: string;
    sourceUrl?: string;
  };
  achievements: Achievement[];
  matchMoments: MatchMoment[];
  round: number;
  serverTime: number;
};

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
};

function hasRevealedAnswer(player: Player): player is Player & { lastAnswer: { optionId: string; isCorrect: boolean; responseMs: number; points: number; answerChanges: number } } {
  return Boolean(player.lastAnswer && 'optionId' in player.lastAnswer);
}

const socket = io();

function getOrCreatePlayerId(): string {
  const storageKey = 'playerId';
  const existing = localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }
  const playerId = crypto.randomUUID();
  localStorage.setItem(storageKey, playerId);
  return playerId;
}

function getRoomCodeFromUrl(): string {
  const pathMatch = window.location.pathname.match(/\/room\/([A-Za-z0-9]{4,8})/);
  const queryRoom = new URLSearchParams(window.location.search).get('room');
  return (pathMatch?.[1] ?? queryRoom ?? '').toUpperCase();
}

function App() {
  const [playerId] = useState(() => getOrCreatePlayerId());
  const roomCodeFromUrl = useMemo(() => getRoomCodeFromUrl(), []);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('playerName') ?? '');
  const [joinCode, setJoinCode] = useState(roomCodeFromUrl);
  const [room, setRoom] = useState<Room | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [copied, setCopied] = useState(false);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('volume') ?? 0.8));
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'));
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const leftRoomCodesRef = useRef(new Set<string>());

  const me = useMemo(() => room?.players.find((player) => player.id === playerId), [playerId, room]);
  const isHost = Boolean(me?.isHost);
  const sortedPlayers = useMemo(
    () => [...(room?.players ?? [])].sort((a, b) => b.score - a.score || Number(b.connected) - Number(a.connected)),
    [room?.players]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    fetch('/api/themes')
      .then((response) => response.json())
      .then((payload) => setThemes(payload.data ?? []))
      .catch(() => setError('Не удалось загрузить темы'));

    socket.on('room_state', handleRoomState);
    socket.on('round_started', setRoom);
    socket.on('round_result', setRoom);
    socket.on('kicked', ({ message }: { message: string }) => {
      setRoom(null);
      setError(message);
      window.history.replaceState(null, '', '/');
    });

    return () => {
      socket.off('room_state', handleRoomState);
      socket.off('round_started', setRoom);
      socket.off('round_result', setRoom);
      socket.off('kicked');
    };
  }, []);

  useEffect(() => {
    if (!room && roomCodeFromUrl && playerName.trim()) {
      emit<Room>('join_room', { code: roomCodeFromUrl, playerId, playerName: playerName.trim() }, handleRoomState, 'Входим в комнату');
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('volume', String(volume));
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    setSelectedOptionId('');
  }, [room?.currentQuestion?.id]);

  useEffect(() => {
    if (!volumeOpen) {
      return undefined;
    }
    const closeVolume = () => setVolumeOpen(false);
    document.addEventListener('pointerdown', closeVolume);
    return () => document.removeEventListener('pointerdown', closeVolume);
  }, [volumeOpen]);

  useEffect(() => {
    if (!room?.code) {
      return;
    }

    const ping = () => {
      void fetch('/api/health?keep=room', { cache: 'no-store' }).catch(() => undefined);
    };
    ping();

    const interval = window.setInterval(ping, 240_000);

    return () => window.clearInterval(interval);
  }, [room?.code]);

  function handleRoomState(nextRoom: Room) {
    if (leftRoomCodesRef.current.has(nextRoom.code)) {
      return;
    }
    setRoom(nextRoom);
    if (window.location.pathname !== `/room/${nextRoom.code}`) {
      window.history.replaceState(null, '', `/room/${nextRoom.code}`);
    }
  }

  function emit<T>(event: string, payload: unknown, onSuccess?: (data: T) => void, label = '') {
    setError('');
    setBusyLabel(label);
    setIsBusy(true);
    socket.emit(event, payload, (response: { data?: T; error?: string }) => {
      setIsBusy(false);
      setBusyLabel('');
      if (response.error) {
        if (event === 'submit_answer' && (response.error === 'No active question' || response.error === 'Answer deadline has passed')) {
          return;
        }
        setError(response.error);
        return;
      }
      if (onSuccess && Object.prototype.hasOwnProperty.call(response, 'data')) {
        onSuccess(response.data as T);
      }
    });
  }

  function createRoom() {
    const name = playerName.trim();
    if (!name) {
      setError('Введите ник');
      return;
    }
    localStorage.setItem('playerName', name);
    emit<Room>('create_room', { playerId, playerName: name }, handleRoomState, 'Создаем комнату');
  }

  function joinRoom() {
    const name = playerName.trim();
    if (!name || !joinCode.trim()) {
      setError('Введите ник и код комнаты');
      return;
    }
    localStorage.setItem('playerName', name);
    leftRoomCodesRef.current.delete(joinCode.trim().toUpperCase());
    emit<Room>('join_room', { code: joinCode, playerId, playerName: name }, handleRoomState, 'Входим в комнату');
  }

  function updateSettings(settings: Partial<Room['settings']>) {
    if (!room) return;
    emit<Room>('update_settings', { code: room.code, playerId, settings }, setRoom, 'Обновляем настройки');
  }

  function submitAnswer(optionId: string) {
    if (!room || (me?.lastAnswer && !room.settings.allowAnswerChange)) return;
    setSelectedOptionId(optionId);
    emit('submit_answer', { code: room.code, playerId, optionId }, undefined, 'Фиксируем ответ');
  }

  function kickPlayer(targetPlayerId: string) {
    if (!room) return;
    emit<Room>('kick_player', { code: room.code, hostPlayerId: playerId, targetPlayerId }, handleRoomState, 'Удаляем игрока');
  }

  function leaveRoom() {
    if (!room) return;
    const roomCode = room.code;
    leftRoomCodesRef.current.add(roomCode);
    setRoom(null);
    setError('');
    setVolumeOpen(false);
    window.history.replaceState(null, '', '/');
    emit<Room | null>(
      'leave_room',
      { code: roomCode, playerId },
      (nextRoom) => {
        if (nextRoom) {
          setRoom(nextRoom);
          return;
        }
        setRoom(null);
        window.history.replaceState(null, '', '/');
      },
      'Покидаем комнату'
    );
  }

  function goHome() {
    setRoom(null);
    setError('');
    setVolumeOpen(false);
    window.history.replaceState(null, '', '/');
  }

  function resetGame() {
    if (!room) return;
    emit('reset_game', { code: room.code, playerId }, undefined, 'Возвращаем в лобби');
  }

  function requestKickPlayer(player: Player) {
    setConfirmDialog({
      title: 'Кикнуть игрока?',
      message: `${player.name} выйдет из комнаты. Игру можно будет продолжить без него.`,
      confirmLabel: 'Кикнуть',
      tone: 'danger',
      onConfirm: () => kickPlayer(player.id)
    });
  }

  function requestResetGame() {
    setConfirmDialog({
      title: 'Вернуться в лобби?',
      message: 'Текущая игра завершится, счет и раунд будут сброшены. Игроки останутся в комнате.',
      confirmLabel: 'В лобби',
      tone: 'primary',
      onConfirm: resetGame
    });
  }

  function requestLeaveRoom() {
    setConfirmDialog({
      title: 'Покинуть комнату?',
      message: 'Вы выйдете из комнаты и перестанете получать события этой игры. Вернуться можно будет по ссылке-приглашению.',
      confirmLabel: 'Покинуть',
      tone: 'danger',
      onConfirm: leaveRoom
    });
  }

  async function copyInvite() {
    if (!room) return;
    await navigator.clipboard.writeText(`${location.origin}/room/${room.code}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const volumeButton = (
    <div className="floating-volume" onPointerDown={(event) => event.stopPropagation()}>
      <button className="round-button" type="button" aria-label="Громкость" onClick={() => setVolumeOpen((value) => !value)}>
        {volume === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
      </button>
      {volumeOpen && (
        <div className="volume-popover" onPointerDown={(event) => event.stopPropagation()}>
          <span>Громкость</span>
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
          <strong>{Math.round(volume * 100)}%</strong>
        </div>
      )}
    </div>
  );

  if (!room) {
    return (
      <main className="page auth-page">
        <section className="auth-panel">
          <div className="brand">
            <Music2 size={34} />
            <div>
              <p className="eyebrow">Yandex Music party</p>
              <h1 className="app-title">Угадай мелодию</h1>
              <p className="muted">Создайте комнату, отправьте ссылку друзьям и угадывайте треки по коротким превью.</p>
            </div>
          </div>

          <label className="field">
            <span>Ваше имя</span>
            <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} maxLength={32} placeholder="Например, Аня" />
          </label>

          {roomCodeFromUrl ? (
            <button className="primary" onClick={joinRoom} disabled={isBusy}>
              <LogIn size={18} />
              Войти в комнату {roomCodeFromUrl}
            </button>
          ) : (
            <button className="primary" onClick={createRoom} disabled={isBusy}>
              <Users size={18} />
              Создать комнату
            </button>
          )}

          <div className="join-row">
            <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="Код" maxLength={6} />
            <button className="secondary" onClick={joinRoom} disabled={isBusy}>
              <LogIn size={18} />
              Войти
            </button>
          </div>

          <button className="secondary" onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {theme === 'dark' ? 'Светлая тема' : 'Темная тема'}
          </button>

          {isBusy && <LoadingStrip label={busyLabel || 'Подключаемся'} />}
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Комната {room.code}</p>
          <h1 className="app-title">Угадай мелодию</h1>
          {me && (
            <p className="self-label">
              Вы: <strong>{me.name}</strong>
            </p>
          )}
        </div>
        <div className="top-actions">
          <button className="secondary icon-text" onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {theme === 'dark' ? 'Светлая' : 'Темная'}
          </button>
          <button className="secondary icon-text" onClick={copyInvite}>
            <Copy size={18} />
            {copied ? 'Скопировано' : 'Пригласить'}
          </button>
          <button className="secondary icon-text" onClick={requestLeaveRoom}>
            <DoorOpen size={18} />
            Покинуть
          </button>
          {isHost && room.status !== 'lobby' && (
            <button className="secondary icon-text" onClick={requestResetGame}>
              <RotateCcw size={18} />
              В лобби
            </button>
          )}
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="layout">
        <aside className="sidebar">
          <div className="section-title">
            <Users size={18} />
            Игроки
          </div>
          <div className="players">
            {sortedPlayers.map((player, index) => (
              <div
                className={['player-row', player.id === playerId ? 'self' : '', player.lastAnswer ? 'answered' : '', !player.connected ? 'offline' : '']
                  .filter(Boolean)
                  .join(' ')}
                key={player.id}
              >
                <div>
                  <strong className="player-name">
                    {index + 1}. {player.name}
                    {player.id === playerId && <span className="self-mark">(вы)</span>}
                    {player.isHost && <KeyRound size={15} aria-label="Хост" />}
                  </strong>
                  <span>{player.connected ? (player.lastAnswer ? 'Ответ принят' : room.status === 'question' ? 'Слушает' : 'В комнате') : 'Не в сети'}</span>
                </div>
                <div className="player-row-actions">
                  <b>{player.score}</b>
                  {isHost && player.id !== playerId && room.status === 'lobby' && (
                    <button className="kick-button" type="button" aria-label={`Кикнуть ${player.name}`} onClick={() => requestKickPlayer(player)}>
                      <UserMinus size={11} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="game-panel">
          {room.status === 'lobby' && (
            <Lobby
              room={room}
              themes={themes}
              isHost={isHost}
              isBusy={isBusy}
              busyLabel={busyLabel}
              onStart={() => emit('start_game', { code: room.code, playerId }, undefined, 'Готовим треки Яндекс Музыки')}
              onSettingsChange={updateSettings}
            />
          )}

          {room.status === 'preparing' && <PreparingStage />}

          {room.status === 'question' && room.currentQuestion && (
            <QuestionStage
              room={room}
              me={me}
              selectedOptionId={selectedOptionId}
              volume={volume}
              audioRef={audioRef}
              onSubmit={submitAnswer}
            />
          )}

          {(room.status === 'round-result' || room.status === 'finished') && (
            <ResultStage room={room} isHost={isHost} playerId={playerId} emit={emit} />
          )}
        </section>
      </div>
      {volumeButton}
      {confirmDialog && <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />}
    </main>
  );
}

function Lobby({
  room,
  themes,
  isHost,
  isBusy,
  busyLabel,
  onStart,
  onSettingsChange
}: {
  room: Room;
  themes: Theme[];
  isHost: boolean;
  isBusy: boolean;
  busyLabel: string;
  onStart: () => void;
  onSettingsChange: (settings: Partial<Room['settings']>) => void;
}) {
  const [roundsDraft, setRoundsDraft] = useState(String(room.settings.rounds));
  const [targetScoreDraft, setTargetScoreDraft] = useState(String(room.settings.targetScore));
  const [secondsDraft, setSecondsDraft] = useState(String(room.settings.questionDurationMs / 1000));
  const [playlistDraft, setPlaylistDraft] = useState('');
  const [playlistNameDraft, setPlaylistNameDraft] = useState('');
  const [playlistSearchDraft, setPlaylistSearchDraft] = useState('');
  const [playlistSearchPage, setPlaylistSearchPage] = useState(0);
  const [playlistSearchResults, setPlaylistSearchResults] = useState<PlaylistSearchItem[]>([]);
  const [playlistSearchLoading, setPlaylistSearchLoading] = useState(false);
  const [playlistSearchError, setPlaylistSearchError] = useState('');
  const activeDraftFieldRef = useRef<'rounds' | 'seconds' | 'targetScore' | null>(null);

  useEffect(() => {
    if (activeDraftFieldRef.current !== 'rounds') {
      setRoundsDraft(String(room.settings.rounds));
    }
    if (activeDraftFieldRef.current !== 'targetScore') {
      setTargetScoreDraft(String(room.settings.targetScore));
    }
    if (activeDraftFieldRef.current !== 'seconds') {
      setSecondsDraft(String(room.settings.questionDurationMs / 1000));
    }
  }, [room.settings.rounds, room.settings.targetScore, room.settings.questionDurationMs]);

  function commitRounds() {
    activeDraftFieldRef.current = null;
    const value = Number(roundsDraft);
    const rounds = Number.isFinite(value) ? Math.max(1, Math.min(100, Math.round(value))) : room.settings.rounds;
    setRoundsDraft(String(rounds));
    if (rounds !== room.settings.rounds) {
      onSettingsChange({ rounds });
    }
  }

  function commitSeconds() {
    activeDraftFieldRef.current = null;
    const value = Number(secondsDraft);
    const maxSeconds = getMaxAnswerSeconds(room.settings.difficulty);
    const seconds = Number.isFinite(value) ? Math.max(5, Math.min(maxSeconds, Math.round(value))) : room.settings.questionDurationMs / 1000;
    setSecondsDraft(String(seconds));
    if (seconds * 1000 !== room.settings.questionDurationMs) {
      onSettingsChange({ questionDurationMs: seconds * 1000 });
    }
  }

  function commitTargetScore() {
    activeDraftFieldRef.current = null;
    const value = Number(targetScoreDraft);
    const targetScore = Number.isFinite(value) ? Math.max(500, Math.min(200_000, Math.round(value))) : room.settings.targetScore;
    setTargetScoreDraft(String(targetScore));
    if (targetScore !== room.settings.targetScore) {
      onSettingsChange({ targetScore });
    }
  }

  function addPlaylistUrl() {
    const playlistUrl = playlistDraft.trim();
    if (!playlistUrl || selectedPlaylistSources.some((source) => source.url === playlistUrl)) {
      setPlaylistDraft('');
      setPlaylistNameDraft('');
      return;
    }
    const nextSources = [
      ...selectedPlaylistSources,
      {
        url: playlistUrl,
        name: playlistNameDraft.trim() || defaultPlaylistSourceName(playlistUrl, selectedPlaylistSources.length)
      }
    ].slice(0, 10);
    syncPlaylistSources(nextSources);
    setPlaylistDraft('');
    setPlaylistNameDraft('');
  }

  function addPlaylistSource(source: PlaylistSource) {
    if (!source.url || selectedPlaylistSources.some((selected) => selected.url === source.url)) {
      return;
    }
    syncPlaylistSources([...selectedPlaylistSources, source].slice(0, 10));
  }

  async function searchPlaylists(page = 0) {
    const query = playlistSearchDraft.trim();
    if (!query) {
      setPlaylistSearchResults([]);
      setPlaylistSearchError('');
      return;
    }
    setPlaylistSearchLoading(true);
    setPlaylistSearchError('');
    try {
      const response = await fetch(`/api/music/playlists/search?${new URLSearchParams({ q: query, page: String(page), limit: '8' })}`);
      const payload = (await response.json()) as { data?: { results?: PlaylistSearchItem[] }; error?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Не удалось найти плейлисты');
      }
      setPlaylistSearchPage(page);
      setPlaylistSearchResults((current) => (page === 0 ? payload.data?.results ?? [] : [...current, ...(payload.data?.results ?? [])]));
    } catch (error) {
      setPlaylistSearchError(error instanceof Error ? error.message : 'Не удалось найти плейлисты');
    } finally {
      setPlaylistSearchLoading(false);
    }
  }

  function removePlaylistUrl(playlistUrl: string) {
    syncPlaylistSources(selectedPlaylistSources.filter((source) => source.url !== playlistUrl));
  }

  function syncPlaylistSources(nextSources: PlaylistSource[]) {
    const playlistUrls = nextSources.map((source) => source.url);
    onSettingsChange({
      playlistSources: nextSources,
      playlistUrls,
      playlistUrl: playlistUrls[0] ?? ''
    });
  }

  function toggleTheme(themeId: string) {
    const currentThemeIds = selectedThemeIds;
    const nextThemeIds = currentThemeIds.includes(themeId)
      ? currentThemeIds.filter((id) => id !== themeId)
      : [...currentThemeIds, themeId];
    onSettingsChange({ themeIds: nextThemeIds });
  }

  const selectedPlaylistSources = getPlaylistSources(room.settings);
  const selectedPlaylistUrls = selectedPlaylistSources.map((source) => source.url);
  const selectedThemeIds = room.settings.themeIds ?? [room.settings.themeId];
  const hasPlaylistSource = selectedPlaylistSources.length > 0;

  return (
    <div className="stage lobby-stage">
      <p className="eyebrow">Лобби</p>
      <h2>Ожидание игроков</h2>
      <p className="muted">Ссылка уже ведет прямо в комнату. Хост выбирает тему, длительность и запускает первый раунд.</p>

      <div className="settings-stack">
        <details className="settings-section" open>
          <summary>Настройки игры</summary>
          <div className="settings-grid">
        <label className="field wide-field">
          <span>Сложность</span>
          <div className="difficulty-toggle" role="group" aria-label="Сложность">
            <button
              type="button"
              className={room.settings.difficulty === 'easy' ? 'active' : ''}
              disabled={!isHost || isBusy}
              onClick={() => onSettingsChange({ difficulty: 'easy' })}
            >
              <strong>Легко</strong>
              <small>Трейлеры треков</small>
            </button>
            <button
              type="button"
              className={room.settings.difficulty === 'hard' ? 'active' : ''}
              disabled={!isHost || isBusy}
              onClick={() => onSettingsChange({ difficulty: 'hard' })}
            >
              <strong>Сложно</strong>
              <small>Треки с начала</small>
            </button>
          </div>
        </label>
        <label className="field wide-field">
          <span>Плейлисты</span>
          <div className="playlist-input-grid">
            <input
              disabled={!isHost || isBusy || selectedPlaylistUrls.length >= 10}
              value={playlistDraft}
              onChange={(event) => setPlaylistDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addPlaylistUrl();
                }
              }}
              placeholder="Ссылка на плейлист"
              title="Вставьте ссылку на плейлист или альбом Яндекс Музыки"
            />
            <input
              disabled={!isHost || isBusy || selectedPlaylistUrls.length >= 10}
              value={playlistNameDraft}
              onChange={(event) => setPlaylistNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addPlaylistUrl();
                }
              }}
              placeholder="Название"
              title="Короткое название источника, которое будет показано игрокам в игре"
              maxLength={48}
            />
            <button className="secondary icon-text" type="button" disabled={!isHost || isBusy || !playlistDraft.trim()} onClick={addPlaylistUrl}>
              <Plus size={18} />
              Добавить
            </button>
          </div>
          {selectedPlaylistSources.length > 0 && (
            <div className="playlist-list">
              {selectedPlaylistSources.map((source, index) => (
                <div className="playlist-item" key={source.url}>
                  <span>{source.name || defaultPlaylistSourceName(source.url, index)}</span>
                  <small>{source.url}</small>
                  <button
                    className="kick-button"
                    type="button"
                    disabled={!isHost || isBusy}
                    onClick={() => removePlaylistUrl(source.url)}
                    aria-label={`Удалить источник ${index + 1}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="playlist-search">
            <div className="playlist-search-row">
              <input
                disabled={!isHost || isBusy}
                value={playlistSearchDraft}
                onChange={(event) => setPlaylistSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void searchPlaylists(0);
                  }
                }}
                placeholder="Поиск плейлистов Яндекс Музыки"
              />
              <button className="secondary icon-text" type="button" disabled={!isHost || isBusy || playlistSearchLoading} onClick={() => void searchPlaylists(0)}>
                {playlistSearchLoading ? <LoaderCircle className="spin" size={18} /> : <Radio size={18} />}
                Найти
              </button>
            </div>
            {playlistSearchError && <small className="search-error">{playlistSearchError}</small>}
            {playlistSearchResults.length > 0 && (
              <div className="playlist-search-results">
                {playlistSearchResults.map((source) => {
                  const added = selectedPlaylistUrls.includes(source.url);
                  return (
                    <div className="playlist-search-item" key={`${source.id}:${source.url}`}>
                      <div>
                        <strong>{source.name}</strong>
                        {source.description && <small>{source.description}</small>}
                      </div>
                      <button
                        className="secondary icon-text"
                        type="button"
                        disabled={!isHost || isBusy || added || selectedPlaylistUrls.length >= 10}
                        onClick={() => addPlaylistSource({ url: source.url, name: source.name })}
                      >
                        <Plus size={16} />
                        {added ? 'Добавлен' : 'Добавить'}
                      </button>
                    </div>
                  );
                })}
                <button className="secondary" type="button" disabled={!isHost || isBusy || playlistSearchLoading} onClick={() => void searchPlaylists(playlistSearchPage + 1)}>
                  Показать еще
                </button>
              </div>
            )}
          </div>
        </label>
        <label className="field wide-field quick-themes-field">
          <span>Быстрые темы</span>
          <div className="theme-picker">
            {themes.map((theme) => (
              <label className="theme-choice" key={theme.id}>
                <input
                  type="checkbox"
                  disabled={!isHost || isBusy || (!hasPlaylistSource && selectedThemeIds.length === 1 && selectedThemeIds.includes(theme.id))}
                  checked={selectedThemeIds.includes(theme.id)}
                  onChange={() => toggleTheme(theme.id)}
                />
                <span>{theme.title}</span>
              </label>
            ))}
          </div>
        </label>
        <label className="field">
          <span>Условие победы</span>
          <select
            disabled={!isHost || isBusy}
            value={room.settings.winCondition}
            onChange={(event) => onSettingsChange({ winCondition: event.target.value as Room['settings']['winCondition'] })}
          >
            <option value="rounds">По раундам</option>
            <option value="score">По очкам</option>
          </select>
        </label>
        {room.settings.winCondition === 'rounds' && (
          <label className="field wide-field">
            <span>Раунды</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              min={1}
              max={100}
              disabled={!isHost || isBusy}
              value={roundsDraft}
              onFocus={() => {
                activeDraftFieldRef.current = 'rounds';
              }}
              onBlur={commitRounds}
              onChange={(event) => setRoundsDraft(toDigitsDraft(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        )}
        <label className="field wide-field">
          <span>Секунд на ответ</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            min={5}
            max={getMaxAnswerSeconds(room.settings.difficulty)}
            disabled={!isHost || isBusy}
            value={secondsDraft}
            onFocus={() => {
              activeDraftFieldRef.current = 'seconds';
            }}
            onBlur={commitSeconds}
            onChange={(event) => setSecondsDraft(toDigitsDraft(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        {room.settings.winCondition === 'score' && (
          <label className="field wide-field">
            <span>Очки для победы</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              min={500}
              max={200000}
              disabled={!isHost || isBusy}
              value={targetScoreDraft}
              onFocus={() => {
                activeDraftFieldRef.current = 'targetScore';
              }}
              onBlur={commitTargetScore}
              onChange={(event) => setTargetScoreDraft(toDigitsDraft(event.target.value))}
            />
          </label>
        )}
        <label className="setting-toggle wide-field">
          <input
            type="checkbox"
            disabled={!isHost || isBusy}
            checked={room.settings.allowAnswerChange}
            onChange={(event) => onSettingsChange({ allowAnswerChange: event.target.checked })}
          />
          <span>
            <strong>Можно менять ответ</strong>
            <small>Игрок может исправить мисклик до конца раунда. Засчитывается последний выбранный вариант.</small>
          </span>
        </label>
        <label className="setting-toggle wide-field">
          <input
            type="checkbox"
            disabled={!isHost || isBusy}
            checked={room.settings.achievementsEnabled}
            onChange={(event) => onSettingsChange({ achievementsEnabled: event.target.checked })}
          />
          <span>
            <strong>Ачивки (Beta)</strong>
            <small>Включает экспериментальные события раунда и будущие моменты матча. Пока режим готовится отдельно от основной игры.</small>
          </span>
        </label>
        <div className="notice">
          <Radio size={18} />
          <span>
            {hasPlaylistSource
              ? selectedThemeIds.length === 0
                ? `Плейлисты будут единственным источником треков: ${selectedPlaylistUrls.length || 1}. Аудио проверяется только для нужного количества раундов.`
                : `Плейлисты добавятся к выбранным темам: ${selectedPlaylistUrls.length || 1}. Аудио проверяется только для нужного количества раундов.`
              : selectedThemeIds.length > 1
                ? `Выбрано тем: ${selectedThemeIds.length}`
                : themes.find((theme) => theme.id === selectedThemeIds[0])?.description ?? 'Треки подбираются из Яндекс Музыки'}
          </span>
        </div>
          </div>
        </details>
      </div>

      {isBusy && <LoadingStrip label={busyLabel || 'Готовим треки'} />}

      <div className="actions">
        {isHost ? (
          <button className="primary start-button" onClick={onStart} disabled={isBusy}>
            {isBusy ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />}
            Начать раунд
          </button>
        ) : (
          <p className="muted">Ждем, пока хост начнет игру.</p>
        )}
      </div>
    </div>
  );
}

function getPlaylistSources(settings: Room['settings']): PlaylistSource[] {
  if (settings.playlistSources?.length) {
    return settings.playlistSources;
  }
  const playlistUrls = settings.playlistUrls?.length ? settings.playlistUrls : settings.playlistUrl ? [settings.playlistUrl] : [];
  return playlistUrls.map((url, index) => ({
    url,
    name: defaultPlaylistSourceName(url, index)
  }));
}

function defaultPlaylistSourceName(url: string, index: number): string {
  return /\/album\//i.test(url) ? `Альбом ${index + 1}` : `Плейлист ${index + 1}`;
}

function toDigitsDraft(value: string): string {
  return value.replace(/\D/g, '');
}

function formatSignedPoints(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

function getMaxAnswerSeconds(difficulty: Room['settings']['difficulty']): number {
  return difficulty === 'easy' ? 15 : 30;
}

function PreparingStage() {
  return (
    <div className="stage preparing-stage">
      <p className="eyebrow">Загрузка</p>
      <h2>Готовим треки из Яндекс Музыки</h2>
      <p className="muted">Подбираем короткие отрывки и варианты ответов для раунда.</p>
      <LoadingStrip label="Ищем отрывки" />
      <Equalizer />
    </div>
  );
}

function QuestionStage({
  room,
  me,
  selectedOptionId,
  volume,
  audioRef,
  onSubmit
}: {
  room: Room;
  me?: Player;
  selectedOptionId: string;
  volume: number;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  onSubmit: (optionId: string) => void;
}) {
  const question = room.currentQuestion!;
  const countdown = useQuestionCountdown(question, room.serverTime);
  const [audioIssue, setAudioIssue] = useState('');

  function playAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    setAudioIssue('');
    void audio.play().catch(() => setAudioIssue('Браузер не запустил звук автоматически. Нажмите повторить.'));
  }

  useEffect(() => {
    setAudioIssue('');
    const timeout = window.setTimeout(playAudio, 150);
    return () => window.clearTimeout(timeout);
  }, [question.id]);

  return (
    <div className="stage question-stage">
      <audio
        ref={audioRef}
        src={question.audioUrl}
        preload="auto"
        autoPlay
        onCanPlay={playAudio}
        onError={() => setAudioIssue('Не удалось воспроизвести этот отрывок. Сервер попробует другой трек в следующем раунде.')}
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = volume;
        }}
      />

      <div className="round-header">
        <span>
          {room.settings.winCondition === 'score' ? `Раунд ${question.round}` : `Раунд ${question.round} из ${room.settings.rounds}`}
        </span>
        <span>{me?.lastAnswer ? 'Ответ принят' : 'Выберите название трека'}</span>
      </div>

      <AchievementShelf achievements={room.achievements} title="События" compact />

      <div className="music-visual">
        <div className="countdown-ring" style={{ '--progress': `${countdown.progress * 360}deg` } as React.CSSProperties}>
          <Timer size={26} />
          <strong>{countdown.secondsLeft}</strong>
          <span>сек</span>
        </div>
        <div className="music-activity">
          {question.sourceName && (
            <div className="source-pill">
              <Radio size={16} />
              <span>{question.sourceName}</span>
            </div>
          )}
          <Equalizer />
        </div>
      </div>
      {audioIssue && (
        <div className="notice audio-notice">
          <VolumeX size={18} />
          <span>{audioIssue}</span>
          <button className="secondary" type="button" onClick={playAudio}>
            Повторить
          </button>
        </div>
      )}

      <div className="answers">
        {question.options.map((option) => (
          <button
            className={[
              'answer-button',
              selectedOptionId === option.id ? 'selected-answer' : '',
              me?.lastAnswer && !room.settings.allowAnswerChange ? 'locked-answer' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            key={option.id}
            onClick={() => onSubmit(option.id)}
            disabled={Boolean(me?.lastAnswer && !room.settings.allowAnswerChange)}
          >
            {option.title}
            {selectedOptionId === option.id && <span className="answer-picked" aria-label="Выбрано">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultStage({
  room,
  isHost,
  playerId,
  emit
}: {
  room: Room;
  isHost: boolean;
  playerId: string;
  emit: <T>(event: string, payload: unknown, onSuccess?: (data: T) => void, label?: string) => void;
}) {
  const nextRoundCountdown = useAutoNextCountdown(room.status, room.round);

  function selectedOptionTitle(player: Player): string {
    const optionId = hasRevealedAnswer(player) ? player.lastAnswer.optionId : undefined;
    return room.currentQuestion?.options.find((option) => option.id === optionId)?.title ?? 'Не ответил';
  }

  if (room.status === 'finished') {
    return <FinalStage room={room} isHost={isHost} playerId={playerId} emit={emit} selectedOptionTitle={selectedOptionTitle} />;
  }

  return (
    <div className="stage result-stage">
      <p className="eyebrow">Ответ</p>
      <h2>Раунд завершен</h2>
      {room.correctTrack && (
        <div className="solution">
          {room.correctTrack.coverUrl ? <img className="track-cover result-cover" src={room.correctTrack.coverUrl} alt="" /> : <Music2 size={24} />}
          <div>
            <strong>{room.correctTrack.title}</strong>
            <span>{room.correctTrack.artist}</span>
            {room.correctTrack.sourceName && <small>Источник: {room.correctTrack.sourceName}</small>}
            {room.correctTrack.trackUrl && (
              <a className="track-link" href={room.correctTrack.trackUrl} target="_blank" rel="noreferrer">
                Открыть в Яндекс Музыке
              </a>
            )}
          </div>
        </div>
      )}
      <AchievementShelf achievements={room.achievements} title="Ачивки раунда" compact />
      <div className="result-list">
        {room.players.map((player, index) => (
          <div className="score-row" key={player.id}>
            <span>{index === 0 ? <Crown size={18} /> : index + 1}</span>
            <strong>
              {player.name}
              <small className={hasRevealedAnswer(player) && player.lastAnswer.isCorrect ? 'answer-summary correct' : 'answer-summary'}>
                {selectedOptionTitle(player)}
              </small>
            </strong>
            {hasRevealedAnswer(player) && player.lastAnswer.points ? (
              <b className={['score-pop', player.lastAnswer.points < 0 ? 'penalty' : ''].filter(Boolean).join(' ')}>
                {formatSignedPoints(player.lastAnswer.points)}
              </b>
            ) : (
              <small>0</small>
            )}
          </div>
        ))}
      </div>
      <div className="actions">
        {isHost && (
          <button className="primary" onClick={() => emit('next_round', { code: room.code, playerId }, undefined, 'Готовим следующий трек')}>
            <Play size={18} />
            Следующий раунд
          </button>
        )}
        {nextRoundCountdown > 0 && (
          <div className="notice auto-next">
            <Timer size={18} />
            <span>Следующий раунд начнется автоматически через {nextRoundCountdown} сек.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function FinalStage({
  room,
  isHost,
  playerId,
  emit,
  selectedOptionTitle
}: {
  room: Room;
  isHost: boolean;
  playerId: string;
  emit: <T>(event: string, payload: unknown, onSuccess?: (data: T) => void, label?: string) => void;
  selectedOptionTitle: (player: Player) => string;
}) {
  const podium = [room.players[1], room.players[0], room.players[2]].filter(Boolean);

  return (
    <div className="stage final-stage">
      <div className="fireworks" aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => (
          <span key={index} style={{ '--x': `${(index * 37) % 100}%`, '--delay': `${(index % 6) * 160}ms` } as React.CSSProperties} />
        ))}
      </div>
      <p className="eyebrow">Финал</p>
      <h2>Игра окончена</h2>
      <div className="notice winner">
        <Trophy size={18} />
        <span>Победитель: {room.players[0]?.name ?? 'игрок'}</span>
      </div>
      <div className="podium" data-count={podium.length}>
        {podium.map((player) => {
          const place = room.players.findIndex((candidate) => candidate.id === player.id) + 1;
          return (
            <div className={`podium-place place-${place}`} key={player.id}>
              <span>{place === 1 ? <Crown size={22} /> : place}</span>
              <strong>{player.name}</strong>
              <b>{player.score}</b>
            </div>
          );
        })}
      </div>
      <div className="result-list final-list">
        {room.players.map((player, index) => (
          <div className="score-row" key={player.id}>
            <span>{index === 0 ? <Crown size={18} /> : index + 1}</span>
            <strong>
              {player.name}
              <small className={hasRevealedAnswer(player) && player.lastAnswer.isCorrect ? 'answer-summary correct' : 'answer-summary'}>{selectedOptionTitle(player)}</small>
            </strong>
            <small>{hasRevealedAnswer(player) && player.lastAnswer.points ? formatSignedPoints(player.lastAnswer.points) : '0'}</small>
            <em>{player.score}</em>
          </div>
        ))}
      </div>
      <MatchMoments moments={room.matchMoments} />
      <div className="actions">
        {isHost && (
          <button className="primary" onClick={() => emit('reset_game', { code: room.code, playerId }, undefined, 'Возвращаем в лобби')}>
            <RotateCcw size={18} />
            Новая игра
          </button>
        )}
      </div>
    </div>
  );
}

function AchievementShelf({ achievements, title = 'Ачивки', compact = false }: { achievements: Achievement[]; title?: string; compact?: boolean }) {
  if (achievements.length === 0) {
    return null;
  }

  return (
    <section className={['achievement-shelf', compact ? 'compact' : ''].filter(Boolean).join(' ')} aria-label={title}>
      <div className="achievement-title">
        <Trophy size={16} />
        <span>{title}</span>
      </div>
      <div className="achievement-list">
        {achievements.map((achievement) => (
          <article className={`achievement-card ${achievement.tone}`} key={achievement.id}>
            <AchievementIcon achievement={achievement} />
            <div>
              <strong>{achievement.title}</strong>
              {compact && achievement.recipient && <small className="achievement-recipient">{achievement.recipient}</small>}
              {!compact && <small>{achievement.description}</small>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MatchMoments({ moments }: { moments: MatchMoment[] }) {
  if (moments.length === 0) {
    return null;
  }

  return (
    <section className="match-moments" aria-label="Моменты матча">
      <div className="achievement-title">
        <Trophy size={16} />
        <span>Моменты матча</span>
      </div>
      <div className="moment-list">
        {moments.map((moment) => (
          <article className={`achievement-card moment-card ${moment.tone}`} key={moment.id}>
            <AchievementIcon achievement={moment} />
            <div>
              <strong>{moment.title}</strong>
              <small>
                Раунд {moment.round}: {moment.description}
              </small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AchievementIcon({ achievement }: { achievement: Achievement }) {
  const Icon = getAchievementIcon(achievement);
  return (
    <span className={`achievement-icon ${achievement.tone}`} aria-hidden="true">
      <Icon size={21} strokeWidth={2.5} />
    </span>
  );
}

function getAchievementIcon(achievement: Achievement) {
  const text = `${achievement.icon} ${achievement.title}`.toLowerCase();
  if (text.includes('⚡') || text.includes('быстр') || text.includes('кноп')) return Zap;
  if (text.includes('🎯') || text.includes('угад') || text.includes('попал')) return Target;
  if (text.includes('💀') || text.includes('промах') || text.includes('свидет')) return Skull;
  if (text.includes('🔁') || text.includes('↔') || text.includes('пере') || text.includes('рулет')) return Repeat2;
  if (text.includes('🧠') || text.includes('мозг')) return Brain;
  if (text.includes('🏆') || text.includes('лучший')) return Trophy;
  if (text.includes('✓') || text.includes('все')) return Medal;
  return Sparkles;
}

function ConfirmModal({ dialog, onClose }: { dialog: ConfirmDialogState; onClose: () => void }) {
  function confirm() {
    dialog.onConfirm();
    onClose();
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={dialog.title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="confirm-modal">
        <h2>{dialog.title}</h2>
        <p className="muted">{dialog.message}</p>
        <div className="actions confirm-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className={dialog.tone === 'danger' ? 'danger' : 'primary'} type="button" onClick={confirm}>
            {dialog.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function LoadingStrip({ label }: { label: string }) {
  return (
    <div className="loading-strip">
      <div className="loading-strip-header">
        <span>{label}</span>
        <LoaderCircle className="spin" size={18} />
      </div>
      <div className="loading-bar">
        <span />
      </div>
    </div>
  );
}

function Equalizer() {
  const bars = Array.from({ length: 18 }, (_, index) => index);
  return (
    <div className="equalizer" aria-hidden="true">
      {bars.map((_, index) => (
        <span
          key={index}
          style={
            {
              '--delay': `${(index % 6) * 110}ms`
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function useQuestionCountdown(question: NonNullable<Room['currentQuestion']>, serverTime: number) {
  const [now, setNow] = useState(Date.now());
  const serverOffsetRef = useRef(0);

  useEffect(() => {
    serverOffsetRef.current = serverTime - Date.now();
    let frameId = 0;
    const tick = () => {
      setNow(Date.now());
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [question.id, serverTime]);

  const adjustedNow = now + serverOffsetRef.current;
  const remaining = Math.max(0, question.endsAt - adjustedNow);
  return {
    secondsLeft: Math.ceil(remaining / 1000),
    progress: remaining / question.durationMs
  };
}

function useAutoNextCountdown(status: Room['status'], round: number): number {
  const [secondsLeft, setSecondsLeft] = useState(5);

  useEffect(() => {
    if (status !== 'round-result') {
      setSecondsLeft(0);
      return undefined;
    }

    const startedAt = Date.now();
    setSecondsLeft(5);
    const interval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSecondsLeft(Math.max(0, 5 - elapsed));
    }, 250);

    return () => window.clearInterval(interval);
  }, [status, round]);

  return secondsLeft;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
