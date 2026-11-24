'use client';

import { useState } from 'react';
import type { Bid, Player } from '@/lib/game';

type Shared = {
  bid?: Bid | null;
  players: Player[];
  category: string;
  nominal: number;
  introHint?: string | null;
};

/** Same read-only auction snapshot is shown on player, host and TV. */
export function AuctionSummary({ bid, players, category, nominal, introHint }: Shared) {
  const leader = bid ? players.find(player => player.id === bid.playerId) : null;
  return <section className="auction-summary" aria-live="polite">
    <div className="auction-summary__heading">
      <span>♫ {category}</span><span>Номинал: {nominal} очков</span>
    </div>
    {introHint && <blockquote className="auction-summary__hint"><span>ШУТОЧНАЯ ПОДСКАЗКА</span>{introHint}</blockquote>}
    {bid ? <div className="auction-summary__leader">
      <div className="auction-summary__label">ЛИДИРУЮЩАЯ СТАВКА</div>
      <strong>{leader?.name ?? 'Игрок'}</strong>
      <div className="auction-summary__values">
        <div><b>{bid.points}</b><span>очков</span></div>
        <span className="auction-summary__divider">/</span>
        <div><b>{bid.seconds}</b><span>секунд</span></div>
      </div>
    </div> : <div className="auction-summary__empty">Ставок пока нет — стань первым!</div>}
  </section>;
}

type FormProps = Shared & {
  disabled: boolean;
  onBid: (points: number, seconds: number) => void;
};

export function AuctionBidForm({ bid, nominal, disabled, onBid }: FormProps) {
  const [points, setPoints] = useState(bid?.points ?? nominal);
  const [seconds, setSeconds] = useState(bid?.seconds ?? 10);
  const good = Number.isSafeInteger(points) && points >= nominal && points <= 100000 &&
    Number.isSafeInteger(seconds) && seconds >= 2 &&
    (!bid || (points >= bid.points && seconds <= bid.seconds &&
      (points > bid.points || seconds < bid.seconds)));
  const reason = !Number.isSafeInteger(points) || points < nominal || points > 100000
    ? `Не меньше ${nominal} и не больше 100 000 очков`
    : !Number.isSafeInteger(seconds) || seconds < 2
      ? 'Минимум 2 секунды, только целое число'
      : !good ? 'Увеличь очки или уменьши время, не ухудшая другой показатель' : '';

  return <section className="auction-bid-form" aria-label="Сделать ставку">
    <div className="auction-bid-form__fields">
      <label>Очки
        <input type="number" inputMode="numeric" min={nominal} max={100000} step="1"
          value={points} onChange={e => setPoints(Number(e.target.value))} aria-label="Очки ставки" />
      </label>
      <label>Секунды
        <input type="number" inputMode="numeric" min="2" step="1"
          value={seconds} onChange={e => setSeconds(Number(e.target.value))} aria-label="Время ставки в секундах" />
      </label>
    </div>
    <div className="auction-bid-form__quick">
      <button type="button" className="secondary" disabled={disabled || points > 99990}
        onClick={() => setPoints(Math.min(100000, Math.max(points, bid?.points ?? nominal) + 10))}>+10 очков</button>
      <button type="button" className="secondary" disabled={disabled || seconds <= 2}
        onClick={() => setSeconds(Math.max(2, Math.min(seconds, bid?.seconds ?? seconds) - 1))}>−1 секунда</button>
    </div>
    {reason && <p className="auction-bid-form__error" role="status">{reason}</p>}
    <button type="button" disabled={disabled || !good} onClick={() => onBid(points,seconds)}>
      {bid ? 'Перебить ставку' : 'Сделать ставку'}
    </button>
  </section>;
}
