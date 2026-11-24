'use client';

import { getPlayerView, type PlayerSnapshot } from '@/lib/player-view';
import SongBoard from './song-board';
import { AuctionBidForm, AuctionSummary } from './auction-panel';

type Props = {
  state: PlayerSnapshot;
  playerId: string;
  room: string;
  connected: boolean;
  busy: boolean;
  onBuzz: () => void;
  onChoose: (songId: string) => void;
  onBid: (points: number, seconds: number) => void;
};

export default function PlayerScreen({ state, playerId, room, connected, busy, onBuzz, onChoose, onBid }: Props) {
  const view = getPlayerView(state, playerId, connected, busy);
  const choosing = state.status === 'revealed' && state.chooserId === playerId;
  const bidding = state.auctionEnabled === true && state.status === 'bidding';
  const preparing = state.auctionEnabled === true && state.status === 'selected';
  const ownBid = bidding && state.currentBid?.playerId === playerId;
  const latestOwnBid = bidding ? [...(state.bidHistory ?? [])].reverse().find(bid => bid.playerId === playerId) : undefined;
  const secondChance = state.auctionEnabled && ['openAnswer','secondBuzzed'].includes(state.status);
  const onStop = () => {
    if (!view.canBuzz) return;
    if (typeof navigator.vibrate === 'function') navigator.vibrate(25);
    onBuzz();
  };

  return (
    <section className={`player-screen${bidding || preparing ? ' player-screen--auction' : ''}`} aria-label="Экран игрока">
      <div className="player-screen__meta">
        <span className="eyebrow">КОМНАТА {room}</span>
        <span className={connected ? 'connection' : 'connection offline'}>
          {connected ? '● На связи' : '● Нет связи'}
        </span>
      </div>

      <div className="player-screen__identity">
        <span className="player-screen__eyebrow">ИГРОК</span>
        <strong title={view.name}>{view.name}</strong>
      </div>

      <div className="player-screen__stats" aria-label="Личный счёт и место в рейтинге">
        <div className="player-screen__stat">
          <span>Твои очки</span>
          <strong>{view.score}</strong>
        </div>
        <div className="player-screen__stat">
          <span>Место в игре</span>
          <strong>{view.rank || '—'}<small> / {view.playersCount}</small></strong>
        </div>
      </div>

      <div className="player-screen__center" aria-live="polite" aria-atomic="true">
        <span className="player-screen__round">РАУНД {state.round} ИЗ {state.totalRounds} · {state.song.availablePoints ?? state.song.points} ОЧКОВ</span>
        <h1>{view.title}</h1>
        <p>{view.description}</p>
        {state.auctionEnabled && (state.status === 'playing' || state.status === 'buzzed') && state.currentBid &&
          <div className="player-screen__active-bid">
            <strong>{state.players.find(p => p.id === state.currentBid?.playerId)?.name ?? 'Игрок'} · {state.currentBid.points} очков / {state.currentBid.seconds} с</strong>
            {state.status === 'playing' && <span>Осталось ~{Math.max(0, Math.ceil(state.remainingSeconds ?? state.currentBid.seconds))} с</span>}
          </div>}
        {view.answer && <div className="player-screen__answer"><span>ПРАВИЛЬНЫЙ ОТВЕТ</span><strong>{view.answer}</strong></div>}
        {secondChance && <div className="player-screen__active-bid" role="status">
          <strong>Второй шанс · +{state.song.points} очков</strong>
          <span>Фрагмент уже закончился. Музыка больше не запускается.</span>
        </div>}
        {(bidding || preparing) && <div className="player-screen__auction">
          <AuctionSummary bid={state.currentBid} players={state.players}
            category={state.song.category ?? 'Разное'} nominal={state.song.points} introHint={state.introHint} />
        </div>}
        {state.revealedHints && state.revealedHints.length > 0 && !choosing &&
          <div className="player-screen__hints">
            {state.revealedHints.map((hint, i) => <p key={i}>💡 {hint}</p>)}
          </div>
        }
        {choosing && <div className="player-screen__picker">
          <SongBoard songs={state.board ?? []} disabled={busy || !connected} onChoose={onChoose} />
        </div>}
      </div>

      {bidding && <div className="player-screen__bid-action">
        {ownBid ? <div className="player-screen__bid-confirmation" role="status">
          <strong>✓ Твоя ставка принята</strong>
          <span>{state.currentBid?.points} очков · {state.currentBid?.seconds} секунд</span>
          <small>Ты лидируешь. Повышать собственную ставку нельзя — жди других игроков.</small>
        </div> : <>
          {latestOwnBid && <div className="player-screen__bid-previous" role="status">
            Твою ставку {latestOwnBid.points} очков / {latestOwnBid.seconds} сек перебили.
          </div>}
          <AuctionBidForm key={state.currentBid?.commandId ?? 'first'}
            bid={state.currentBid} players={state.players} category={state.song.category ?? 'Разное'}
            nominal={state.song.points} balance={state.players.find(p => p.id === playerId)?.score ?? 0}
            disabled={!connected || busy} onBid={onBid} />
        </>}
      </div>}

      {!choosing && !bidding && !preparing && <div className="player-screen__action">
        <button
          type="button"
          className={`player-screen__stop${view.canBuzz ? ' player-screen__stop--active' : ''}`}
          disabled={!view.canBuzz}
          aria-label={view.canBuzz ? 'Я знаю ответ. Нажать STOP' : view.buttonLabel}
          onClick={onStop}
        >
          <strong>{view.buttonLabel}</strong>
          <span>{view.buttonHint}</span>
        </button>
      </div>}
    </section>
  );
}
