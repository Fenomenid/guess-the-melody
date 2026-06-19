type RoomStatus = 'lobby' | 'preparing' | 'question' | 'round-result' | 'finished';

export function canHostKickPlayer({
  isHost,
  currentPlayerId,
  targetPlayerId,
  roomStatus
}: {
  isHost: boolean;
  currentPlayerId: string;
  targetPlayerId: string;
  roomStatus: RoomStatus;
}): boolean {
  return isHost && currentPlayerId !== targetPlayerId && roomStatus !== 'finished';
}
