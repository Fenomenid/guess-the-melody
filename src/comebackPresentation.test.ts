import { describe, expect, it } from 'vitest';
import { getRankingComebackEffect } from './comebackPresentation';

describe('getRankingComebackEffect', () => {
  it('shows an incoming Jammer on the targeted leader and a sent signal on chasers', () => {
    const shared = {
      automaticJammerQueued: true,
      automaticJammerTargetPlayerId: 'leader'
    };

    expect(getRankingComebackEffect({ ...shared, playerId: 'leader' })).toEqual({
      kind: 'jammer-incoming',
      label: 'Глушилка летит'
    });
    expect(getRankingComebackEffect({ ...shared, playerId: 'chaser' })).toEqual({
      kind: 'jammer-sent',
      label: 'Сигнал отправлен'
    });
  });

  it('shows applied Jammer, successful Countermeasure, and Timecut effects', () => {
    expect(getRankingComebackEffect({ playerId: 'leader', comebackStatus: 'jammed' })).toEqual({
      kind: 'jammed',
      label: '2 ответа скрыты'
    });
    expect(getRankingComebackEffect({ playerId: 'leader', comebackStatus: 'countered' })).toEqual({
      kind: 'countered',
      label: 'Контрмера сработала'
    });
    expect(getRankingComebackEffect({ playerId: 'leader', timecutActive: true })).toEqual({
      kind: 'timecut',
      label: 'Таймер урезан'
    });
  });
});
