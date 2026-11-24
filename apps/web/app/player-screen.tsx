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
        {view.answer && <div className="player-screen__answer"><span>ПРАВИЛЬНЫЙ ОТВЕТ</span><strong>{view.answer}</strong></div>}
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
        <AuctionBidForm key={state.currentBid?.commandId ?? 'first'}
          bid={state.currentBid} players={state.players} category={state.song.category ?? 'Разное'}
          nominal={state.song.points} balance={state.players.find(p => p.id === playerId)?.score ?? 0}
          disabled={!connected || busy} onBid={onBid} />
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
