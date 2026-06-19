export type RankingComebackEffectKind = 'jammer-incoming' | 'jammer-sent' | 'jammed' | 'countered' | 'timecut';

export function getRankingComebackEffect({
  playerId,
  automaticJammerQueued = false,
  automaticJammerTargetPlayerId,
  comebackStatus,
  timecutActive = false
}: {
  playerId: string;
  automaticJammerQueued?: boolean;
  automaticJammerTargetPlayerId?: string;
  comebackStatus?: 'armed' | 'jammed' | 'countered' | 'missed';
  timecutActive?: boolean;
}): { kind: RankingComebackEffectKind; label: string } | undefined {
  if (automaticJammerQueued && automaticJammerTargetPlayerId) {
    return playerId === automaticJammerTargetPlayerId
      ? { kind: 'jammer-incoming', label: 'Глушилка летит' }
      : { kind: 'jammer-sent', label: 'Сигнал отправлен' };
  }
  if (comebackStatus === 'countered') {
    return { kind: 'countered', label: 'Контрмера сработала' };
  }
  if (comebackStatus === 'jammed' || comebackStatus === 'missed') {
    return { kind: 'jammed', label: '2 ответа скрыты' };
  }
  if (timecutActive) {
    return { kind: 'timecut', label: 'Таймер урезан' };
  }
  return undefined;
}
