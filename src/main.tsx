import {
  BatteryCharging,
  Brain,
  Copy,
  Crown,
  DoorOpen,
  KeyRound,
  LoaderCircle,
  LogIn,
  Medal,
  Music2,
  Play,
  Plus,
  Radio,
  Repeat2,
  RotateCcw,
  ScanLine,
  Skull,
  Sparkles,
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
import {
  createAudioDiagnosticEntry,
  getQuestionAudioSessionKey,
  isSameAudioElementSource,
  resetQuestionAudioElement
} from './audioScheduling';
import { canHostKickPlayer } from './playerActions';
import { Starfield } from './starfield';
import './styles.css';

type Theme = {
  id: string;
  title: string;
  description: string;
  source: 'demo' | 'yandex';
};

type AnswerEvent = {
  optionId: string;
  responseMs: number;
};

type PlayerAnswerResult = {
  optionId: string;
  firstOptionId: string;
  previousOptionId?: string;
  isCorrect: boolean;
  responseMs: number;
  firstResponseMs: number;
  lastResponseMs: number;
  points: number;
  basePoints: number;
  scoreMultiplier?: number;
  scoreNote?: string;
  answerChanges: number;
  answerEvents: AnswerEvent[];
};

type ComebackAbility = 'jammer' | 'counter' | 'timecut';

type Player = {
  id: string;
  name: string;
  score: number;
  correctAnswers: number;
  connected: boolean;
  isHost: boolean;
  comebackEnergy: number;
  pendingComebackAbility?: ComebackAbility;
  counterPrediction?: number;
  hiddenOptionIndexes?: number[];
  reducedQuestionDurationMs?: number;
  reducedQuestionEndsAt?: number;
  timecutActive?: boolean;
  comebackStatus?: 'armed' | 'jammed' | 'countered' | 'missed';
  lastAnswer?: { hasAnswered: true; responseMs: number; firstResponseMs: number; lastResponseMs: number; answerChanges: number } | PlayerAnswerResult;
};

type Achievement = {
  id: string;
  icon: string;
  title: string;
  description: string;
  recipient?: string;
  tone: 'safe' | 'good' | 'bad' | 'chaos' | 'rare';
  chainId?: string;
  chainStep?: number;
  chainTotal?: number;
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
  trackCount?: number;
};

type AudioDeliveryMode = 'direct' | 'cache' | 'unknown';

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
    answerMode: 'title' | 'artist' | 'mixed';
    winCondition: 'rounds' | 'score';
    rounds: number;
    targetScore: number;
    questionDurationMs: number;
    allowAnswerChange: boolean;
    autoNextRound: boolean;
    achievementsEnabled: boolean;
    comebackMode: boolean;
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
  comeback?: {
    queuedJammerPlayerId?: string;
    queuedJammerPlayerName?: string;
    queuedTimecutPlayerId?: string;
    queuedTimecutPlayerName?: string;
    lastJammerPlayerId?: string;
    lastJammerPlayerName?: string;
    lastTimecutPlayerId?: string;
    lastTimecutPlayerName?: string;
    lastAttackingPlayerIds?: string[];
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

type AppMode = 'normal' | 'display' | 'player';

function hasRevealedAnswer(player: Player): player is Player & { lastAnswer: PlayerAnswerResult } {
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

function getAppModeFromUrl(): AppMode {
  const pathMode = window.location.pathname.match(/\/room\/[A-Za-z0-9]{4,8}\/(display|player)\b/)?.[1];
  const queryMode = new URLSearchParams(window.location.search).get('mode');
  const mode = pathMode ?? queryMode;
  return mode === 'display' || mode === 'player' ? mode : 'normal';
}

function App() {
  const [playerId] = useState(() => getOrCreatePlayerId());
  const roomCodeFromUrl = useMemo(() => getRoomCodeFromUrl(), []);
  const appMode = useMemo(() => getAppModeFromUrl(), []);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('playerName') ?? '');
  const [joinCode, setJoinCode] = useState(roomCodeFromUrl);
  const [room, setRoom] = useState<Room | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [audioDeliveryMode, setAudioDeliveryMode] = useState<AudioDeliveryMode>('unknown');
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [copied, setCopied] = useState(false);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('volume') ?? 0.1));
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState({ questionId: '', optionId: '' });
  const [audioNeedsGesture, setAudioNeedsGesture] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const leftRoomCodesRef = useRef(new Set<string>());
  const roomRef = useRef<Room | null>(null);
  const playerNameRef = useRef(playerName);

  const me = useMemo(() => room?.players.find((player) => player.id === playerId), [playerId, room]);
  const isHost = Boolean(me?.isHost);
  const sortedPlayers = useMemo(
    () => [...(room?.players ?? [])].sort((a, b) => b.score - a.score || Number(b.connected) - Number(a.connected)),
    [room?.players]
  );
  const isQuestionStage = room?.status === 'question' && Boolean(room.currentQuestion);
  const isResultStage = room?.status === 'round-result' || room?.status === 'finished';
  const isInteractionBusy = isBusy || isReconnecting;
  const answeredCount = room?.players.filter((player) => Boolean(player.lastAnswer)).length ?? 0;
  const playerCount = room?.players.length ?? 0;
  const selectedOptionId = room?.currentQuestion?.id === selectedAnswer.questionId ? selectedAnswer.optionId : '';

  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    localStorage.setItem('theme', 'dark');
  }, []);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  useEffect(() => {
    fetch('/api/themes')
      .then((response) => response.json())
      .then((payload) => setThemes(payload.data ?? []))
      .catch(() => setError('Не удалось загрузить темы'));

    fetch('/api/music/diagnostics')
      .then((response) => response.json())
      .then((payload: { data?: { audioDeliveryMode?: AudioDeliveryMode } }) => {
        const mode = payload.data?.audioDeliveryMode;
        setAudioDeliveryMode(mode === 'cache' || mode === 'direct' ? mode : 'unknown');
      })
      .catch(() => setAudioDeliveryMode('unknown'));

    const rejoinCurrentRoom = () => {
      const currentRoom = roomRef.current;
      if (appMode === 'display') {
        const code = currentRoom?.code ?? roomCodeFromUrl;
        if (!code) {
          setIsReconnecting(false);
          return;
        }
        setIsReconnecting(true);
        socket.timeout(12_000).emit('view_room', { code }, (timeoutError: Error | null, response?: { data?: Room; error?: string }) => {
          if (timeoutError) {
            setError('Не удалось восстановить экран ведущего: сервер не ответил.');
            return;
          }
          if (!response) {
            setError('Не удалось восстановить экран ведущего: сервер вернул пустой ответ.');
            return;
          }
          if (response.error) {
            setError(`Не удалось открыть экран ведущего: ${response.error}`);
            setIsReconnecting(false);
            return;
          }
          if (response.data) {
            handleRoomState(response.data);
            setError('');
            setIsReconnecting(false);
          }
        });
        return;
      }

      const name = (localStorage.getItem('playerName') ?? playerNameRef.current).trim();
      if (!currentRoom || !name || leftRoomCodesRef.current.has(currentRoom.code)) {
        setIsReconnecting(false);
        return;
      }

      setIsReconnecting(true);
      socket.timeout(12_000).emit('join_room', { code: currentRoom.code, playerId, playerName: name }, (timeoutError: Error | null, response?: { data?: Room; error?: string }) => {
        if (timeoutError) {
          setError('Не удалось восстановить соединение: сервер не ответил.');
          return;
        }
        if (!response) {
          setError('Не удалось восстановить соединение: сервер вернул пустой ответ.');
          return;
        }
        if (response.error) {
          setError(`Не удалось восстановить соединение: ${response.error}`);
          setIsReconnecting(false);
          return;
        }
        if (response.data) {
          handleRoomState(response.data);
          setError('');
          setIsReconnecting(false);
        }
      });
    };

    const handleDisconnect = (reason: string) => {
      if (!roomRef.current) {
        return;
      }
      setIsBusy(false);
      setBusyLabel('');
      setIsReconnecting(true);
      setError(reason === 'io server disconnect' ? 'Сервер разорвал соединение. Пробуем подключиться заново...' : 'Связь с комнатой потеряна. Пробуем переподключиться...');
    };

    const handleConnectError = () => {
      if (!roomRef.current) {
        return;
      }
      setIsReconnecting(true);
      setError('Не получается подключиться к серверу. Игра продолжит восстановление автоматически.');
    };

    const handleReconnectAttempt = () => {
      if (!roomRef.current) {
        return;
      }
      setIsReconnecting(true);
      setError('Переподключаемся к комнате...');
    };

    const handleReconnectFailed = () => {
      if (!roomRef.current) {
        return;
      }
      setIsReconnecting(false);
      setError('Не удалось переподключиться автоматически. Проверьте сеть и обновите страницу, если связь не восстановится.');
    };

    socket.on('room_state', handleRoomState);
    socket.on('round_started', setRoom);
    socket.on('round_result', setRoom);
    socket.on('connect', rejoinCurrentRoom);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.io.on('reconnect_attempt', handleReconnectAttempt);
    socket.io.on('reconnect_failed', handleReconnectFailed);
    socket.on('kicked', ({ message }: { message: string }) => {
      setRoom(null);
      setIsReconnecting(false);
      setError(message);
      window.history.replaceState(null, '', '/');
    });

    return () => {
      socket.off('room_state', handleRoomState);
      socket.off('round_started', setRoom);
      socket.off('round_result', setRoom);
      socket.off('connect', rejoinCurrentRoom);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      socket.io.off('reconnect_failed', handleReconnectFailed);
      socket.off('kicked');
    };
  }, [appMode, roomCodeFromUrl]);

  useEffect(() => {
    if (room || !roomCodeFromUrl) {
      return;
    }
    if (appMode === 'display') {
      emit<Room>('view_room', { code: roomCodeFromUrl }, handleRoomState, 'Открываем экран ведущего');
    }
  }, [appMode, room, roomCodeFromUrl]);

  useEffect(() => {
    localStorage.setItem('volume', String(volume));
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
    if (volume === 0) {
      setAudioNeedsGesture(false);
    }
  }, [volume]);

  useEffect(() => {
    if (room?.status !== 'question' || !room.currentQuestion) {
      setSelectedAnswer({ questionId: '', optionId: '' });
      setAudioNeedsGesture(false);
    }
  }, [room?.status, room?.currentQuestion?.id]);

  useEffect(() => {
    if (!room) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [room?.status, room?.currentQuestion?.id, room?.round]);

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

    const interval = window.setInterval(ping, 90_000);

    return () => window.clearInterval(interval);
  }, [room?.code]);

  function handleRoomState(nextRoom: Room) {
    if (leftRoomCodesRef.current.has(nextRoom.code)) {
      return;
    }
    setIsReconnecting(false);
    setRoom(nextRoom);
    const nextPath = appMode === 'normal' ? `/room/${nextRoom.code}` : `/room/${nextRoom.code}/${appMode}`;
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, '', nextPath);
    }
  }

  function emit<T>(event: string, payload: unknown, onSuccess?: (data: T) => void, label = '', options: { silent?: boolean } = {}) {
    setError('');
    if (room && event !== 'leave_room' && (isReconnecting || !socket.connected)) {
      setError('Связь с комнатой восстанавливается. Дождитесь переподключения и повторите действие.');
      return;
    }
    if (!options.silent) {
      setBusyLabel(label);
      setIsBusy(true);
    }
    socket.timeout(12_000).emit(event, payload, (timeoutError: Error | null, response?: { data?: T; error?: string }) => {
      if (!options.silent) {
        setIsBusy(false);
        setBusyLabel('');
      }
      if (timeoutError) {
        setError('Сервер не ответил. Проверьте соединение, игра попробует восстановиться автоматически.');
        return;
      }
      if (!response) {
        setError('Сервер вернул пустой ответ. Попробуйте действие еще раз.');
        return;
      }
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

  function createDisplayRoom() {
    emit<Room>(
      'create_display_room',
      {},
      (nextRoom) => {
        window.location.assign(displayRoomUrl(nextRoom.code));
      },
      'Создаем экран ведущего'
    );
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
    emit<Room>('update_settings', { code: room.code, playerId, settings }, setRoom, 'Обновляем настройки', { silent: true });
  }

  function submitAnswer(optionId: string) {
    if (!room || (me?.lastAnswer && !room.settings.allowAnswerChange)) return;
    if (isReconnecting || !socket.connected) {
      setError('Связь с комнатой восстанавливается. Ответ можно отправить после переподключения.');
      return;
    }
    if (selectedAnswer.questionId === room.currentQuestion?.id && selectedAnswer.optionId === optionId) return;
    setSelectedAnswer({ questionId: room.currentQuestion?.id ?? '', optionId });
    emit('submit_answer', { code: room.code, playerId, optionId }, undefined, 'Фиксируем ответ');
  }

  function activateComebackAbility(ability: ComebackAbility, counterPrediction?: number) {
    if (!room) return;
    emit<Room>(
      'activate_comeback_ability',
      { code: room.code, playerId, ability, counterPrediction },
      setRoom,
      ability === 'counter' ? 'Настраиваем Контрмеру' : ability === 'timecut' ? 'Заряжаем Ускоритель' : 'Заряжаем Глушилку'
    );
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

  function openDisplayMode() {
    if (!room) return;
    window.open(displayRoomUrl(room.code), '_blank', 'noopener,noreferrer');
  }

  function toggleVolume() {
    setVolumeOpen((value) => !value);
    const audio = audioRef.current;
    if (audio && volume > 0) {
      audio.volume = volume;
      void audio.play().then(() => setAudioNeedsGesture(false)).catch(() => setAudioNeedsGesture(true));
    }
  }

  const volumeButton = (
    <div className="floating-volume" onPointerDown={(event) => event.stopPropagation()}>
      <button className={['round-button', audioNeedsGesture ? 'needs-audio-gesture' : ''].filter(Boolean).join(' ')} type="button" aria-label="Громкость" onClick={toggleVolume}>
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

  if (!room && appMode === 'display' && roomCodeFromUrl) {
    return <DisplayWaiting roomCode={roomCodeFromUrl} error={error} isBusy={isBusy} />;
  }

  if (!room && appMode === 'player' && roomCodeFromUrl) {
    return (
      <PlayerJoinScreen
        roomCode={roomCodeFromUrl}
        playerName={playerName}
        isBusy={isInteractionBusy}
        error={error}
        onPlayerNameChange={setPlayerName}
        onJoin={joinRoom}
      />
    );
  }

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
            <div className="auth-actions">
              <button className="primary" onClick={joinRoom} disabled={isInteractionBusy}>
                <LogIn size={18} />
                Войти в комнату {roomCodeFromUrl}
              </button>
              <button className="secondary" onClick={createRoom} disabled={isInteractionBusy}>
                <Users size={18} />
                Создать новую
              </button>
            </div>
          ) : (
            <div className="auth-actions">
              <button className="primary" onClick={createRoom} disabled={isInteractionBusy}>
                <Users size={18} />
                Создать комнату
              </button>
              <button className="secondary" onClick={createDisplayRoom} disabled={isInteractionBusy}>
                <Radio size={18} />
                Экран ведущего
              </button>
            </div>
          )}

          <div className="join-row">
            <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="Код" maxLength={6} />
            <button className="secondary" onClick={joinRoom} disabled={isInteractionBusy}>
              <LogIn size={18} />
              Войти
            </button>
          </div>

          {isInteractionBusy && <LoadingStrip label={isReconnecting ? 'Восстанавливаем соединение' : busyLabel || 'Подключаемся'} />}
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  if (appMode === 'display') {
    return (
      <>
        <DisplayRoom
          room={room}
          volume={volume}
          audioRef={audioRef}
          answeredCount={answeredCount}
          playerCount={playerCount}
          onResetToLobby={() => emit<Room>('reset_display_game', { code: room.code }, setRoom, 'Возвращаем в лобби')}
        />
        {volumeButton}
      </>
    );
  }

  if (appMode === 'player') {
    return (
      <>
        <PlayerRoom
          room={room}
          me={me}
          themes={themes}
          audioDeliveryMode={audioDeliveryMode}
          isHost={isHost}
          isBusy={isInteractionBusy}
          selectedOptionId={selectedOptionId}
          volume={volume}
          audioRef={audioRef}
          onStart={() => emit('start_game', { code: room.code, playerId }, undefined, 'Готовим треки Яндекс Музыки')}
          onResetGame={requestResetGame}
          onAutoNextRoundToggle={() =>
            emit<Room>(
              'set_auto_next_round',
              { code: room.code, playerId, enabled: !room.settings.autoNextRound },
              undefined,
              room.settings.autoNextRound ? 'Ставим паузу между раундами' : 'Включаем автозапуск раундов'
            )
          }
          onAudioNeedsGestureChange={setAudioNeedsGesture}
          onSettingsChange={updateSettings}
          onSubmit={submitAnswer}
          onActivateComebackAbility={activateComebackAbility}
        />
        {isQuestionStage && volumeButton}
        {confirmDialog && <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />}
      </>
    );
  }

  return (
    <main className={['page', isQuestionStage ? 'question-page' : '', isResultStage ? 'result-page' : ''].filter(Boolean).join(' ')}>
      <RoomHeader
        room={room}
        me={me}
        isHost={isHost}
        copied={copied}
        isQuestionStage={isQuestionStage}
        onCopyInvite={copyInvite}
        onOpenDisplay={openDisplayMode}
        onLeaveRoom={requestLeaveRoom}
        onResetGame={requestResetGame}
      />

      {error && <p className="error">{error}</p>}

      <div className={['layout', isQuestionStage ? 'question-layout' : ''].filter(Boolean).join(' ')}>
        <PlayersPanel
          room={room}
          players={sortedPlayers}
          playerId={playerId}
          isHost={isHost}
          isQuestionStage={isQuestionStage}
          answeredCount={answeredCount}
          playerCount={playerCount}
          onKickPlayer={requestKickPlayer}
        />

        <section className="game-panel">
          {room.status === 'lobby' && (
            <Lobby
              room={room}
              themes={themes}
              audioDeliveryMode={audioDeliveryMode}
              isHost={isHost}
              isBusy={isInteractionBusy}
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
            <ResultStage room={room} isHost={isHost} playerId={playerId} emit={emit} onActivateComebackAbility={activateComebackAbility} />
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
  audioDeliveryMode,
  isHost,
  isBusy,
  onStart,
  onSettingsChange
}: {
  room: Room;
  themes: Theme[];
  audioDeliveryMode: AudioDeliveryMode;
  isHost: boolean;
  isBusy: boolean;
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
  const hasMusicSource = hasPlaylistSource || selectedThemeIds.length > 0;

  return (
    <div className="stage lobby-stage">
      <p className="eyebrow">Лобби</p>
      <h2>Ожидание игроков</h2>
      <div className={['audio-mode-status', audioDeliveryMode].filter(Boolean).join(' ')}>
        <Volume2 size={17} />
        <span>
          <strong>{audioDeliveryMode === 'cache' ? 'Аудио через сервер' : audioDeliveryMode === 'direct' ? 'Аудио напрямую' : 'Аудио проверяется'}</strong>
          <small>
            {audioDeliveryMode === 'cache'
              ? 'Render раздает отрывки из кеша. Надежнее, но расходует исходящий трафик.'
              : audioDeliveryMode === 'direct'
                ? 'Браузеры игроков грузят отрывки с Яндекс Музыки. Render почти не тратит трафик на звук.'
                : 'Режим доставки звука будет показан после ответа сервера.'}
          </small>
        </span>
      </div>

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
          <span>Варианты ответа</span>
          <div className="difficulty-toggle" role="group" aria-label="Варианты ответа">
            <button
              type="button"
              className={room.settings.answerMode === 'title' ? 'active' : ''}
              disabled={!isHost || isBusy}
              onClick={() => onSettingsChange({ answerMode: 'title' })}
            >
              <strong>Песни</strong>
              <small>Только названия треков</small>
            </button>
            <button
              type="button"
              className={room.settings.answerMode === 'artist' ? 'active' : ''}
              disabled={!isHost || isBusy}
              onClick={() => onSettingsChange({ answerMode: 'artist' })}
            >
              <strong>Исполнители</strong>
              <small>Только имена артистов</small>
            </button>
            <button
              type="button"
              className={room.settings.answerMode === 'mixed' ? 'active' : ''}
              disabled={!isHost || isBusy}
              onClick={() => onSettingsChange({ answerMode: 'mixed' })}
            >
              <strong>Смешанный</strong>
              <small>2 исполнителя и 2 трека</small>
            </button>
          </div>
        </label>
        <div className="settings-subgroup wide-field">
          <div className="settings-subgroup-title">Дополнительно</div>
          <label className={['setting-toggle', room.settings.allowAnswerChange ? 'active' : ''].filter(Boolean).join(' ')}>
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
          <label className={['setting-toggle', room.settings.autoNextRound ? 'active' : ''].filter(Boolean).join(' ')}>
            <input
              type="checkbox"
              disabled={!isHost || isBusy}
              checked={room.settings.autoNextRound}
              onChange={(event) => onSettingsChange({ autoNextRound: event.target.checked })}
            />
            <span>
              <strong>Автозапуск следующего раунда</strong>
              <small>После результата следующий раунд стартует сам. Выключите, если нужна пауза между раундами.</small>
            </span>
          </label>
          <label className={['setting-toggle', 'comeback-toggle', room.settings.comebackMode ? 'active' : ''].filter(Boolean).join(' ')}>
            <input
              type="checkbox"
              disabled={!isHost || isBusy}
              checked={room.settings.comebackMode}
              onChange={(event) => onSettingsChange({ comebackMode: event.target.checked })}
            />
            <span>
              <strong>Реванш <em className="beta-label">(beta)</em></strong>
              <small>
                Режим камбэка: догоняющие заряжают скиллы за правильные ответы, чтобы прижать лидера Глушилкой или Ускорителем. Лидер может выкрутиться Контрмерой, если угадает скрытый слот. Последний в рейтинге получает x2 очки за верные ответы.
              </small>
            </span>
          </label>
        </div>
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
                    className="playlist-remove-button"
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
                        {typeof source.trackCount === 'number' && <small>{source.trackCount} треков</small>}
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
              <label className={['theme-choice', selectedThemeIds.includes(theme.id) ? 'active' : ''].filter(Boolean).join(' ')} key={theme.id}>
                <input
                  type="checkbox"
                  disabled={!isHost || isBusy}
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

      <div className="actions">
        {isHost ? (
          <button className="primary start-button" onClick={onStart} disabled={isBusy || !hasMusicSource}>
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

function DisplayWaiting({ roomCode, error, isBusy }: { roomCode: string; error: string; isBusy: boolean }) {
  return (
    <main className="page display-page">
      <section className="display-panel">
        <p className="eyebrow">Экран ведущего</p>
        <h1 className="app-title">Угадай мелодию</h1>
        <div className="display-code">Комната {roomCode}</div>
        {isBusy && <LoadingStrip label="Подключаем экран" />}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}

function PlayerJoinScreen({
  roomCode,
  playerName,
  isBusy,
  error,
  onPlayerNameChange,
  onJoin
}: {
  roomCode: string;
  playerName: string;
  isBusy: boolean;
  error: string;
  onPlayerNameChange: (value: string) => void;
  onJoin: () => void;
}) {
  return (
    <main className="page player-page">
      <section className="player-panel">
        <p className="eyebrow">Комната {roomCode}</p>
        <h1>Войти в игру</h1>
        <label className="field">
          <span>Ваше имя</span>
          <input
            value={playerName}
            onChange={(event) => onPlayerNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onJoin();
              }
            }}
            maxLength={32}
            placeholder="Например, Аня"
          />
        </label>
        <button className="primary" onClick={onJoin} disabled={isBusy}>
          <LogIn size={18} />
          Играть
        </button>
        {isBusy && <LoadingStrip label="Входим в комнату" />}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}

function DisplayRoom({
  room,
  volume,
  audioRef,
  answeredCount,
  playerCount,
  onResetToLobby
}: {
  room: Room;
  volume: number;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  answeredCount: number;
  playerCount: number;
  onResetToLobby: () => void;
}) {
  const playerUrl = playerRoomUrl(room.code);
  const noopEmit = () => undefined;
  const showJoinQr = room.status === 'lobby';
  const isQuestionStage = room.status === 'question' && Boolean(room.currentQuestion);

  return (
    <main className="page display-page">
      <section className="display-hero compact">
        <div>
          <p className="eyebrow">Комната {room.code}</p>
          <h1 className="app-title">Угадай мелодию</h1>
          <div className="display-meta">
            <span>Игроков: {playerCount}</span>
            <span>Ответили: {answeredCount}/{playerCount}</span>
          </div>
        </div>
      </section>

      <div className="display-layout">
        <PlayersPanel
          room={room}
          players={room.players}
          playerId=""
          isHost={false}
          isQuestionStage={isQuestionStage}
          answeredCount={answeredCount}
          playerCount={playerCount}
          onKickPlayer={noopEmit}
        />
        <section className="game-panel display-game-panel">
          {room.status === 'lobby' && (
            <div className="stage display-lobby-stage">
              <div className="display-lobby-content">
                <div>
                  <h2>Ждем игроков</h2>
                  <p className="muted">Игроки сканируют QR-код и отвечают со своих телефонов.</p>
                </div>
                {showJoinQr && <QrJoinCard roomCode={room.code} url={playerUrl} />}
              </div>
            </div>
          )}
          {room.status === 'preparing' && <PreparingStage />}
          {room.status === 'question' && room.currentQuestion && (
            <DisplayQuestionStage room={room} volume={volume} audioRef={audioRef} />
          )}
          {(room.status === 'round-result' || room.status === 'finished') && (
            <ResultStage room={room} isHost={false} playerId="" emit={noopEmit} onResetToLobby={onResetToLobby} />
          )}
        </section>
      </div>
    </main>
  );
}

function QrJoinCard({ roomCode, url }: { roomCode: string; url: string }) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(url)}`;

  return (
    <aside className="qr-card">
      <img src={qrUrl} alt={`QR-код для входа в комнату ${roomCode}`} />
      <strong>{roomCode}</strong>
      <span>{url}</span>
    </aside>
  );
}

type QuestionAudioElementProps = React.AudioHTMLAttributes<HTMLAudioElement> & {
  diagnosticQuestion: Pick<NonNullable<Room['currentQuestion']>, 'id' | 'startedAt'>;
};

const QuestionAudioElement = React.memo(
  React.forwardRef<HTMLAudioElement, QuestionAudioElementProps>(function QuestionAudioElement(
    { src, diagnosticQuestion, onLoadStart, onLoadedData, onCanPlay, onPlay, onPlaying, onWaiting, onStalled, onError, ...props },
    ref
  ) {
    function diagnose(event: string, audio: HTMLAudioElement): void {
      if (!isAudioDiagnosticsEnabled()) {
        return;
      }
      console.info(
        '[audio-diagnostic]',
        createAudioDiagnosticEntry({
          event,
          questionId: diagnosticQuestion.id,
          scheduledStartAt: diagnosticQuestion.startedAt,
          now: Date.now(),
          audio: {
            currentTime: audio.currentTime,
            readyState: audio.readyState,
            networkState: audio.networkState,
            paused: audio.paused,
            errorCode: audio.error?.code ?? null
          }
        })
      );
    }

    return (
      <audio
        ref={ref}
        src={src}
        preload="auto"
        onLoadStart={(event) => {
          diagnose('loadstart', event.currentTarget);
          onLoadStart?.(event);
        }}
        onLoadedData={(event) => {
          diagnose('loadeddata', event.currentTarget);
          onLoadedData?.(event);
        }}
        onCanPlay={(event) => {
          diagnose('canplay', event.currentTarget);
          onCanPlay?.(event);
        }}
        onPlay={(event) => {
          diagnose('play', event.currentTarget);
          onPlay?.(event);
        }}
        onPlaying={(event) => {
          diagnose('playing', event.currentTarget);
          onPlaying?.(event);
        }}
        onWaiting={(event) => {
          diagnose('waiting', event.currentTarget);
          onWaiting?.(event);
        }}
        onStalled={(event) => {
          diagnose('stalled', event.currentTarget);
          onStalled?.(event);
        }}
        onError={(event) => {
          diagnose('error', event.currentTarget);
          onError?.(event);
        }}
        {...props}
      />
    );
  }),
  (previous, next) =>
    isSameAudioElementSource(previous.src, next.src) &&
    previous.diagnosticQuestion.id === next.diagnosticQuestion.id &&
    previous.diagnosticQuestion.startedAt === next.diagnosticQuestion.startedAt
);

function DisplayQuestionStage({
  room,
  volume,
  audioRef
}: {
  room: Room;
  volume: number;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
}) {
  const question = room.currentQuestion!;
  const countdown = useQuestionCountdown(question, room.serverTime);
  const [audioIssue, setAudioIssue] = useState('');

  const playAudio = useScheduledQuestionAudio({
    question,
    serverTime: room.serverTime,
    volume,
    audioRef,
    onBlocked: () => setAudioIssue('Браузер не запустил звук автоматически. Нажмите повторить.')
  });

  useEffect(() => {
    setAudioIssue('');
  }, [question.id]);

  return (
    <div className="stage question-stage display-question-stage">
      <QuestionAudioElement
        ref={audioRef}
        src={question.audioUrl}
        diagnosticQuestion={question}
        onError={() => setAudioIssue('Не удалось воспроизвести этот отрывок.')}
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = volume;
        }}
      />
      <div className="round-header round-topline">
        <span>{room.settings.winCondition === 'score' ? `Раунд ${question.round}` : `Раунд ${question.round} из ${room.settings.rounds}`}</span>
        <span>{answerModePrompt(room.settings.answerMode)}</span>
      </div>
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
      <div className="answers display-answers">
        {question.options.map((option) => (
          <button className="answer-button" key={option.id} disabled>
            {option.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlayerRoom({
  room,
  me,
  themes,
  audioDeliveryMode,
  isHost,
  isBusy,
  selectedOptionId,
  volume,
  audioRef,
  onStart,
  onResetGame,
  onAutoNextRoundToggle,
  onAudioNeedsGestureChange,
  onSettingsChange,
  onSubmit,
  onActivateComebackAbility
}: {
  room: Room;
  me?: Player;
  themes: Theme[];
  audioDeliveryMode: AudioDeliveryMode;
  isHost: boolean;
  isBusy: boolean;
  selectedOptionId: string;
  volume: number;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  onStart: () => void;
  onResetGame: () => void;
  onAutoNextRoundToggle: () => void;
  onAudioNeedsGestureChange: (needsGesture: boolean) => void;
  onSettingsChange: (settings: Partial<Room['settings']>) => void;
  onSubmit: (optionId: string) => void;
  onActivateComebackAbility: (ability: ComebackAbility, counterPrediction?: number) => void;
}) {
  return (
    <main className="page player-page">
      <section className="player-panel">
        <div className="player-mode-header">
          <span>Комната {room.code}</span>
          <strong>{me?.name ?? 'Игрок'}</strong>
        </div>
        {isHost && room.status !== 'lobby' && (
          <div className="player-host-actions">
            <button className={room.status === 'finished' ? 'primary' : 'secondary'} type="button" onClick={onResetGame}>
              <RotateCcw size={18} />
              В лобби
            </button>
            {room.status === 'round-result' && (
              <button className="secondary" type="button" onClick={onAutoNextRoundToggle}>
                {room.settings.autoNextRound ? <Timer size={18} /> : <Play size={18} />}
                {room.settings.autoNextRound ? 'Пауза между раундами' : 'Автозапуск раундов'}
              </button>
            )}
          </div>
        )}
        {room.status === 'lobby' && (
          isHost ? (
            <div className="player-host-lobby">
              <PlayerStatus title="Вы ведущий" text="Настройте игру и запускайте раунд. Музыка будет играть на общем экране." />
              <Lobby room={room} themes={themes} audioDeliveryMode={audioDeliveryMode} isHost={isHost} isBusy={isBusy} onStart={onStart} onSettingsChange={onSettingsChange} />
            </div>
          ) : (
            <PlayerStatus title="Ждем старт" text="Ведущий скоро начнет раунд." />
          )
        )}
        {room.status === 'preparing' && <PlayerStatus title="Готовим трек" text="Сейчас появятся варианты ответа." />}
        {room.status === 'question' && room.currentQuestion && (
          <PlayerQuestionStage
            room={room}
            me={me}
            selectedOptionId={selectedOptionId}
            volume={volume}
            audioRef={audioRef}
            answeredCount={room.players.filter((player) => Boolean(player.lastAnswer)).length}
            playerCount={room.players.length}
            onAudioNeedsGestureChange={onAudioNeedsGestureChange}
            onSubmit={onSubmit}
          />
        )}
        {room.status === 'round-result' && (
          <PlayerRoundResult room={room} me={me} onActivateComebackAbility={onActivateComebackAbility} />
        )}
        {room.status === 'finished' && (
          <div className="player-round-result">
            <PlayerStatus title="Игра окончена" text={`Победитель: ${room.players[0]?.name ?? 'игрок'}.`} />
            <PlayersPanel room={room} players={room.players} playerId={me?.id ?? ''} isHost={false} isQuestionStage={false} answeredCount={room.players.filter((player) => Boolean(player.lastAnswer)).length} playerCount={room.players.length} onKickPlayer={() => undefined} />
          </div>
        )}
      </section>
    </main>
  );
}

function PlayerRoundResult({
  room,
  me,
  onActivateComebackAbility
}: {
  room: Room;
  me?: Player;
  onActivateComebackAbility: (ability: ComebackAbility, counterPrediction?: number) => void;
}) {
  const optionId = me && hasRevealedAnswer(me) ? me.lastAnswer.optionId : undefined;
  const selectedTitle = room.currentQuestion?.options.find((option) => option.id === optionId)?.title;

  return (
    <div className="player-round-result">
      <PlayerStatus title="Раунд завершен" text={me?.lastAnswer ? 'Ответ принят. Ждем следующий раунд.' : 'Вы не ответили в этом раунде.'} />
      {room.correctTrack && (
        <div className="solution player-solution">
          {room.correctTrack.coverUrl ? <img className="track-cover result-cover" src={room.correctTrack.coverUrl} alt="" /> : <Music2 size={24} />}
          <div>
            <strong>{room.correctTrack.title}</strong>
            <span>{room.correctTrack.artist}</span>
            {selectedTitle && <small>Ваш ответ: {selectedTitle}</small>}
          </div>
        </div>
      )}
      {me && room.settings.comebackMode && room.players.length > 1 && (
        <ComebackAbilityPanel room={room} player={me} onActivate={onActivateComebackAbility} />
      )}
      <AchievementShelf achievements={room.achievements} title="Ачивки раунда" compact compactMode="title" />
      <PlayersPanel room={room} players={room.players} playerId={me?.id ?? ''} isHost={false} isQuestionStage={false} answeredCount={room.players.filter((player) => Boolean(player.lastAnswer)).length} playerCount={room.players.length} onKickPlayer={() => undefined} />
    </div>
  );
}

function PlayerStatus({ title, text }: { title: string; text: string }) {
  return (
    <div className="player-status-card">
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}

function PlayerQuestionStage({
  room,
  me,
  selectedOptionId,
  volume,
  audioRef,
  answeredCount,
  playerCount,
  onAudioNeedsGestureChange,
  onSubmit
}: {
  room: Room;
  me?: Player;
  selectedOptionId: string;
  volume: number;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  answeredCount: number;
  playerCount: number;
  onAudioNeedsGestureChange: (needsGesture: boolean) => void;
  onSubmit: (optionId: string) => void;
}) {
  const question = room.currentQuestion!;
  const countdown = useQuestionCountdown(question, room.serverTime, me?.reducedQuestionDurationMs, me?.reducedQuestionEndsAt);
  const hasAnswered = Boolean(me?.lastAnswer);
  const hasSubmitted = hasAnswered || Boolean(selectedOptionId);
  const isPersonalTimeExpired = countdown.secondsLeft <= 0;
  const isAnswerLocked = (hasSubmitted && !room.settings.allowAnswerChange) || isPersonalTimeExpired || countdown.isPendingStart;

  const playAudio = useScheduledQuestionAudio({
    question,
    serverTime: room.serverTime,
    volume,
    audioRef,
    onStarted: () => onAudioNeedsGestureChange(false),
    onBlocked: () => onAudioNeedsGestureChange(true)
  });

  useEffect(() => {
    onAudioNeedsGestureChange(false);
  }, [question.id]);

  useEffect(() => {
    if (volume <= 0) {
      audioRef.current?.pause();
      onAudioNeedsGestureChange(false);
      return;
    }
    playAudio();
  }, [volume]);

  return (
    <div className="player-question-stage">
      <QuestionAudioElement
        ref={audioRef}
        src={question.audioUrl}
        diagnosticQuestion={question}
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = volume;
        }}
      />
      <div className="round-header round-topline">
        <span>{room.settings.winCondition === 'score' ? `Раунд ${question.round}` : `Раунд ${question.round} из ${room.settings.rounds}`}</span>
        <span>{hasAnswered ? 'Ответ принят' : countdown.isPendingStart ? 'Готовим звук' : isPersonalTimeExpired ? 'Время вышло' : answerModePrompt(room.settings.answerMode)}</span>
        {playerCount > 1 && <span className="answered-pill mobile-answered-pill">Ответили {answeredCount}/{playerCount}</span>}
      </div>
      {me?.timecutActive && (
        <div className="notice timecut-notice">
          <Timer size={18} />
          <span>Ускоритель: ответ можно выбрать только первые {Math.ceil((me.reducedQuestionDurationMs ?? question.durationMs) / 1000)} сек.</span>
        </div>
      )}
      {isAnswerLocked && (
        <div className="notice player-answer-notice">
          {isPersonalTimeExpired && !hasAnswered ? 'Время вышло. Музыка доиграет для остальных.' : 'Ответ принят. Ждем остальных игроков.'}
        </div>
      )}
      <div className="answers player-answers">
        {question.options.map((option, index) => (
          <button
            className={[
              'answer-button',
              selectedOptionId === option.id ? 'selected-answer' : '',
              isAnswerLocked ? 'locked-answer' : '',
              me?.hiddenOptionIndexes?.includes(index) ? 'jammed-answer' : ''
            ].filter(Boolean).join(' ')}
            key={option.id}
            onClick={() => onSubmit(option.id)}
            disabled={isAnswerLocked}
            aria-label={me?.hiddenOptionIndexes?.includes(index) ? `Скрытый вариант ${index + 1}` : option.title}
          >
            <AnswerOptionLabel title={option.title} hidden={Boolean(me?.hiddenOptionIndexes?.includes(index))} />
            {selectedOptionId === option.id && <span className="answer-picked" aria-label="Выбрано">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function RoomHeader({
  room,
  me,
  isHost,
  copied,
  isQuestionStage,
  onCopyInvite,
  onOpenDisplay,
  onLeaveRoom,
  onResetGame
}: {
  room: Room;
  me?: Player;
  isHost: boolean;
  copied: boolean;
  isQuestionStage: boolean;
  onCopyInvite: () => void;
  onOpenDisplay: () => void;
  onLeaveRoom: () => void;
  onResetGame: () => void;
}) {
  const renderActions = () => (
    <>
      <button className="secondary icon-text" onClick={onCopyInvite}>
        <Copy size={18} />
        <span>{copied ? 'Скопировано' : 'Пригласить'}</span>
      </button>
      {room.status === 'lobby' && (
        <button className="secondary icon-text" onClick={onOpenDisplay}>
          <Radio size={18} />
          <span>Экран ведущего</span>
        </button>
      )}
      <button className="secondary icon-text" onClick={onLeaveRoom}>
        <DoorOpen size={18} />
        <span>Покинуть</span>
      </button>
      {isHost && room.status !== 'lobby' && (
        <button className="secondary icon-text" onClick={onResetGame}>
          <RotateCcw size={18} />
          <span>В лобби</span>
        </button>
      )}
    </>
  );

  return (
    <header className={['topbar', isQuestionStage ? 'question-topbar' : ''].filter(Boolean).join(' ')}>
      <div>
        <p className="eyebrow">Комната {room.code}</p>
        <h1 className="app-title">Угадай мелодию</h1>
        {me && (
          <p className="self-label">
            Вы: <strong>{me.name}</strong>
          </p>
        )}
      </div>
      <div className="top-actions">{renderActions()}</div>
      <details className="room-actions-menu">
        <summary className="secondary icon-text">
          <Users size={18} />
          <span>Комната</span>
        </summary>
        <div className="room-actions-popover">{renderActions()}</div>
      </details>
    </header>
  );
}

function PlayersPanel({
  room,
  players,
  playerId,
  isHost,
  isQuestionStage,
  answeredCount,
  playerCount,
  onKickPlayer
}: {
  room: Room;
  players: Player[];
  playerId: string;
  isHost: boolean;
  isQuestionStage: boolean;
  answeredCount: number;
  playerCount: number;
  onKickPlayer: (player: Player) => void;
}) {
  const rows = (
    <PlayerRows room={room} players={players} playerId={playerId} isHost={isHost} onKickPlayer={onKickPlayer} />
  );

  return (
    <aside className={['sidebar', 'players-panel', isQuestionStage ? 'question-players-panel' : ''].filter(Boolean).join(' ')}>
      <div className="section-title">
        <Users size={18} />
        Игроки
        {isQuestionStage && playerCount > 1 && <span className="answered-pill">Ответили {answeredCount}/{playerCount}</span>}
      </div>
      <div className="players players-full">{rows}</div>
      <details className="players-collapse">
        <summary>
          <span>Игроки</span>
          <b>Ответили {answeredCount}/{playerCount}</b>
        </summary>
        <div className="players">{rows}</div>
      </details>
    </aside>
  );
}

function PlayerRows({
  room,
  players,
  playerId,
  isHost,
  onKickPlayer
}: {
  room: Room;
  players: Player[];
  playerId: string;
  isHost: boolean;
  onKickPlayer: (player: Player) => void;
}) {
  return (
    <>
      {players.map((player, index) => (
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
            {canHostKickPlayer({
              isHost,
              currentPlayerId: playerId,
              targetPlayerId: player.id,
              roomStatus: room.status
            }) && (
              <button className="kick-button" type="button" aria-label={`Кикнуть ${player.name}`} onClick={() => onKickPlayer(player)}>
                <UserMinus size={11} />
              </button>
            )}
          </div>
        </div>
      ))}
    </>
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

function displayRoomUrl(code: string): string {
  return `${location.origin}/room/${code}/display`;
}

function playerRoomUrl(code: string): string {
  return `${location.origin}/room/${code}/player`;
}

function defaultPlaylistSourceName(url: string, index: number): string {
  return /\/artist\//i.test(url) ? `Исполнитель ${index + 1}` : /\/album\//i.test(url) ? `Альбом ${index + 1}` : `Плейлист ${index + 1}`;
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

function answerModePrompt(answerMode: Room['settings']['answerMode']): string {
  if (answerMode === 'artist') {
    return 'Выберите исполнителя';
  }
  if (answerMode === 'mixed') {
    return 'Выберите правильный вариант';
  }
  return 'Выберите название трека';
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
  const countdown = useQuestionCountdown(question, room.serverTime, me?.reducedQuestionDurationMs, me?.reducedQuestionEndsAt);
  const [audioIssue, setAudioIssue] = useState('');
  const isPersonalTimeExpired = countdown.secondsLeft <= 0;
  const isAnswerLocked = isPersonalTimeExpired || countdown.isPendingStart || Boolean(me?.lastAnswer && !room.settings.allowAnswerChange);

  const playAudio = useScheduledQuestionAudio({
    question,
    serverTime: room.serverTime,
    volume,
    audioRef,
    onBlocked: () => setAudioIssue('Браузер не запустил звук автоматически. Нажмите повторить.')
  });

  useEffect(() => {
    setAudioIssue('');
  }, [question.id]);

  return (
    <div className="stage question-stage round-screen">
      <QuestionAudioElement
        ref={audioRef}
        src={question.audioUrl}
        diagnosticQuestion={question}
        onError={() => setAudioIssue('Не удалось воспроизвести этот отрывок. Сервер попробует другой трек в следующем раунде.')}
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = volume;
        }}
      />

      <div className="round-header round-topline">
        <span>
          {room.settings.winCondition === 'score' ? `Раунд ${question.round}` : `Раунд ${question.round} из ${room.settings.rounds}`}
        </span>
        <span>{me?.lastAnswer ? 'Ответ принят' : countdown.isPendingStart ? 'Готовим звук' : isPersonalTimeExpired ? 'Время вышло' : answerModePrompt(room.settings.answerMode)}</span>
      </div>
      <div className="music-visual">
        <div className={['countdown-ring', me?.timecutActive ? 'timecut-countdown' : ''].filter(Boolean).join(' ')} style={{ '--progress': `${countdown.progress * 360}deg` } as React.CSSProperties}>
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
      {me?.timecutActive && (
        <div className="notice timecut-notice">
          <Timer size={18} />
          <span>Ускоритель: у вас времени в 2 раза меньше, минимум 5 секунд.</span>
        </div>
      )}
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
        {question.options.map((option, index) => (
          <button
            className={[
              'answer-button',
              selectedOptionId === option.id ? 'selected-answer' : '',
              isAnswerLocked ? 'locked-answer' : '',
              me?.hiddenOptionIndexes?.includes(index) ? 'jammed-answer' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            key={option.id}
            onClick={() => onSubmit(option.id)}
            disabled={isAnswerLocked}
            aria-label={me?.hiddenOptionIndexes?.includes(index) ? `Скрытый вариант ${index + 1}` : option.title}
          >
            <AnswerOptionLabel title={option.title} hidden={Boolean(me?.hiddenOptionIndexes?.includes(index))} />
            {selectedOptionId === option.id && <span className="answer-picked" aria-label="Выбрано">✓</span>}
          </button>
        ))}
      </div>

      <AchievementShelf achievements={room.achievements} title="События" compact compactMode="description" />

    </div>
  );
}

function AnswerOptionLabel({ title, hidden }: { title: string; hidden: boolean }) {
  if (!hidden) {
    return <span>{title}</span>;
  }

  return (
    <span className="jammed-answer-content">
      <span className="jammed-answer-text" aria-hidden="true">{title}</span>
      <span className="jammed-answer-signal">
        <ScanLine size={18} />
        Сигнал заглушён
      </span>
    </span>
  );
}

function ComebackAbilityPanel({
  room,
  player,
  onActivate
}: {
  room: Room;
  player: Player;
  onActivate: (ability: ComebackAbility, counterPrediction?: number) => void;
}) {
  const leader = [...room.players].sort(
    (left, right) => right.score - left.score || right.correctAnswers - left.correctAnswers || left.name.localeCompare(right.name, 'ru')
  )[0];
  const isLeader = leader?.id === player.id;
  const counterCost = 45;
  const abilityCost = 60;
  const isArmed = player.pendingComebackAbility !== undefined;
  const jammerOwner = room.comeback?.queuedJammerPlayerId;
  const timecutOwner = room.comeback?.queuedTimecutPlayerId;
  const jammerTaken = Boolean(jammerOwner && jammerOwner !== player.id);
  const timecutTaken = Boolean(timecutOwner && timecutOwner !== player.id);
  const isJammerCooldown = room.players.length >= 3 && room.comeback?.lastJammerPlayerId === player.id;
  const isTimecutCooldown = room.players.length >= 3 && room.comeback?.lastTimecutPlayerId === player.id;
  const lastAttackingPlayerIds = room.comeback?.lastAttackingPlayerIds ?? [room.comeback?.lastJammerPlayerId, room.comeback?.lastTimecutPlayerId].filter(Boolean);
  const isAttackTurnBlocked = room.players.length >= 3 && lastAttackingPlayerIds.includes(player.id);
  const canCounter = player.comebackEnergy >= counterCost && !isArmed && isLeader && Boolean(jammerOwner);
  const canUseJammer = player.comebackEnergy >= abilityCost && !isArmed && !isLeader && !jammerTaken && !isAttackTurnBlocked && !jammerOwner;
  const canUseTimecut = player.comebackEnergy >= abilityCost && !isArmed && !isLeader && !timecutTaken && !isAttackTurnBlocked && !timecutOwner;

  return (
    <section className={['comeback-panel', isArmed ? 'armed' : '', player.comebackStatus === 'countered' ? 'counter-success' : ''].filter(Boolean).join(' ')}>
      <div className="comeback-heading">
        <span className="comeback-icon"><BatteryCharging size={22} /></span>
        <div>
          <strong>Реванш <em className="beta-label">(beta)</em></strong>
          <small>Способность сработает автоматически в следующем раунде</small>
        </div>
        <b>{player.comebackEnergy}/100</b>
      </div>
      <div className="energy-track" aria-label={`Энергия ${player.comebackEnergy} из 100`}>
        <span style={{ '--energy': `${player.comebackEnergy}%` } as React.CSSProperties} />
      </div>

      {isLeader ? (
        <div className="ability-copy">
          <strong>Контрмера · 45 энергии</strong>
          <small>
            {jammerOwner
              ? 'Глушилка уже заряжена. Предскажите один из двух скрываемых слотов: точный прогноз раскроет его и вернёт 25 энергии.'
              : 'Контрмера станет доступна, когда кто-то зарядит Глушилку на следующий раунд.'}
          </small>
          <div className="counter-slots" aria-label="Выбор слота Контрмеры">
            {[0, 1, 2, 3].map((slot) => (
              <button
                type="button"
                className={[player.counterPrediction === slot ? 'active' : '', canCounter ? 'ready' : ''].filter(Boolean).join(' ')}
                disabled={!canCounter}
                onClick={() => onActivate('counter', slot)}
                key={slot}
              >
                {slot + 1}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="ability-grid">
          <div className="ability-copy">
            <strong>Глушилка · 60 энергии</strong>
            <small>Скроет текст двух разных случайных вариантов у лидера. Правильный ответ тоже может попасть под помеху.</small>
            <button className={['ability-button', canUseJammer ? 'ready' : ''].filter(Boolean).join(' ')} type="button" disabled={!canUseJammer} onClick={() => onActivate('jammer')}>
              <ScanLine size={18} />
              {player.pendingComebackAbility === 'jammer'
                ? 'Глушилка заряжена'
                : jammerTaken
                  ? `Уже зарядил ${room.comeback?.queuedJammerPlayerName}`
                  : isAttackTurnBlocked || isJammerCooldown
                    ? 'Сейчас очередь другого игрока'
                    : 'Зарядить на следующий раунд'}
            </button>
          </div>
          <div className="ability-copy">
            <strong>Ускоритель · 60 энергии</strong>
            <small>Сократит время лидера на песню в 2 раза, но не ниже 5 секунд.</small>
            <button className={['ability-button', 'timecut-button', canUseTimecut ? 'ready' : ''].filter(Boolean).join(' ')} type="button" disabled={!canUseTimecut} onClick={() => onActivate('timecut')}>
              <Timer size={18} />
              {player.pendingComebackAbility === 'timecut'
                ? 'Ускоритель заряжен'
                : timecutTaken
                  ? `Уже зарядил ${room.comeback?.queuedTimecutPlayerName}`
                  : isAttackTurnBlocked || isTimecutCooldown
                    ? 'Сейчас очередь другого игрока'
                    : 'Урезать таймер лидеру'}
            </button>
          </div>
        </div>
      )}

      {isArmed && <div className="ability-armed-notice">Заряд принят. Эффект применится автоматически при старте следующего раунда.</div>}
      {isAttackTurnBlocked && !isLeader && !isArmed && (
        <div className="ability-missed-notice">Сейчас не ваша очередь: вы уже использовали скилл в прошлом раунде. Дождитесь, пока его зарядит другой игрок.</div>
      )}
      {player.comebackStatus === 'countered' && <div className="ability-success-notice">Контрмера сработала: один слот раскрыт, +25 энергии.</div>}
      {player.comebackStatus === 'missed' && <div className="ability-missed-notice">Прогноз не совпал. Два варианта будут скрыты.</div>}
    </section>
  );
}

function ResultStage({
  room,
  isHost,
  playerId,
  emit,
  onActivateComebackAbility,
  onResetToLobby
}: {
  room: Room;
  isHost: boolean;
  playerId: string;
  emit: <T>(event: string, payload: unknown, onSuccess?: (data: T) => void, label?: string) => void;
  onActivateComebackAbility?: (ability: ComebackAbility, counterPrediction?: number) => void;
  onResetToLobby?: () => void;
}) {
  const nextRoundCountdown = useAutoNextCountdown(room.status, room.round, room.settings.autoNextRound);

  function selectedOptionTitle(player: Player): string {
    const optionId = hasRevealedAnswer(player) ? player.lastAnswer.optionId : undefined;
    return room.currentQuestion?.options.find((option) => option.id === optionId)?.title ?? 'Не ответил';
  }

  if (room.status === 'finished') {
    return <FinalStage room={room} isHost={isHost} playerId={playerId} emit={emit} selectedOptionTitle={selectedOptionTitle} onResetToLobby={onResetToLobby} />;
  }

  return (
    <div className="stage result-stage">
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
      <AchievementShelf achievements={room.achievements} title="Ачивки раунда" compact compactMode="title" />
      {room.settings.comebackMode && room.players.length > 1 && onActivateComebackAbility && room.players.some((player) => player.id === playerId) && (
        <ComebackAbilityPanel
          room={room}
          player={room.players.find((player) => player.id === playerId)!}
          onActivate={onActivateComebackAbility}
        />
      )}
      <div className="result-list round-result-list" aria-label="Очки раунда">
        {room.players.map((player, index) => (
          <div className="score-row" key={player.id}>
            <span>{index === 0 ? <Crown size={18} /> : index + 1}</span>
            <strong>
              {player.name}
              <small className={hasRevealedAnswer(player) && player.lastAnswer.isCorrect ? 'answer-summary correct' : 'answer-summary'}>
                {selectedOptionTitle(player)}
              </small>
            </strong>
            {hasRevealedAnswer(player) ? (
              <b className={['score-pop', player.lastAnswer.points < 0 ? 'penalty' : ''].filter(Boolean).join(' ')}>
                {formatSignedPoints(player.lastAnswer.points)}
                {player.lastAnswer.scoreNote && <small className="score-note">({player.lastAnswer.scoreNote})</small>}
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
        {isHost && (
          <button
            className="secondary"
            onClick={() =>
              emit<Room>(
                'set_auto_next_round',
                { code: room.code, playerId, enabled: !room.settings.autoNextRound },
                undefined,
                room.settings.autoNextRound ? 'Ставим паузу между раундами' : 'Включаем автозапуск раундов'
              )
            }
          >
            {room.settings.autoNextRound ? <Timer size={18} /> : <Play size={18} />}
            {room.settings.autoNextRound ? 'Пауза между раундами' : 'Автозапуск раундов'}
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
  selectedOptionTitle,
  onResetToLobby
}: {
  room: Room;
  isHost: boolean;
  playerId: string;
  emit: <T>(event: string, payload: unknown, onSuccess?: (data: T) => void, label?: string) => void;
  selectedOptionTitle: (player: Player) => string;
  onResetToLobby?: () => void;
}) {
  const podium = [room.players[1], room.players[0], room.players[2]].filter(Boolean);

  return (
    <div className="stage final-stage">
      <p className="eyebrow">Финал</p>
      <h2>Игра окончена</h2>
      <div className="notice winner">
        <Trophy size={18} />
        <span>Победитель: {room.players[0]?.name ?? 'игрок'}</span>
      </div>
      <div className="podium" data-count={podium.length}>
        <div className="fireworks" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => (
            <span key={index} style={{ '--x': `${8 + ((index * 37) % 84)}%`, '--delay': `${(index % 6) * 160}ms` } as React.CSSProperties} />
          ))}
        </div>
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
            <small>
              {hasRevealedAnswer(player) && player.lastAnswer.points ? formatSignedPoints(player.lastAnswer.points) : '0'}
              {hasRevealedAnswer(player) && player.lastAnswer.scoreNote && <span className="score-note">({player.lastAnswer.scoreNote})</span>}
            </small>
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
        {!isHost && onResetToLobby && (
          <button className="primary" onClick={onResetToLobby}>
            <RotateCcw size={18} />
            В лобби
          </button>
        )}
      </div>
    </div>
  );
}

function AchievementShelf({
  achievements,
  title = 'Ачивки',
  compact = false,
  compactMode = 'title'
}: {
  achievements: Achievement[];
  title?: string;
  compact?: boolean;
  compactMode?: 'title' | 'description';
}) {
  if (achievements.length === 0) {
    return null;
  }

  return (
    <section className={['achievement-shelf', compact ? 'compact' : '', compact ? `${compactMode}-compact` : ''].filter(Boolean).join(' ')} aria-label={title}>
      <div className="achievement-title">
        <Trophy size={16} />
        <span>{title}</span>
      </div>
      <div className="achievement-list">
        {achievements.map((achievement) => (
          <article className={['achievement-card', achievement.tone, achievement.chainStep && achievement.chainStep > 1 ? 'chained' : ''].filter(Boolean).join(' ')} key={achievement.id}>
            <AchievementIcon achievement={achievement} />
            <div>
              {compact && compactMode === 'description' ? (
                <strong className="compact-description">{compactAchievementDescription(achievement)}</strong>
              ) : compact ? (
                <>
                  <strong>{achievement.title}</strong>
                  {achievement.recipient && <small className="achievement-recipient">{achievement.recipient}</small>}
                </>
              ) : (
                <>
                  <strong>{achievement.title}</strong>
                  <small className="achievement-description">{achievement.description}</small>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function compactAchievementDescription(achievement: Achievement): string {
  const genericRecipients = new Set(['Все игроки', 'Большинство', 'Комната', 'Никто']);
  if (!achievement.recipient || genericRecipients.has(achievement.recipient)) {
    return achievement.description;
  }
  const recipientPattern = new RegExp(`^${escapeRegExp(achievement.recipient)}\\s*[:—-]?\\s*`, 'i');
  return `${achievement.recipient}: ${achievement.description.replace(recipientPattern, '')}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
              <small>{moment.description}</small>
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function useQuestionCountdown(
  question: NonNullable<Room['currentQuestion']>,
  serverTime: number,
  durationOverrideMs?: number,
  endsAtOverride?: number
) {
  const [now, setNow] = useState(() => Date.now());
  const serverOffsetRef = useRef(0);

  useEffect(() => {
    serverOffsetRef.current = serverTime - Date.now();
    setNow(Date.now());

    let frameId = 0;

    const tick = () => {
      setNow(Date.now());
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
  }, [question.id, serverTime]);

  const adjustedNow = now + serverOffsetRef.current;
  const isPendingStart = adjustedNow < question.startedAt;
  const durationMs = Math.max(1, durationOverrideMs ?? question.durationMs);
  const endsAt = endsAtOverride ?? question.endsAt;
  const activeNow = Math.max(adjustedNow, question.startedAt);
  const remaining = Math.max(0, endsAt - activeNow);
  const progress = clamp(remaining / durationMs, 0, 1);

  return {
    secondsLeft: Math.ceil(remaining / 1000),
    progress,
    isPendingStart
  };
}

function useScheduledQuestionAudio({
  question,
  serverTime,
  volume,
  audioRef,
  onStarted,
  onBlocked
}: {
  question: NonNullable<Room['currentQuestion']>;
  serverTime: number;
  volume: number;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  onStarted?: () => void;
  onBlocked: () => void;
}) {
  const audioSessionKey = getQuestionAudioSessionKey(question);

  function playAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    if (volume <= 0) {
      audio.pause();
      onStarted?.();
      return;
    }
    void audio.play().then(() => onStarted?.()).catch(onBlocked);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      resetQuestionAudioElement(audio);
    }

    const delayMs = Math.max(0, question.startedAt - serverTime);
    const timeout = window.setTimeout(playAudio, delayMs);
    return () => window.clearTimeout(timeout);
  }, [audioSessionKey]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    if (volume <= 0) {
      audio.pause();
    }
  }, [volume]);

  return playAudio;
}

function isAudioDiagnosticsEnabled(): boolean {
  return new URLSearchParams(window.location.search).get('audioDebug') === '1' || window.localStorage.getItem('audioDebug') === '1';
}

function useAutoNextCountdown(status: Room['status'], round: number, enabled = true): number {
  const [secondsLeft, setSecondsLeft] = useState(10);

  useEffect(() => {
    if (status !== 'round-result' || !enabled) {
      setSecondsLeft(0);
      return undefined;
    }

    const startedAt = Date.now();
    setSecondsLeft(10);
    const interval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSecondsLeft(Math.max(0, 10 - elapsed));
    }, 250);

    return () => window.clearInterval(interval);
  }, [status, round, enabled]);

  return secondsLeft;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Starfield />
    <App />
  </React.StrictMode>
);
