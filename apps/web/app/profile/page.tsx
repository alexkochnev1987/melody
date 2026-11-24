'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type GameHistory = {
  room: string;
  name: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  score: number;
  place: number;
  participants: number;
  correctAnswers: number;
  bids: number;
  earned: number;
  lost: number;
  roundsPlayed: number;
  totalRounds: number;
};

type Profile = {
  gamesPlayed: number;
  completedGames: number;
  wins: number;
  correctAnswers: number;
  bidsPlaced: number;
  pointsEarned: number;
  pointsLost: number;
  bestScore: number | null;
  history: GameHistory[];
  truncated: boolean;
};

export default function GuestProfile() {
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        // Link the saved room from an earlier app version before requesting
        // history. Nothing is sent to analytics or an external provider.
        try {
          const saved = JSON.parse(localStorage.getItem('melody-session') || 'null') as {
            room?: string; token?: string; role?: string;
          } | null;
          if (saved?.role === 'player' && saved.room && saved.token) {
            await fetch('/api/profile', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ room: saved.room, playerToken: saved.token }),
            });
          }
        } catch { /* Old session unavailable: new linked rooms still work. */ }

        const result = await fetch('/api/profile', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const response: Profile & { error?: string } = await result.json();
        if (!result.ok) throw new Error(response.error ?? 'Не удалось загрузить историю');
        if (active) { setData(response); setError(''); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить статистику');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const stats = data ? [
    { label: 'Сыграно игр', value: data.gamesPlayed },
    { label: 'Завершено', value: data.completedGames },
    { label: 'Побед в играх', value: data.wins },
    { label: 'Угадано песен', value: data.correctAnswers },
    { label: 'Сделано ставок', value: data.bidsPlaced },
    { label: 'Заработано очков', value: data.pointsEarned },
    { label: 'Потеряно очков', value: data.pointsLost },
    { label: 'Лучший результат', value: data.bestScore ?? '—' },
  ] : [];

  return <main className="shell profile-page">
    <header>
      <div className="brand"><span className="brand-icon">♫</span> melody<span className="brand-dot">.</span></div>
      <Link className="display-link" href="/">← В игру</Link>
    </header>
    <section className="panel profile-intro">
      <span className="eyebrow">ЛИЧНАЯ ИСТОРИЯ</span>
      <h1>Моя статистика</h1>
      <p>Результаты из всех комнат, в которые ты заходил с этого браузера.</p>
      <p className="muted">Профиль привязан к защищённому cookie на этом устройстве. Если очистить данные сайта или сменить браузер, доступ к прежней статистике без привязки аккаунта восстановить пока нельзя.</p>
    </section>
    {loading && <section className="panel" role="status">Загружаем историю игр…</section>}
    {error && <section className="notice" role="alert">{error}</section>}
    {data && <>
      <section className="profile-stats" aria-label="Общая статистика">
        {stats.map(stat => <div className="profile-stat" key={stat.label}>
          <span>{stat.label}</span><strong>{stat.value}</strong>
        </div>)}
      </section>
      {data.truncated && <p role="status" className="muted">
        Показаны последние 1000 комнат; сводка рассчитана по отображаемой истории.
      </p>}
      <section className="panel profile-history">
        <h2>Мои игры и результаты</h2>
        {data.history.length === 0 && <p className="muted">
          Пока нет связанных игр. Присоединяйся к комнате — результаты появятся здесь автоматически.
        </p>}
        <div className="profile-history__items">
          {data.history.map(game => <article className="profile-history__game" key={game.room}>
            <div className="profile-history__top">
              <strong>{game.name} · Комната {game.room}</strong>
              <span>{game.status === 'finished' ? 'Завершена' : 'В процессе'}</span>
            </div>
            <div className="profile-history__score">
              <strong>{game.score} очков</strong>
              <span>{game.place}-е место из {game.participants}</span>
            </div>
            <p>Угадано: {game.correctAnswers} · Ставок: {game.bids} · Раунды: {game.roundsPlayed}/{game.totalRounds}</p>
            <p className="muted">Заработано: +{game.earned} · Потеряно: −{game.lost}</p>
            <small>{game.endedAt ? new Date(game.endedAt).toLocaleString('ru-RU') :
              game.startedAt ? new Date(game.startedAt).toLocaleString('ru-RU') :
              'Ожидаем начала игры'}</small>
          </article>)}
        </div>
      </section>
    </>}
  </main>;
}
