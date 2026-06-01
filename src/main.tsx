import {
  Copy,
  Crown,
  DoorOpen,
  KeyRound,
  LoaderCircle,
  LogIn,
  Moon,
  Music2,
  Play,
  Radio,
  RotateCcw,
  Sun,
  Timer,
  Trophy,
  UserMinus,
  Users,
  Volume2,
  VolumeX
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
  connected: boolean;
  isHost: boolean;
  lastAnswer?: {
    optionId: string;
    isCorrect: boolean;
    responseMs: number;
    points: number;
  };
};

type Room = {
  code: string;
  status: 'lobby' | 'preparing' | 'question' | 'round-result' | 'finished';
  settings: {
    themeId: string;
    themeIds: string[];
    playlistUrl?: string;
    winCondition: 'rounds' | 'score';
    rounds: number;
    targetScore: number;
    questionDurationMs: number;
  };
  players: Player[];
  currentQuestion?: {
    id: string;
    round: number;
    audioUrl: string;
    coverUrl?: string;
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
  };
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
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
    if (room?.status !== 'lobby') {
      return;
    }

    const interval = window.setInterval(() => {
      void fetch('/api/health?keep=room', { cache: 'no-store' }).catch(() => undefined);
    }, 240_000);

    return () => window.clearInterval(interval);
  }, [room?.code, room?.status]);

  function handleRoomState(nextRoom: Room) {
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
        setError(response.error);
        return;
      }
      if (response.data && onSuccess) {
        onSuccess(response.data);
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
    emit<Room>('join_room', { code: joinCode, playerId, playerName: name }, handleRoomState, 'Входим в комнату');
  }

  function updateSettings(settings: Partial<Room['settings']>) {
    if (!room) return;
    emit<Room>('update_settings', { code: room.code, settings }, setRoom, 'Обновляем настройки');
  }

  function submitAnswer(optionId: string) {
    if (!room || me?.lastAnswer) return;
    emit('submit_answer', { code: room.code, playerId, optionId }, undefined, 'Фиксируем ответ');
  }

  function kickPlayer(targetPlayerId: string) {
    if (!room) return;
    emit<Room>('kick_player', { code: room.code, hostPlayerId: playerId, targetPlayerId }, handleRoomState, 'Удаляем игрока');
  }

  function leaveRoom() {
    if (!room) return;
    emit<Room | null>(
      'leave_room',
      { code: room.code, playerId },
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

  function requestKickPlayer(player: Player) {
    setConfirmDialog({
      title: 'Кикнуть игрока?',
      message: `${player.name} выйдет из комнаты. Игру можно будет продолжить без него.`,
      confirmLabel: 'Кикнуть',
      tone: 'danger',
      onConfirm: () => kickPlayer(player.id)
    });
  }

  function requestLeaveRoom() {
    setConfirmDialog({
      title: 'Покинуть комнату?',
      message: 'Вы выйдете из комнаты. Вернуться можно будет по ссылке-приглашению.',
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
    <div className="floating-volume">
      <button className="round-button" type="button" aria-label="Громкость" onClick={() => setVolumeOpen((value) => !value)}>
        {volume === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
      </button>
      {volumeOpen && (
        <div className="volume-popover">
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
              <h1>Угадай мелодию</h1>
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
          <h1>Угадай мелодию</h1>
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
            <button className="secondary icon-text" onClick={() => emit('reset_game', { code: room.code }, undefined, 'Возвращаем в лобби')}>
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
              <div className={['player-row', player.id === playerId ? 'self' : '', !player.connected ? 'offline' : ''].filter(Boolean).join(' ')} key={player.id}>
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
              onStart={() => emit('start_game', { code: room.code }, undefined, 'Готовим треки Яндекс Музыки')}
              onSettingsChange={updateSettings}
            />
          )}

          {room.status === 'preparing' && <PreparingStage />}

          {room.status === 'question' && room.currentQuestion && (
            <QuestionStage
              room={room}
              me={me}
              volume={volume}
              audioRef={audioRef}
              onSubmit={submitAnswer}
            />
          )}

          {(room.status === 'round-result' || room.status === 'finished') && (
            <ResultStage room={room} isHost={isHost} emit={emit} />
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
  const [playlistDraft, setPlaylistDraft] = useState(room.settings.playlistUrl ?? '');

  useEffect(() => {
    setRoundsDraft(String(room.settings.rounds));
    setTargetScoreDraft(String(room.settings.targetScore));
    setSecondsDraft(String(room.settings.questionDurationMs / 1000));
    setPlaylistDraft(room.settings.playlistUrl ?? '');
  }, [room.settings.rounds, room.settings.targetScore, room.settings.questionDurationMs, room.settings.playlistUrl]);

  function commitRounds() {
    const value = Number(roundsDraft);
    const rounds = Number.isFinite(value) ? Math.max(1, Math.min(20, Math.round(value))) : room.settings.rounds;
    setRoundsDraft(String(rounds));
    if (rounds !== room.settings.rounds) {
      onSettingsChange({ rounds });
    }
  }

  function commitSeconds() {
    const value = Number(secondsDraft);
    const seconds = Number.isFinite(value) ? Math.max(5, Math.min(30, Math.round(value))) : room.settings.questionDurationMs / 1000;
    setSecondsDraft(String(seconds));
    if (seconds * 1000 !== room.settings.questionDurationMs) {
      onSettingsChange({ questionDurationMs: seconds * 1000 });
    }
  }

  function commitTargetScore() {
    const value = Number(targetScoreDraft);
    const targetScore = Number.isFinite(value) ? Math.max(500, Math.min(20_000, Math.round(value))) : room.settings.targetScore;
    setTargetScoreDraft(String(targetScore));
    if (targetScore !== room.settings.targetScore) {
      onSettingsChange({ targetScore });
    }
  }

  function commitPlaylistUrl() {
    const playlistUrl = playlistDraft.trim();
    if ((room.settings.playlistUrl ?? '') !== playlistUrl) {
      onSettingsChange({ playlistUrl });
    }
  }

  function toggleTheme(themeId: string) {
    const currentThemeIds = room.settings.themeIds?.length ? room.settings.themeIds : [room.settings.themeId];
    const nextThemeIds = currentThemeIds.includes(themeId)
      ? currentThemeIds.filter((id) => id !== themeId)
      : [...currentThemeIds, themeId];

    if (nextThemeIds.length > 0) {
      onSettingsChange({ themeIds: nextThemeIds });
    }
  }

  const selectedThemeIds = room.settings.themeIds?.length ? room.settings.themeIds : [room.settings.themeId];

  return (
    <div className="stage lobby-stage">
      <p className="eyebrow">Лобби</p>
      <h2>Ожидание игроков</h2>
      <p className="muted">Ссылка уже ведет прямо в комнату. Хост выбирает тему, длительность и запускает первый раунд.</p>

      <div className="settings-grid">
        <label className="field">
          <span>Тема</span>
          <div className="theme-picker">
            {themes.map((theme) => (
              <label className="theme-choice" key={theme.id}>
                <input
                  type="checkbox"
                  disabled={!isHost || isBusy || (selectedThemeIds.length === 1 && selectedThemeIds.includes(theme.id))}
                  checked={selectedThemeIds.includes(theme.id)}
                  onChange={() => toggleTheme(theme.id)}
                />
                <span>{theme.title}</span>
              </label>
            ))}
          </div>
        </label>
        <label className="field">
          <span>Плейлист</span>
          <input
            disabled={!isHost || isBusy}
            value={playlistDraft}
            onBlur={commitPlaylistUrl}
            onChange={(event) => setPlaylistDraft(event.target.value)}
            placeholder="https://music.yandex.ru/users/.../playlists/..."
          />
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
        <label className="field">
          <span>Раунды</span>
          <input
            type="number"
            min={1}
            max={20}
            disabled={!isHost || isBusy}
            value={roundsDraft}
            onBlur={commitRounds}
            onChange={(event) => setRoundsDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <label className="field">
          <span>Секунд на ответ</span>
          <input
            type="number"
            min={5}
            max={30}
            disabled={!isHost || isBusy}
            value={secondsDraft}
            onBlur={commitSeconds}
            onChange={(event) => setSecondsDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <label className="field">
          <span>Очки для победы</span>
          <input
            type="number"
            min={500}
            max={20000}
            disabled={!isHost || isBusy || room.settings.winCondition !== 'score'}
            value={targetScoreDraft}
            onBlur={commitTargetScore}
            onChange={(event) => setTargetScoreDraft(event.target.value)}
          />
        </label>
        <div className="notice">
          <Radio size={18} />
          <span>
            {playlistDraft.trim()
              ? 'Плейлист добавится к выбранным темам. Аудио проверяется только для нужного количества раундов.'
              : selectedThemeIds.length > 1
                ? `Выбрано тем: ${selectedThemeIds.length}`
                : themes.find((theme) => theme.id === selectedThemeIds[0])?.description ?? 'Треки подбираются из Яндекс Музыки'}
          </span>
        </div>
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
  volume,
  audioRef,
  onSubmit
}: {
  room: Room;
  me?: Player;
  volume: number;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  onSubmit: (optionId: string) => void;
}) {
  const question = room.currentQuestion!;
  const countdown = useQuestionCountdown(question, room.serverTime);

  return (
    <div className="stage question-stage">
      <audio
        ref={audioRef}
        key={question.id}
        src={question.audioUrl}
        autoPlay
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = volume;
        }}
      />

      <div className="round-header">
        <span>
          Раунд {question.round} из {room.settings.rounds}
        </span>
        <span>{me?.lastAnswer ? 'Ответ принят' : 'Выберите название трека'}</span>
      </div>

      <div className="music-visual">
        <div className="countdown-ring" style={{ '--progress': `${countdown.progress * 360}deg` } as React.CSSProperties}>
          <Timer size={26} />
          <strong>{countdown.secondsLeft}</strong>
          <span>сек</span>
        </div>
        <Equalizer />
      </div>

      <div className="answers">
        {question.options.map((option) => (
          <button
            className={[
              'answer-button',
              me?.lastAnswer?.optionId === option.id ? 'selected-answer' : '',
              me?.lastAnswer ? 'locked-answer' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            key={option.id}
            onClick={() => onSubmit(option.id)}
            disabled={Boolean(me?.lastAnswer)}
          >
            {option.title}
            {me?.lastAnswer?.optionId === option.id && <span className="answer-picked">Ваш ответ</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultStage({ room, isHost, emit }: { room: Room; isHost: boolean; emit: <T>(event: string, payload: unknown, onSuccess?: (data: T) => void, label?: string) => void }) {
  function selectedOptionTitle(player: Player): string {
    const optionId = player.lastAnswer?.optionId;
    return room.currentQuestion?.options.find((option) => option.id === optionId)?.title ?? 'Не ответил';
  }

  return (
    <div className="stage result-stage">
      <p className="eyebrow">{room.status === 'finished' ? 'Финал' : 'Ответ'}</p>
      <h2>{room.status === 'finished' ? 'Игра окончена' : 'Раунд завершен'}</h2>
      {room.correctTrack && (
        <div className="solution">
          <Music2 size={24} />
          <div>
            <strong>{room.correctTrack.title}</strong>
            <span>{room.correctTrack.artist}</span>
          </div>
        </div>
      )}
      <div className="result-list">
        {room.players.map((player, index) => (
          <div className="score-row" key={player.id}>
            <span>{index === 0 ? <Crown size={18} /> : index + 1}</span>
            <strong>
              {player.name}
              <small className={player.lastAnswer?.isCorrect ? 'answer-summary correct' : 'answer-summary'}>
                {selectedOptionTitle(player)}
              </small>
            </strong>
            {player.lastAnswer?.points ? <b className="score-pop">+{player.lastAnswer.points}</b> : <small>0</small>}
            {room.status === 'finished' && <em>{player.score}</em>}
          </div>
        ))}
      </div>
      <div className="actions">
        {isHost && room.status === 'round-result' && (
          <button className="primary" onClick={() => emit('next_round', { code: room.code }, undefined, 'Готовим следующий трек')}>
            <Play size={18} />
            Следующий раунд
          </button>
        )}
        {isHost && room.status === 'finished' && (
          <button className="primary" onClick={() => emit('reset_game', { code: room.code }, undefined, 'Возвращаем в лобби')}>
            <RotateCcw size={18} />
            Новая игра
          </button>
        )}
        {room.status === 'finished' && (
          <div className="notice winner">
            <Trophy size={18} />
            <span>Победитель: {room.players[0]?.name ?? 'игрок'}</span>
          </div>
        )}
      </div>
    </div>
  );
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
  return (
    <div className="equalizer" aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => (
        <span key={index} style={{ '--delay': `${(index % 6) * 110}ms` } as React.CSSProperties} />
      ))}
    </div>
  );
}

function useQuestionCountdown(question: NonNullable<Room['currentQuestion']>, serverTime: number) {
  const [now, setNow] = useState(Date.now());
  const serverOffsetRef = useRef(0);

  useEffect(() => {
    serverOffsetRef.current = serverTime - Date.now();
    const interval = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(interval);
  }, [question.id, serverTime]);

  const adjustedNow = now + serverOffsetRef.current;
  const remaining = Math.max(0, question.endsAt - adjustedNow);
  return {
    secondsLeft: Math.ceil(remaining / 1000),
    progress: remaining / question.durationMs
  };
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
