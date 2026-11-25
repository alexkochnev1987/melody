'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import HostPlayer, { type HostPlayerHandle } from './host-player';
import PlayerScreen from './player-screen';
import SongBoard from './song-board';
import { AuctionSummary } from './auction-panel';
import RoundResult from './round-result';

type Player = { id: string; name: string; score: number };
type Song = { id: string; title?: string; artist?: string; youtubeId?: string; points: number; availablePoints?: number; startSeconds?: number; category?: string; hints?: string[] };
type State = { id: string; revision: number; status: string; auctionEnabled?: boolean; currentBid?: { playerId: string; points: number; seconds: number; commandId: string } | null; bidHistory?: { playerId: string; points: number; seconds: number; commandId: string }[]; introHint?: string | null; roundResult?: { playerId: string; points: number } | null; choiceOpen?: boolean; remainingSeconds?: number | null; playbackActive?: boolean; round: number; totalRounds: number; players: Player[]; winnerId: string | null; chooserId?: string | null; blockedPlayerIds: string[]; board?: { id: string; category: string; points: number; played: boolean; selected: boolean }[]; hintLevel?: number; revealedHints?: string[]; song: Song; hostSong?: Song };
type DraftSong = { title: string; artist: string; youtubeId: string; points: number; category: string; hints: string[]; introHint?: string; candidateId?: string; videoTitle?: string; channel?: string; verification?: 'verified' | 'unavailable' | 'missing' };
type Session = { room: string; token: string; playerId?: string; role: 'host' | 'player' | 'display'; recoveryCode?: string };
type RecoverablePlayer = { room: string; token: string; playerId: string; name: string; score: number; restored: true };

async function api(body: unknown, token?: string) {
  const res = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}
const emptySong = (): DraftSong => ({ title: '', artist: '', youtubeId: '', points: 10, category: 'Разное', hints: [], introHint: '' });
function commandId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [room, setRoom] = useState('');
  const [name, setName] = useState('');
  const [songs, setSongs] = useState<DraftSong[]>([emptySong()]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiCount, setAiCount] = useState(10);
  const [startingPoints, setStartingPoints] = useState(300);
  const [previewId, setPreviewId] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(true);
  const [recoverable, setRecoverable] = useState<RecoverablePlayer | null>(null);
  const [checkingRecovery, setCheckingRecovery] = useState(false);
  const [manualRecoveryCode, setManualRecoveryCode] = useState('');
  const [redeemingRecovery, setRedeemingRecovery] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [awardTo, setAwardTo] = useState('');
  const [adjustment, setAdjustment] = useState(0);
  const [inviteOrigin, setInviteOrigin] = useState('');
  const player = useRef<HostPlayerHandle>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerIsPlaying, setPlayerIsPlaying] = useState(false);
  const currentPlayback = useRef(false);
  const handlePlaybackChange = useCallback((playing: boolean) => {
    currentPlayback.current = playing;
    setPlayerIsPlaying(playing);
  }, []);
  const playbackSync = useRef<Promise<void>>(Promise.resolve());
  const latestRoom = useRef<State | null>(null);
  const [playerMessage, setPlayerMessage] = useState('');
  const lastStatus = useRef('');
  const playbackBlocked = useCallback(() => setPlayerMessage('Браузер заблокировал воспроизведение. Нажмите кнопку Play внутри YouTube-плеера.'), []);
  const playbackError = useCallback(() => setPlayerMessage('Видео не удалось загрузить. Проверьте его доступность в YouTube.'), []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room')?.toUpperCase();
    if (code) setRoom(code);
    if (code && params.get('display') === '1') setSession({ room: code, role: 'display', token: '' });
    else {
      try {
        const saved = JSON.parse(localStorage.getItem('melody-session') || 'null') as Session | null;
        if (saved && (!code || saved.room === code)) setSession(saved);
      } catch { localStorage.removeItem('melody-session'); }
    }
  }, []);
  const enter = (value: Session) => { localStorage.setItem('melody-session', JSON.stringify(value)); setSession(value); window.history.replaceState(null, '', `/?room=${value.room}`); };
  // The regular saved session is restored automatically. If only the HttpOnly
  // guest identity survives, offer a one-tap return to the same participant.
  // We never create another player or reset their score during this lookup.
  useEffect(() => {
    if (session || !/^[A-Z0-9]{6}$/.test(room)) return;
    let active = true;
    void api({ action: 'recover', room }).then(data => {
      if (!active) return;
      const restored = data as RecoverablePlayer;
      if (restored.restored && restored.room === room) setRecoverable(restored);
    }).catch(() => {
      if (active) setRecoverable(null);
    }).finally(() => {
      if (active) setCheckingRecovery(false);
    });
    queueMicrotask(() => { if (active) setCheckingRecovery(true); });
    return () => { active = false; };
  }, [room, session]);

  const refresh = useCallback(async () => {
    if (!session) return;
    const res = await fetch(`/api/game?room=${encodeURIComponent(session.room)}`, { cache: 'no-store', headers: session.token ? { Authorization: `Bearer ${session.token}` } : {} });
    if (!res.ok) throw new Error('Не удалось получить состояние');
    const snapshot = await res.json() as State;
    latestRoom.current = snapshot;
    setState(snapshot); setConnected(true);
  }, [session]);
  useEffect(() => {
    if (session?.role !== 'host') return;
    let active = true;
    const origin = window.location.origin;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
      queueMicrotask(() => { if (active) setInviteOrigin(origin); });
    } else {
      fetch('/api/local-address').then(res => res.json()).then(data => { if (active) setInviteOrigin(data.origin || ''); }).catch(() => { if (active) setInviteOrigin(''); });
    }
    return () => { active = false; };
  }, [session?.role]);
  useEffect(() => {
    if (!session) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { await refresh(); } catch { if (active) setConnected(false); } finally { if (active) timer = setTimeout(poll, session.role === 'player' ? 500 : 300); } };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [session, refresh]);
  // Only host-reported YouTube PLAYING may arm STOP. Reports are serialized and
  // always use the latest player state, avoiding late requests after Play/Pause.
  const syncPlayback = useCallback((force = false) => {
    if (session?.role !== 'host') return;
    playbackSync.current = playbackSync.current.catch(() => {}).then(async () => {
      const latest = latestRoom.current;
      if (!latest || !['playing', 'openAnswer'].includes(latest.status)) return;
      const active = currentPlayback.current;
      if (!force && latest.playbackActive === active) return;
      await api({ action: 'command', room: session.room,
        command: { type: 'playback', id: commandId(), songId: latest.song.id, active } }, session.token);
      await refresh();
    }).catch(err => {
      setPlayerMessage(err instanceof Error ? err.message : 'Не удалось синхронизировать воспроизведение');
    });
  }, [session, refresh]);
  useEffect(() => {
    if (session?.role !== 'host' || !state || !['playing', 'openAnswer'].includes(state.status) ||
      state.playbackActive === playerIsPlaying) return;
    syncPlayback();
  }, [session?.role, state?.id, state?.song.id, state?.status, state?.playbackActive, playerIsPlaying, syncPlayback]);
  // If the host goes offline, the lease expires and STOP is rejected server-side.
  useEffect(() => {
    if (session?.role !== 'host' || !['playing', 'openAnswer'].includes(state?.status ?? '') || !playerIsPlaying) return;
    const timer = window.setInterval(() => {
      if (currentPlayback.current) syncPlayback(true);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [session?.role, state?.status, playerIsPlaying, syncPlayback]);
  useEffect(() => {
    if (session?.role === 'host' && (state?.status === 'buzzed' || state?.status === 'awaitingJudgment' ||
      state?.status === 'secondBuzzed' || state?.status === 'revealed' || state?.status === 'finished') && lastStatus.current !== state?.status) {
      player.current?.pause();
    }
    lastStatus.current = state?.status ?? '';
  }, [state?.status, session?.role]);
  async function command(command: Record<string, unknown>, pauseOnFailure = false) {
    if (!session) return;
    setBusy(true); setError('');
    try { await api({ action: 'command', room: session.room, command: { ...command, id: commandId() } }, session.token); await refresh(); }
    catch (err) { if (pauseOnFailure) player.current?.pause(); setError(err instanceof Error ? err.message : 'Ошибка'); }
    finally { setBusy(false); }
  }
  function playMusic() {
    setPlayerMessage('');
    if (!player.current?.play()) setPlayerMessage('Плеер ещё загружается. Попробуйте через несколько секунд.');
  }
  function replayMusic() {
    setPlayerMessage('');
    if (!player.current?.replay()) setPlayerMessage('Не удалось повторить мелодию. Проверьте плеер.');
  }
  function startWithMusic(type: 'start' | 'resume') {
    setPlayerMessage('');
    if (!player.current?.play()) { setPlayerMessage('Плеер ещё загружается. Попробуйте через несколько секунд.'); return; }
    void command({ type }, true);
  }
  const onClipExpired = useCallback(() => {
    const active = latestRoom.current;
    if (!session || session.role !== 'host' || active?.status !== 'playing' ||
      !active.auctionEnabled || !active.currentBid) return;
    player.current?.pause();
    void api({ action: 'command', room: session.room,
      command: { type: 'expire', id: commandId(), songId: active.song.id } }, session.token)
      .then(refresh).catch(err => setError(err instanceof Error ? err.message : 'Не удалось завершить фрагмент'));
  }, [session, refresh]);

  async function create() {
    setBusy(true); setError('');
    try { const result = await api({ action: 'create', songs, startingPoints }); enter({ ...result, role: 'host' }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Ошибка'); }
    finally { setBusy(false); }
  }
  async function join() {
    setBusy(true); setError('');
    try { const result = await api({ action: 'join', room: room.trim().toUpperCase(), name }); enter({ ...result, role: 'player' }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Ошибка'); }
    finally { setBusy(false); }
  }
  async function redeemRecoveryCode() {
    if (!/^[A-Z0-9]{6}$/.test(room) || manualRecoveryCode.replace(/[\s-]/g, '').length !== 12) {
      setError('Введи код комнаты и личный код восстановления из 12 символов.');
      return;
    }
    setRedeemingRecovery(true);
    setError('');
    try {
      const result = await api({
        action: 'redeemRecovery', room: room.trim().toUpperCase(), code: manualRecoveryCode,
      }) as { room: string; playerId: string; token: string; recoveryCode: string };
      enter({
        room: result.room, playerId: result.playerId, token: result.token,
        role: 'player', recoveryCode: result.recoveryCode,
      });
      setManualRecoveryCode('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось восстановить доступ');
    } finally {
      setRedeemingRecovery(false);
    }
  }

  async function renewRecoveryCode() {
    if (!session || session.role !== 'player') return;
    setRecoveryBusy(true);
    setError('');
    try {
      const response = await api({
        action: 'issueRecovery', room: session.room,
      }, session.token) as { recoveryCode: string };
      const updated: Session = { ...session, recoveryCode: response.recoveryCode };
      localStorage.setItem('melody-session', JSON.stringify(updated));
      setSession(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать код возврата');
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function generate() {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: aiPrompt, count: aiCount }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка генерации');
      setSongs((data.songs as { title: string; artist: string; youtubeId: string; category?: string; hints?: string[]; videoTitle: string; channel: string; verification: 'verified' | 'unavailable' | 'missing' }[]).map(song => ({ ...song, candidateId: song.youtubeId, youtubeId: '', points: 10, category: song.category || 'Разное', hints: song.hints ?? [] })));
    } catch (err) { setError(err instanceof Error ? err.message : 'Ошибка'); }
    finally { setBusy(false); }
  }
  async function generateHints() {
    const candidates = songs.map(({ title, artist, category }) => ({ title, artist, category }));
    if (candidates.length > 30 || candidates.some(s => !s.title.trim() || !s.artist.trim() || !s.category.trim())) {
      setError('Для AI-подсказок заполни названия, артистов и категории (до 30 песен за раз).');
      return;
    }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/hints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songs: candidates }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось создать подсказки');
      const hints = new Map<number, string[]>(data.songs.map((s: { index: number; hints: string[] }) => [s.index, s.hints]));
      setSongs(current => current.map((s, i) => { const generated = hints.get(i); return generated?.length ? { ...s, hints: generated, introHint: s.introHint || generated[0] } : s; }));
      if (data.songs.some((s: { warning?: string }) => s.warning)) setError('Некоторые подсказки не прошли проверку. Их можно перегенерировать или ввести вручную.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Ошибка подсказок'); }
    finally { setBusy(false); }
  }
  const stop = () => {
    localStorage.removeItem('melody-session');
    setSession(null);
    setState(null);
    setRecoverable(null);
    setConnected(true);
    setError('');
    window.history.replaceState(null, '', '/');
  };
  const winner = state?.players.find(p => p.id === state.winnerId);
  const bidLeader = state?.players.find(p => p.id === state.currentBid?.playerId);
  const share = inviteOrigin && session ? `${inviteOrigin}/?room=${encodeURIComponent(session.room)}` : '';
  const invalidAiCount = !Number.isInteger(aiCount) || aiCount < 1 || aiCount > 30;
  return <main className={`shell${session?.role === 'player' ? ' player-shell' : ''}`}>
    <header><div className="brand"><span className="brand-icon">♫</span> melody<span className="brand-dot">.</span></div><span className="tag">ИГРА ДЛЯ СВОИХ</span><a className="display-link admin-link" href="/admin">Мои игры</a><a className="display-link profile-link" href="/profile">Моя статистика</a>{session && <button className="text-button" onClick={stop}>Выйти</button>}</header>
    {error && <div className="notice" role="alert">{error}</div>}
    {session && !connected && <div className="reconnection-notice" role="status">
      <div>
        <strong>Соединение потеряно</strong>
        <p>Твоё место и очки сохраняются в комнате. Мы пробуем восстановить связь автоматически.</p>
      </div>
      <button className="secondary" onClick={() => void refresh().catch(() => setError('Нет связи с комнатой. Проверь интернет и попробуй ещё раз.'))}>Подключиться снова</button>
    </div>}
    {!session ? <div className="home-grid"><section className="intro"><div className="eyebrow">МУЗЫКА · ДРУЗЬЯ · АЗАРТ</div><h1>Узнал мелодию?<br/><em>Жми первым.</em></h1><p>Соберите свою компанию, включите любимые песни и проверьте, кто узнает хит с первых нот.</p><div className="vinyl" aria-hidden="true"><div>♫</div></div></section>
      <div className="stack"><section className="panel"><span className="eyebrow">ДЛЯ ИГРОКОВ</span><h2>Присоединиться</h2>
          {recoverable?.room === room && <div className="restore-room-card" role="status">
            <span className="restore-room-card__label">ТВОЁ МЕСТО СОХРАНЕНО</span>
            <strong>С возвращением, {recoverable.name}!</strong>
            <p>Комната {recoverable.room} · {recoverable.score} очков</p>
            <button onClick={() => enter({
              room: recoverable.room, token: recoverable.token,
              playerId: recoverable.playerId, role: 'player',
            })}>Вернуться в игру</button>
          </div>}
          {checkingRecovery && room.length === 6 && !recoverable && <p className="muted restore-room-checking" role="status">
            Проверяем, осталось ли твоё место в комнате…
          </p>}
          <label>Код комнаты<input value={room} onChange={e => setRoom(e.target.value.toUpperCase())} maxLength={6} placeholder="Например, A1B2C3" /></label><label>Твоё имя<input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Как тебя зовут?" /></label><button disabled={busy || checkingRecovery || Boolean(recoverable?.room === room)} onClick={join}>
          Войти как новый игрок
        </button>
        {recoverable?.room === room && <p className="hint">Ты уже участник этой комнаты. Вернись, чтобы сохранить свой счёт и ставки.</p>}
        <details className="room-recover-by-code">
          <summary>Есть личный код восстановления?</summary>
          <p className="muted">Если приватная вкладка закрылась или ты сменил телефон, введи код, который сохранил во время игры.</p>
          <label>Личный код восстановления
            <input autoComplete="off" autoCapitalize="characters" spellCheck={false}
              maxLength={18} placeholder="XXXX-XXXX-XXXX"
              value={manualRecoveryCode}
              onChange={event => setManualRecoveryCode(event.target.value.toUpperCase())} />
          </label>
          <button className="secondary"
            disabled={redeemingRecovery || busy || manualRecoveryCode.replace(/[\s-]/g, '').length !== 12 || !/^[A-Z0-9]{6}$/.test(room)}
            onClick={() => void redeemRecoveryCode()}>
            {redeemingRecovery ? 'Восстанавливаем место…' : 'Вернуться по коду'}
          </button>
        </details>
      </section>
      <section className="panel"><span className="eyebrow">ДЛЯ ВЕДУЩЕГО</span><h2>Создать игру</h2><p className="muted">Добавь песни и назначь баллы за правильный ответ.</p>
      <div className="ai-box"><div className="ai-heading">✦ Подборка с AI</div><p className="muted">Опиши вечеринку — AI найдёт песни и ссылки, а YouTube проверит видео одним запросом.</p><label>Какую музыку подбираем?<textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} maxLength={500} placeholder="Например: танцевальные хиты 2000-х для вечеринки" /></label><label>Количество песен<input type="number" min="1" max="30" value={aiCount || ''} aria-invalid={invalidAiCount} aria-describedby={invalidAiCount ? 'ai-count-error' : undefined} onChange={e => setAiCount(Number(e.target.value))} /></label>{invalidAiCount && <p id="ai-count-error" className="field-error" role="alert">Можно выбрать от 1 до 30 песен.</p>}<button className="secondary" disabled={busy || aiPrompt.trim().length < 5 || invalidAiCount} onClick={generate}>{busy ? 'Ищем и проверяем…' : '✦ Сгенерировать подборку'}</button><p className="hint">Генерация заменит текущий список. Проверь каждую песню и выбери видео перед игрой.</p></div>
      {songs.map((song, index) => <div className="song-form" key={index}><div className="song-head"><strong>Песня {index + 1}</strong>{songs.length > 1 && <button className="text-button" onClick={() => setSongs(songs.filter((_, i) => i !== index))}>Убрать</button>}</div>{(['title', 'artist', 'youtubeId'] as const).map(field => <input aria-label={`${field === 'title' ? 'Название песни' : field === 'artist' ? 'Исполнитель' : 'YouTube ID'} ${index+1}`} key={field} placeholder={{ title: 'Название песни', artist: 'Исполнитель', youtubeId: 'YouTube ID (11 символов)' }[field]} value={song[field]} onChange={e => setSongs(songs.map((s, i) => i === index ? { ...s, [field]: e.target.value } : s))} />)}
      {song.verification === 'verified' && song.candidateId && <div className="video-result"><span className="verified">✓ YouTube: доступно для встраивания</span><strong>{song.videoTitle}</strong><span className="muted">{song.channel}</span><button className="secondary" onClick={() => setPreviewId(previewId === song.candidateId ? '' : song.candidateId || '')}>{previewId === song.candidateId ? 'Закрыть предпросмотр' : 'Посмотреть видео'}</button>{previewId === song.candidateId && <div className="video"><iframe title={`Предпросмотр ${song.videoTitle}`} src={`https://www.youtube.com/embed/${song.candidateId}`} allow="encrypted-media; picture-in-picture" allowFullScreen /></div>}<a className="search-link" target="_blank" rel="noreferrer" href={`https://www.youtube.com/watch?v=${song.candidateId}`}>Открыть на YouTube</a><button className="secondary" onClick={() => setSongs(songs.map((s, i) => i === index ? { ...s, youtubeId: s.candidateId || '' } : s))}>{song.youtubeId === song.candidateId ? '✓ Видео выбрано' : 'Выбрать это видео'}</button><span className="hint">Проверь, что это нужная версия и она воспроизводится в твоём регионе.</span></div>}
      {song.verification === 'missing' && <p className="hint">GPT не нашёл подтверждённое подходящее видео. Найди его вручную.</p>}
      {song.verification === 'unavailable' && <p className="hint">Не удалось проверить видео в YouTube. Попробуй позже или добавь его вручную.</p>}
      {song.title && <a className="search-link" target="_blank" rel="noreferrer" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(song.artist + ' ' + song.title)}`}>Найти видео на YouTube</a>}
      <label>Категория<input maxLength={60} value={song.category} onChange={e => setSongs(songs.map((s,i) => i === index ? { ...s, category: e.target.value } : s))} placeholder="Например, Поп, Рок, 2000-е" /></label>
      <div className="hint-editor"><h3>Предыгровая подсказка</h3>
        <div className="hint-variants">{song.hints.map((variant,n) => <button key={n} type="button"
          className={song.introHint === variant ? 'hint-variant hint-variant--selected' : 'hint-variant'}
          aria-pressed={song.introHint === variant}
          onClick={() => setSongs(current => current.map((s,i) => i === index ? { ...s, introHint: variant } : s))}>
          <span>Вариант {n+1}</span>{variant}
        </button>)}</div>
        <textarea maxLength={220} aria-label={`Предыгровая подсказка к песне ${index+1}`}
          value={song.introHint ?? ''} placeholder="Выбери вариант или напиши свою шутку"
          onChange={e => setSongs(current => current.map((s,i) => i === index ? { ...s, introHint: e.target.value } : s))} />
      </div>
      <label>Баллы<input type="number" min="0" max="100000" value={song.points} onChange={e => setSongs(songs.map((s, i) => i === index ? { ...s, points: Number(e.target.value) } : s))} /></label></div>)}<button className="secondary" onClick={() => setSongs([...songs, emptySong()])}>+ Добавить песню</button><button className="secondary" disabled={busy || songs.length > 30} onClick={generateHints}>✦ Сгенерировать смешные подсказки</button><label>Начальные очки каждому игроку
          <input type="number" min="1" max="100000" step="1" inputMode="numeric"
            value={startingPoints} onChange={e => setStartingPoints(Number(e.target.value))} />
        </label>
        <button disabled={busy || !Number.isSafeInteger(startingPoints) || startingPoints < 1 || startingPoints > 100000}
          onClick={create}>Создать комнату</button></section></div></div>
      : !state ? <div className="panel room-connecting">
          <h2>Подключаемся к комнате {session.room}…</h2>
          <p className="muted">Твой игровой прогресс хранится на сервере. Если соединение прервалось, можно повторить подключение.</p>
          <button className="secondary" onClick={() => void refresh().catch(() => setError('Не удалось подключиться. Проверь интернет или код комнаты.'))}>
            Повторить подключение
          </button>
        </div>
      : session.role === 'player'
        ? <PlayerScreen state={state} playerId={session.playerId ?? ''} room={session.room} connected={connected} busy={busy}
            onBuzz={() => command({ type: 'buzz', songId: state.song.id })}
            onChoose={songId => command({ type: 'choose', songId })}
            onBid={(points,seconds) => command({ type: 'bid', songId: state.song.id, points, seconds })}
            recoveryCode={session.recoveryCode}
            recoveryBusy={recoveryBusy}
            onRefreshRecovery={() => void renewRecoveryCode()} />
        : <div className="game-grid"><section className="panel main-panel"><div className="game-top"><div><span className="eyebrow">КОМНАТА {session.room}</span><h1>{session.role === 'host' ? 'Пульт ведущего' : session.role === 'display' ? 'Играем!' : `Привет, ${state.players.find(p => p.id === session.playerId)?.name ?? 'игрок'}!`}</h1></div><span className={connected ? 'connection' : 'connection offline'}>{connected ? '● На связи' : '● Нет связи'}</span></div><p className="muted">Раунд {state.round} из {state.totalRounds} · {state.song.availablePoints ?? state.song.points} баллов</p>
        {session.role === 'host' && state.hostSong?.youtubeId &&
          (!state.auctionEnabled || ['selected','playing','buzzed','openAnswer','secondBuzzed','revealed','finished'].includes(state.status)) && <><div className="host-song"><strong>{state.hostSong.title}</strong><span>{state.hostSong.artist} · {state.hostSong.points} баллов · начало {state.hostSong.startSeconds ?? 0} сек.</span></div><HostPlayer ref={player} key={`${state.hostSong.id}:${state.auctionEnabled && ['openAnswer','secondBuzzed','revealed','finished'].includes(state.status) ? 'unlimited' : 'limited'}`} videoId={state.hostSong.youtubeId}
          startSeconds={state.auctionEnabled && ['revealed','finished'].includes(state.status)
            ? 0 : (state.hostSong.startSeconds ?? 0)}
          listenSeconds={state.auctionEnabled && !['openAnswer','secondBuzzed','revealed','finished'].includes(state.status)
            ? state.currentBid?.seconds : undefined}
          initialRemainingSeconds={state.auctionEnabled && !['openAnswer','secondBuzzed','revealed','finished'].includes(state.status)
            ? state.remainingSeconds : undefined}
          onExpired={onClipExpired}
          onReady={setPlayerReady} onPlaybackChange={handlePlaybackChange}
          onPlaybackBlocked={playbackBlocked} onError={playbackError} />{playerMessage && <p className="notice" role="alert">{playerMessage}</p>}</>}
        <div className="status">
          {state.status === 'lobby' ? (state.auctionEnabled ? 'Выберите песню для аукциона' : 'Ждём игроков')
            : state.status === 'bidding' ? 'Торги открыты — делайте ставки!'
            : state.status === 'selected' ? 'Торги закрыты — ведущий готовит музыку'
            : state.status === 'playing' ? (state.playbackActive ? 'Играет выбранный фрагмент' : 'Фрагмент на паузе — ведущий может включить музыку')
            : state.status === 'awaitingJudgment' ? 'Фрагмент окончен. Ведущий оценивает ответ победителя торгов'
            : state.status === 'openAnswer' ? 'Второй шанс: другие участники могут остановить мелодию во время повтора'
            : state.status === 'secondBuzzed' ? `${winner?.name ?? 'Игрок'} остановил повтор и отвечает`
            : state.status === 'buzzed' ? `${winner?.name ?? 'Игрок'} нажал первым!`
            : state.status === 'revealed' || state.status === 'finished'
              ? `${state.song.artist} — ${state.song.title}` : 'Игра завершена'}
        </div>
        {['revealed','finished'].includes(state.status) &&
          <RoundResult song={state.song} result={state.roundResult} players={state.players} />}
        {state.auctionEnabled && ['bidding','selected','playing','awaitingJudgment','buzzed','openAnswer','secondBuzzed'].includes(state.status) && <AuctionSummary
          bid={state.currentBid} players={state.players} category={state.song.category ?? 'Разное'}
          nominal={state.song.points} introHint={state.introHint} />}
        {state.auctionEnabled && state.status === 'playing' && <p className="auction-timer">
          Время: {Math.max(0, Math.ceil(state.remainingSeconds ?? state.currentBid?.seconds ?? 0))} с ·
          Отвечает {bidLeader?.name ?? 'участник'}
        </p>}
        {(state.revealedHints?.length ?? 0) > 0 && <div className="host-hints">{state.revealedHints?.map((hint,i) => <p key={i}>💡 {hint}</p>)}</div>}
        {session.role === 'host' && !state.auctionEnabled && state.status === 'playing' && (state.hostSong?.hints?.length ?? 0) > 0 && <div className="host-hints"><strong>Подсказки</strong><button className="secondary" disabled={busy || (state.hintLevel ?? 0) >= (state.hostSong?.hints?.length ?? 0)} onClick={() => command({ type: 'hint' })}>💡 Показать следующую подсказку</button><p>После подсказок за правильный ответ начисляется меньше очков.</p></div>}
        {(state.status === 'lobby' ||
          (state.status === 'revealed' && (!state.auctionEnabled || state.choiceOpen !== false)) ||
          (!state.auctionEnabled && state.status === 'selected') ||
          (state.auctionEnabled && state.status === 'bidding' && !state.currentBid && session.role === 'host')) &&
          <section className="host-board"><h2>{session.role === 'host' && state.status === 'bidding' ? 'Изменить песню до первой ставки' :
          session.role === 'host' ? 'Выбор следующей песни' : 'Игровое поле'}</h2><SongBoard songs={state.board ?? []} disabled={busy || !connected} onChoose={session.role === 'host' ? songId => command({ type: 'choose', songId }) : undefined} />{session.role === 'host' && state.status === 'revealed' && state.chooserId && <p className="muted">Право выбора у: {state.players.find(p => p.id === state.chooserId)?.name ?? 'игрока'}. Ведущий может выбрать вместо него.</p>}</section>}
        
        {session.role === 'host' && <div className="actions">
          {state.auctionEnabled && state.status === 'bidding' &&
            <button disabled={busy || !state.currentBid} onClick={() => command({ type: 'closeBidding' })}>
              Закрыть торги · {state.currentBid ? `${state.currentBid.points} очков / ${state.currentBid.seconds} сек` : 'ожидаем ставку'}
            </button>}
          {(state.status === 'selected' || (!state.auctionEnabled && state.status === 'lobby')) && <>
            <button disabled={busy || state.players.length === 0 || !playerReady}
              onClick={() => state.auctionEnabled ? command({ type: 'start' }) : startWithMusic('start')}>
              {state.auctionEnabled ? 'Подготовить фрагмент' : 'Начать игру и слушать'}
            </button>
            {state.players.length === 0 && <p className="muted">Для начала нужен хотя бы один игрок.</p>}
            {!playerReady && <p className="muted">Ожидаем загрузки плеера YouTube.</p>}
          </>}
          {state.status === 'playing' && <>
            <button disabled={!playerReady || busy} onClick={playMusic}>
              ▶ {state.auctionEnabled ? `Включить фрагмент · ${state.currentBid?.seconds ?? 0} сек` : 'Слушать'}
            </button>
            <button className="secondary" disabled={!playerReady} onClick={() => player.current?.pause()}>
              ⏸ Пауза
            </button>
            <button className="secondary" disabled={busy} onClick={() => command({ type: 'skip' })}>Пропустить песню</button>
          </>}
          {state.auctionEnabled && state.status === 'awaitingJudgment' && <>
            <p className="host-controls-note">
              Фрагмент сам остановился. {bidLeader?.name ?? 'Победитель торгов'} называет ответ.
            </p>
            <button disabled={busy} onClick={() => command({ type: 'judge', correct: true })}>
              ✓ Верно · +{state.currentBid?.points ?? state.song.points}
            </button>
            <button className="secondary" disabled={busy} onClick={() => command({ type: 'judge', correct: false })}>
              ✕ Неверно · −{state.currentBid?.points ?? state.song.points}
            </button>
            <button className="secondary" disabled={busy} onClick={() => command({ type: 'skip' })}>Завершить без оценки</button>
          </>}
          {state.auctionEnabled && state.status === 'openAnswer' && <>
            <button disabled={!playerReady || busy} onClick={replayMusic}>▶ Повторить мелодию</button>
            <button className="secondary" disabled={!playerReady} onClick={() => player.current?.pause()}>⏸ Пауза</button>
            <p className="host-controls-note">
              Теперь STOP доступен любому, кроме победителя торгов, пока мелодия играет. Повторять можно сколько потребуется.
            </p>
            <button className="secondary" disabled={busy} onClick={() => command({ type: 'skip' })}>
              Показать ответ и завершить раунд
            </button>
          </>}
          {state.auctionEnabled && state.status === 'secondBuzzed' && <>
            <p className="host-controls-note">{winner?.name ?? 'Игрок'} отвечает. Музыка на паузе.</p>
            <button disabled={busy} onClick={() => command({ type: 'judge', correct: true })}>
              ✓ Верно · +{state.song.points}
            </button>
            <button className="secondary" disabled={busy} onClick={() => command({ type: 'judge', correct: false })}>
              ✕ Неверно · можно попробовать ещё
            </button>
            <button className="secondary" disabled={busy} onClick={() => command({ type: 'skip' })}>Показать ответ</button>
          </>}
          {!state.auctionEnabled && state.status === 'buzzed' && <>
            <select aria-label="Кому начислить баллы" value={awardTo} onChange={e => setAwardTo(e.target.value)}>
              <option value="">Баллы первому игроку</option>
              {state.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button disabled={busy} onClick={() => command({ type: 'judge', correct: true, ...(awardTo ? { playerId: awardTo } : {}) })}>
              ✓ Верно · +{state.song.availablePoints ?? state.song.points}
            </button>
            <button className="secondary" disabled={busy} onClick={() => command({ type: 'judge', correct: false })}>✕ Неверно</button>
            <button className="secondary" disabled={busy || !playerReady} onClick={() => startWithMusic('resume')}>▶ Продолжить</button>
            <button className="secondary" disabled={busy} onClick={() => command({ type: 'skip' })}>Пропустить</button>
          </>}
          {['revealed','finished'].includes(state.status) && <>
            <button className="secondary" disabled={!playerReady} onClick={replayMusic}>▶ Послушать песню целиком</button>
            <button className="secondary" disabled={!playerReady} onClick={() => player.current?.pause()}>⏸ Пауза</button>
          </>}
          {state.status === 'revealed' && <>
            {state.auctionEnabled && state.choiceOpen === false &&
              <button disabled={busy} onClick={() => command({ type: 'allowChoice' })}>
                Перейти к выбору следующей песни
              </button>}
            {(!state.auctionEnabled || state.choiceOpen !== false) &&
              <button className="secondary" disabled={busy} onClick={() => command({ type: 'next' })}>
                Следующая песня по порядку
              </button>}
          </>}
        </div>}
      </section><aside className="stack"><section className="panel"><span className="eyebrow">УЧАСТНИКИ</span><h2>Таблица лидеров</h2>{state.players.length === 0 ? <p className="muted">Пока никого нет. Поделитесь кодом комнаты.</p> : [...state.players].sort((a,b) => b.score-a.score).map((p,i) => <div className="score" key={p.id}><span className="rank">{i+1}</span><strong>{p.name}</strong><b>{p.score}</b></div>)}</section>{session.role === 'host' && <><section className="panel"><span className="eyebrow">ПРИГЛАШЕНИЕ</span><h2>{session.room}</h2>{share ? <><p className="muted">Игроки сканируют QR-код и вводят своё имя.</p><div className="invite-qr"><QRCodeSVG value={share} size={180} marginSize={2} title="QR-код для входа в комнату" /></div><p className="invite-address">{share}</p><button className="secondary" onClick={() => { if (!navigator.clipboard) { setError('Скопируйте адрес приглашения вручную.'); return; } void navigator.clipboard.writeText(share).catch(() => setError('Не удалось скопировать ссылку')); }}>Скопировать ссылку</button><a className="display-link" target="_blank" rel="noreferrer" href={`${share}&display=1`}>Открыть экран для телевизора</a></> : <p className="muted">Не удалось определить адрес для телефона. Подключите компьютер к Wi-Fi и обновите страницу.</p>}</section><section className="panel"><span className="eyebrow">КОРРЕКТИРОВКА</span><h2>Изменить счёт</h2><select value={awardTo} onChange={e => setAwardTo(e.target.value)}><option value="">Выбрать игрока</option>{state.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><input aria-label="Изменение баллов" type="number" value={adjustment} onChange={e => setAdjustment(Number(e.target.value))} /><button className="secondary" disabled={busy || !awardTo} onClick={() => command({ type: 'adjust', playerId: awardTo, delta: adjustment, reason: 'Ручная корректировка ведущим' })}>Применить</button></section></>}</aside></div>}
  </main>;
}
