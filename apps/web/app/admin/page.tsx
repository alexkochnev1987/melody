'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_HINTS, canStartHintTask, songHintKey, type HintOperation, type HintTasks } from '@/lib/hint-activity';
import type { HumorStyle } from '@/lib/humor-style';
import { authClient } from '@/lib/auth-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Track = { title: string; artist: string; youtubeId: string; points: number; startSeconds?: number; category?: string; hints?: string[]; introHint?: string };
type HistoricGame = { id: string; status: string; startedAt: string | null; endedAt: string | null; startingPoints?: number; bids?: { playerId: string; points: number; seconds: number; songId: string }[]; roundsPlayed: number; totalRounds: number; players: { id: string; name: string; score: number }[]; scoreEvents: { id: string; playerId: string; delta: number; songId: string; reason: string }[] };
type GameSet = { id: string; owner_id: string | null; title: string; description: string; songs: Track[] };
type Viewer = { id: string; name: string; email: string };
type Catalog = { games: GameSet[]; user: Viewer | null; googleConfigured: boolean };

const blankSong = (): Track => ({ title: '', artist: '', youtubeId: '', points: 10, startSeconds: 0, category: 'Разное', hints: [], introHint: '' });
const emptyGame = (): GameSet => ({ id: '', owner_id: '', title: '', description: '', songs: [] });
const humorModes: { id: HumorStyle; title: string; example: string }[] = [
  { id: 'conversational', title: 'Как друг', example: 'Живая фраза, словно за столом с друзьями' },
  { id: 'ironic', title: 'С иронией', example: 'Лёгкая самоирония, без злости' },
  { id: 'absurd', title: 'Немного абсурда', example: 'Смешной неожиданный поворот' },
  { id: 'warm', title: 'Добрый юмор', example: 'Просто, понятно и без колкостей' },
];
type HintFeedback = { text: string; error: boolean };
async function post(body: unknown) {
  const res = await fetch('/api/sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось выполнить действие');
  return data;
}

export default function Admin() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [editing, setEditing] = useState<GameSet | null>(null);
  const [preview, setPreview] = useState<Track | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(10);
  const [startingPoints, setStartingPoints] = useState(300);
  const [history, setHistory] = useState<HistoricGame[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [humorStyle, setHumorStyle] = useState<HumorStyle>('conversational');
  const [humorBrief, setHumorBrief] = useState('');
  const [hintTasks, setHintTasks] = useState<HintTasks>({});
  const hintTasksRef = useRef<Record<string, HintOperation>>({});
  const [hintFeedback, setHintFeedback] = useState<Record<string, HintFeedback>>({});
  const anyHintBusy = Object.keys(hintTasks).length > 0;
  const refresh = useCallback(async () => {
    const res = await fetch('/api/sets', { cache: 'no-store' });
    if (!res.ok) throw new Error('Не удалось загрузить игры');
    setCatalog(await res.json());
  }, []);
  useEffect(() => { fetch('/api/sets', { cache: 'no-store' }).then(res => { if (!res.ok) throw new Error('Не удалось загрузить игры'); return res.json(); }).then(setCatalog).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!catalog?.user?.id) return;
    let active = true;
    fetch('/api/history', { cache: 'no-store' })
      .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Не удалось загрузить историю'); return data; })
      .then(data => { if (active) { setHistory(data.games); setHistoryError(''); } })
      .catch(err => { if (active) setHistoryError(err instanceof Error ? err.message : 'Ошибка истории'); });
    return () => { active = false; };
  }, [catalog?.user?.id]);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
    finally { setBusy(false); }
  }
  async function login() {
    if (!catalog?.googleConfigured) { setError('Вход через Google пока не настроен: добавьте GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET в apps/web/.env.'); return; }
    const result = await authClient.signIn.social({ provider: 'google', callbackURL: '/admin' });
    if (result.error) setError(result.error.message || 'Не удалось войти');
  }
  async function save() {
    if (!editing) return;
    await perform(async () => { const result = await post({ action: 'save', ...editing, id: editing.id || undefined }); await refresh(); setEditing({ ...editing, id: result.id, owner_id: catalog?.user?.id ?? '' }); });
  }
  async function copy(id: string) {
    await perform(async () => { const result = await post({ action: 'copy', id }); const res = await fetch('/api/sets', { cache: 'no-store' }); const data: Catalog = await res.json(); setCatalog(data); setEditing(data.games.find(g => g.id === result.id) ?? null); });
  }
  async function start(id: string) {
    await perform(async () => { const result = await post({ action: 'start', id, startingPoints }); localStorage.setItem('melody-session', JSON.stringify({ ...result, role: 'host' })); router.push('/?room=' + encodeURIComponent(result.room)); });
  }
  async function generate() {
    if (!editing) return;
    await perform(async () => {
      const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, count }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Не удалось подобрать песни');
      setEditing({ ...editing, songs: [...editing.songs, ...data.songs.map((s: { title: string; artist: string; youtubeId: string; category?: string; hints?: string[] }) => ({ title: s.title, artist: s.artist, youtubeId: s.youtubeId || '', points: 10, startSeconds: 0, category: s.category || 'Разное', hints: s.hints ?? [] }))] });
    });
  }
  /**
   * Ref synchronously reserves the operation before React re-renders:
   * simultaneous clicks cannot start the same request twice.
   * Other song cards remain interactive; a bulk job is exclusive.
   */
  async function runHintTask(key: string, operation: HintOperation, work: () => Promise<string>) {
    if (busy || !canStartHintTask(hintTasksRef.current, key)) return;
    const started = { ...hintTasksRef.current, [key]: operation };
    hintTasksRef.current = started;
    setHintTasks(started);
    setHintFeedback(old => ({ ...old, [key]: { text: '', error: false } }));
    try {
      const message = await work();
      setHintFeedback(old => ({ ...old, [key]: { text: message, error: false } }));
    } catch (e) {
      setHintFeedback(old => ({ ...old, [key]: {
        text: e instanceof Error ? e.message : 'Не удалось выполнить действие',
        error: true,
      } }));
    } finally {
      const next = { ...hintTasksRef.current };
      delete next[key];
      hintTasksRef.current = next;
      setHintTasks(next);
    }
  }

  async function generateHints(indices?: number[]) {
    if (!editing) return;
    const snapshot = editing;
    const selected = indices ?? snapshot.songs.map((_, index) => index);
    const key = indices?.length === 1 ? songHintKey(indices[0]) : ALL_HINTS;
    if (!selected.length || selected.some(index => !snapshot.songs[index]?.title.trim() ||
      !snapshot.songs[index]?.artist.trim())) {
      setHintFeedback(old => ({ ...old, [key]: {
        text: 'Сначала укажи название и исполнителя для выбранных песен.',
        error: true,
      } }));
      return;
    }
    await runHintTask(key, 'generate', async () => {
      let succeeded = 0;
      let failed = 0;
      const preferences = { style: humorStyle, humorBrief: humorBrief.trim() };
      for (let offset = 0; offset < selected.length; offset += 15) {
        const batch = selected.slice(offset, offset + 15);
        const songs = batch.map(index => ({
          title: snapshot.songs[index].title,
          artist: snapshot.songs[index].artist,
          category: snapshot.songs[index].category || 'Разное',
        }));
        const res = await fetch('/api/hints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ songs, ...preferences }),
        });
        const data: { songs?: { index: number; hints: string[] }[]; error?: string } = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось создать подсказки');
        const updates = new Map<number, string[]>();
        for (const result of data.songs ?? []) {
          const index = batch[result.index];
          if (index === undefined) continue;
          if (result.hints.length === 3) { updates.set(index, result.hints); succeeded++; }
          else failed++;
        }
        // Apply each batch immediately. Successful results survive a later batch failure.
        setEditing(current => {
          if (!current || current.id !== snapshot.id) return current;
          return { ...current, songs: current.songs.map((song, index) => {
            const expected = snapshot.songs[index];
            const hints = updates.get(index);
            if (!hints || !expected || song.title !== expected.title ||
              song.artist !== expected.artist || song.youtubeId !== expected.youtubeId) return song;
            return { ...song, hints, introHint: song.introHint?.trim() || hints[0] };
          }) };
        });
      }
      if (!succeeded) throw new Error('Подсказки не прошли проверку. Попробуй другие пожелания к юмору.');
      const savedMessage = indices?.length === 1
        ? 'Три варианта готовы. Выбери понравившийся и сохрани подсказку этой песни.'
        : `Варианты готовы для ${succeeded} песен. Выбери шутки и сохрани все подсказки.`;
      return failed ? `${savedMessage} Для ${failed} песен AI не создал подходящих вариантов.` : savedMessage;
    });
  }

  async function saveHints(indices?: number[]) {
    if (!editing) return;
    const game = editing;
    const selected = indices ?? game.songs.map((_, index) => index);
    const key = indices?.length === 1 ? songHintKey(indices[0]) : ALL_HINTS;
    if (!game.id) {
      setHintFeedback(old => ({ ...old, [key]: {
        text: 'Сначала сохрани новую игру, затем отдельно сохраняй подсказки.',
        error: true,
      } }));
      return;
    }
    if (!selected.length) return;
    await runHintTask(key, 'save', async () => {
      const updates = selected.map(index => {
        const song = game.songs[index];
        return {
          index, title: song.title, artist: song.artist, youtubeId: song.youtubeId,
          hints: (song.hints ?? []).map(hint => hint.trim()).filter(Boolean),
          introHint: song.introHint?.trim() ?? '',
        };
      });
      await post({ action: 'saveHints', id: game.id, updates });
      await refresh();
      return indices?.length === 1
        ? 'Сохранено! Остальные песни не изменились.'
        : 'Все выбранные подсказки сохранены.';
    });
  }

  async function downloadHistory() {
    await perform(async () => {
      const games: HistoricGame[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const res: Response = await fetch(`/api/history?offset=${offset}`, { cache: 'no-store' });
        const data: { games: HistoricGame[]; nextOffset: number | null; error?: string } = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось выгрузить историю игр');
        games.push(...(data.games as HistoricGame[]));
        offset = typeof data.nextOffset === 'number' ? data.nextOffset : null;
      }
      const exportData = JSON.stringify({ exportedAt: new Date().toISOString(), games }, null, 2);
      const url = URL.createObjectURL(new Blob([exportData], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `melody-history-${new Date().toISOString().slice(0,10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  const readonly = editing?.owner_id === null;
  const openEditing = (game: GameSet) => {
    setHintFeedback({});
    setEditing(game);
  };
  const invalidCount = !Number.isInteger(count) || count < 1 || count > 30;
  const patchTrack = (index: number, update: Partial<Track>) => {
    setHintFeedback(old => {
      const next = { ...old };
      delete next[songHintKey(index)];
      delete next[ALL_HINTS];
      return next;
    });
    setEditing(g => g ? { ...g, songs: g.songs.map((s, i) => i === index ? { ...s, ...update } : s) } : g);
  };
  const moveTrack = (index: number, offset: number) => setEditing(g => {
    if (!g || index + offset < 0 || index + offset >= g.songs.length) return g;
    const next = [...g.songs]; [next[index], next[index + offset]] = [next[index + offset], next[index]];
    return { ...g, songs: next };
  });
  return <main className="shell admin-shell">
    <header><Link className="brand" href="/">♫ melody<span className="brand-dot">.</span></Link><span className="tag">ИГРЫ И ПОДБОРКИ</span><div className="header-actions">{catalog?.user ? <><span>{catalog.user.name}</span><button className="text-button" onClick={() => perform(async () => { await authClient.signOut(); setEditing(null); await refresh(); })}>Выйти</button></> : <button className="secondary" onClick={login}>Войти через Google</button>}</div></header>
    {error && <div className="notice" role="alert">{error}</div>}
    {catalog?.user && <section className="panel starting-points-panel">
      <label>Стартовый баланс участников
        <input type="number" inputMode="numeric" step="1" min="1" max="100000"
          value={startingPoints} onChange={e => setStartingPoints(Number(e.target.value))} />
      </label>
      <p className="muted">По умолчанию 300 очков. Начисляются каждому при входе в новую комнату.
        Ставка не может превышать текущий баланс игрока.</p>
    </section>}
    {!catalog ? <div className="panel">Загружаем игры…</div> : !editing ? <>
      <div className="catalog-head"><div><span className="eyebrow">ТВОЯ МУЗЫКАЛЬНАЯ КОЛЛЕКЦИЯ</span><h1>Игры для любой компании</h1><p className="muted">Выбери готовый набор или создай свой. Комнату для игроков можно открыть в любой момент.</p></div><button className="new-game" disabled={!catalog.user} onClick={() => openEditing(emptyGame())}>+ Создать игру</button></div>
      {!catalog.user && <div className="login-hint">{catalog.googleConfigured ? 'Войди через Google, чтобы копировать и создавать игры.' : 'Для создания своих игр нужно подключить вход через Google.'}</div>}
      <h2>Общие игры</h2><div className="catalog-grid">{catalog.games.filter(g => !g.owner_id).map(g => <article className="panel game-card" key={g.id}><span className="game-mark">♫</span><span className="eyebrow">ОБЩИЙ НАБОР</span><h2>{g.title}</h2><p className="muted">{g.description}</p><p>{g.songs.length} песен</p><button className="secondary" onClick={() => openEditing(g)}>Посмотреть песни</button><button disabled={!catalog.user || busy} onClick={() => copy(g.id)}>Скопировать к себе</button></article>)}</div>
      <h2 className="section-title">Мои игры</h2>{catalog.user ? <div className="catalog-grid">{catalog.games.filter(g => g.owner_id === catalog.user?.id).map(g => <article className="panel game-card" key={g.id}><span className="game-mark">♪</span><span className="eyebrow">МОЯ ИГРА</span><h2>{g.title}</h2><p className="muted">{g.description || 'Своя музыкальная подборка'}</p><p>{g.songs.length} песен</p><button className="secondary" onClick={() => openEditing(g)}>Редактировать</button><button disabled={busy || !g.songs.length || !Number.isSafeInteger(startingPoints) || startingPoints < 1 || startingPoints > 100000} onClick={() => start(g.id)}>Создать комнату</button></article>)}{catalog.games.every(g => g.owner_id !== catalog.user?.id) && <p className="muted">Пока нет своих игр. Создай игру или скопируй общий набор.</p>}</div> : <p className="muted">Здесь будут игры, которые ты создашь или скопируешь.</p>}
      {catalog.user && <section className="panel history-results"><h2>История игр и результаты</h2>{history.length > 0 && <button className="secondary" onClick={downloadHistory}>Скачать историю (JSON)</button>}<p className="muted">Очки хранятся в PostgreSQL и остаются после завершения игры.</p>{historyError && <p role="alert">{historyError}</p>}{history.length === 0 && <p className="muted">Пока нет сохранённых игр этого аккаунта.</p>}{history.map(game => <article key={game.id}><strong>Комната {game.id} · {game.status === 'finished' ? 'Завершена' : 'В процессе'}</strong><div><time>{game.startedAt ? new Date(game.startedAt).toLocaleString('ru-RU') : 'Начало ещё не записано'}</time><span className="muted"> · {game.roundsPlayed} из {game.totalRounds} песен · Старт: {game.startingPoints ?? 0} · Ставок: {game.bids?.length ?? 0}</span></div><ol>{game.players.map(p => <li key={p.id}>{p.name} — <strong>{p.score}</strong> очков</li>)}</ol></article>)}</section>}
    </> : <>
      <button className="text-button back" disabled={anyHintBusy} onClick={() => { setEditing(null); setHintFeedback({}); }}>← Все игры</button><div className="catalog-head"><div><span className="eyebrow">{readonly ? 'ОБЩАЯ ИГРА · ТОЛЬКО ПРОСМОТР' : 'РЕДАКТОР ИГРЫ'}</span><h1>{editing.title || 'Новая игра'}</h1><p className="muted">Подготовь список песен и баллы до начала игры.</p></div><div className="editor-actions">{readonly ? <><button disabled={!catalog.user || busy} onClick={() => copy(editing.id)}>Скопировать к себе</button><button className="secondary" disabled={!catalog.user || busy || !Number.isSafeInteger(startingPoints) || startingPoints < 1 || startingPoints > 100000} onClick={() => start(editing.id)}>Создать комнату</button></> : <><button disabled={busy || anyHintBusy} onClick={save}>Сохранить игру</button>{editing.id && <button className="secondary" disabled={busy || anyHintBusy || !editing.songs.length || !Number.isSafeInteger(startingPoints) || startingPoints < 1 || startingPoints > 100000} onClick={() => start(editing.id)}>Создать комнату</button>}</>}</div></div>
      <section className="panel"><div className="editor-meta"><label>Название игры<input disabled={readonly} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Например, Вечеринка 2000-х" /></label><label>Описание<input disabled={readonly} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="Для кого и какое настроение" /></label></div>
      {!readonly && <div className="ai-box"><div className="ai-heading">✦ Добавить песни с AI</div><p className="muted">Опиши подборку. Проверенные варианты добавятся в таблицу; остальные можно найти вручную.</p><label>Пожелания<textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Например, танцевальные хиты 2000-х" /></label><div className="ai-actions"><label>Количество<input type="number" min="1" max="30" value={count || ''} aria-invalid={invalidCount} aria-describedby={invalidCount ? 'admin-count-error' : undefined} onChange={e => setCount(Number(e.target.value))} /></label><button className="secondary" disabled={busy || anyHintBusy || prompt.trim().length < 5 || invalidCount} onClick={generate}>{busy ? 'Ищем…' : 'Подобрать песни'}</button></div>{invalidCount && <p id="admin-count-error" className="field-error" role="alert">Можно выбрать от 1 до 30 песен.</p>}</div>}
      <div className="table-heading"><div><span className="eyebrow">СОСТАВ ИГРЫ</span><h2>Песни · {editing.songs.length}</h2></div>{!readonly && <button className="secondary table-add" disabled={anyHintBusy} onClick={() => setEditing({ ...editing, songs: [...editing.songs, blankSong()] })}>+ Добавить песню</button>}</div>
      <div className="table-scroll"><table><thead><tr><th>№</th><th>Название</th><th>Исполнитель</th><th>Категория</th><th>YouTube ID</th><th>Начало, сек.</th><th>Баллы</th><th>Видео</th>{!readonly && <th>Порядок</th>}</tr></thead><tbody>{editing.songs.map((s, i) => <tr key={i}><td>{i+1}</td><td><input aria-label={`Название песни ${i+1}`} disabled={readonly || Boolean(hintTasks[ALL_HINTS] || hintTasks[songHintKey(i)])} value={s.title} onChange={e => patchTrack(i, { title: e.target.value })} /></td><td><input aria-label={`Исполнитель ${i+1}`} disabled={readonly || Boolean(hintTasks[ALL_HINTS] || hintTasks[songHintKey(i)])} value={s.artist} onChange={e => patchTrack(i, { artist: e.target.value })} /></td><td><input aria-label={`Категория песни ${i+1}`} disabled={readonly || Boolean(hintTasks[ALL_HINTS] || hintTasks[songHintKey(i)])} value={s.category || 'Разное'} maxLength={60} onChange={e => patchTrack(i, { category: e.target.value })} /></td><td><input aria-label={`YouTube ID ${i+1}`} disabled={readonly || Boolean(hintTasks[ALL_HINTS] || hintTasks[songHintKey(i)])} value={s.youtubeId} onChange={e => patchTrack(i, { youtubeId: e.target.value })} placeholder="11 символов" /></td><td><input className="points" aria-label={`Начало в секундах ${i+1}`} disabled={readonly || Boolean(hintTasks[ALL_HINTS] || hintTasks[songHintKey(i)])} type="number" min="0" max="86400" step="1" value={s.startSeconds ?? 0} onChange={e => patchTrack(i, { startSeconds: Number(e.target.value) })} /></td><td><input className="points" aria-label={`Баллы ${i+1}`} disabled={readonly || Boolean(hintTasks[ALL_HINTS] || hintTasks[songHintKey(i)])} type="number" min="0" max="100000" value={s.points} onChange={e => patchTrack(i, { points: Number(e.target.value) })} /></td><td>{/^[\w-]{11}$/.test(s.youtubeId) ? <button className="text-button" onClick={() => setPreview(s)}>▶ Посмотреть</button> : <a className="search-link" target="_blank" rel="noreferrer" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(s.artist + ' ' + s.title)}`}>Найти</a>}</td>{!readonly && <td><div className="row-actions"><button aria-label="Поднять песню" disabled={anyHintBusy || i === 0} onClick={() => moveTrack(i,-1)}>↑</button><button aria-label="Опустить песню" disabled={anyHintBusy || i === editing.songs.length-1} onClick={() => moveTrack(i,1)}>↓</button><button aria-label="Удалить песню" disabled={anyHintBusy} onClick={() => setEditing({ ...editing, songs: editing.songs.filter((_, n) => n !== i) })}>×</button></div></td>}</tr>)}</tbody></table>{editing.songs.length === 0 && <p className="muted">Пока нет песен. Добавь первую вручную или с помощью AI.</p>}</div>
      {!readonly && editing.songs.length > 0 && <section className="hint-tone-panel" aria-label="Настройки юмора AI">
        <h3>Как должна звучать шутка?</h3>
        <p className="muted">Меньше шаблонных AI-фраз, больше живой человеческой речи. Выбери тон для следующей генерации.</p>
        <div className="hint-tone-options" role="group" aria-label="Стиль подсказок">
          {humorModes.map(mode => <button key={mode.id} type="button"
            aria-pressed={humorStyle === mode.id}
            className={humorStyle === mode.id ? 'hint-tone-option hint-tone-option--selected' : 'hint-tone-option'}
            onClick={() => setHumorStyle(mode.id)}>
            <strong>{mode.title}</strong><span>{mode.example}</span>
          </button>)}
        </div>
        <label>Пожелания к шуткам (необязательно)
          <textarea maxLength={300} rows={3} value={humorBrief}
            onChange={e => setHumorBrief(e.target.value)}
            placeholder="Например: шутки как у друзей на кухне, немного самоиронии, без пафоса и банальных метафор" />
        </label>
        <p className="hint">Эти настройки используются только при следующей генерации. Уже выбранные и сохранённые подсказки не меняются.</p>
      </section>}
      {!readonly && editing.songs.length > 0 && <div className="hint-editor" aria-busy={Boolean(hintTasks[ALL_HINTS])}>
        <h3>Предыгровые подсказки для всей игры</h3>
        <button className="secondary" disabled={busy || anyHintBusy} onClick={() => generateHints()}>
          {hintTasks[ALL_HINTS] === 'generate' ? '✦ Генерируем варианты для всех…' : '✦ Сгенерировать для всех песен'}
        </button>
        <button disabled={busy || anyHintBusy || !editing.id} onClick={() => saveHints()}>
          {hintTasks[ALL_HINTS] === 'save' ? 'Сохраняем все подсказки…' : 'Сохранить выбранные подсказки всех песен'}
        </button>
        {hintFeedback[ALL_HINTS]?.text && <p className={hintFeedback[ALL_HINTS].error ? 'hint-job-error' : 'hint-job-success'}
          role={hintFeedback[ALL_HINTS].error ? 'alert' : 'status'}>{hintFeedback[ALL_HINTS].text}</p>}
        {!editing.id && <p className="hint">Для отдельного сохранения подсказок сначала нажми «Сохранить игру».</p>}
      </div>}
      <h2>Одна предыгровая подсказка на песню</h2>
      <p className="muted">AI предлагает три альтернативы, но игрокам показывается только одна выбранная шутка — после выбора песни и до её запуска.</p>
      {editing.songs.map((s,i) => <div className="hint-editor" aria-busy={Boolean(hintTasks[ALL_HINTS] || hintTasks[songHintKey(i)])} key={i}>
        <h3>{i+1}. {s.artist || 'Исполнитель'} — {s.title || 'Название'}</h3>
        {(s.hints?.length ?? 0) > 0 && <div className="hint-variants" role="group" aria-label={`Варианты подсказки к песне ${i+1}`}>
          {s.hints?.map((variant,n) => <button key={n} type="button" disabled={readonly || Boolean(hintTasks[ALL_HINTS] || hintTasks[songHintKey(i)])}
            aria-pressed={s.introHint === variant}
            className={s.introHint === variant ? 'hint-variant hint-variant--selected' : 'hint-variant'}
            onClick={() => patchTrack(i, { introHint: variant })}>
            <span>Вариант {n+1}</span>{variant}
          </button>)}
        </div>}
        <label>Подсказка, которую увидят игроки
          <textarea disabled={readonly || Boolean(hintTasks[ALL_HINTS] || hintTasks[songHintKey(i)])} maxLength={220} value={s.introHint ?? s.hints?.[0] ?? ''}
            aria-label={`Выбранная подсказка к песне ${i+1}`}
            onChange={e => patchTrack(i, { introHint: e.target.value })}
            placeholder="Выбери вариант или напиши собственную шутку" />
        </label>
        {!readonly && <>
          <button className="secondary" disabled={busy || Boolean(hintTasks[ALL_HINTS] || hintTasks[songHintKey(i)])}
            onClick={() => generateHints([i])}>
            {hintTasks[songHintKey(i)] === 'generate' ? '✦ Генерируем для этой песни…' : '✦ Создать три варианта'}
          </button>
          <button disabled={busy || !editing.id || Boolean(hintTasks[ALL_HINTS] || hintTasks[songHintKey(i)])}
            onClick={() => saveHints([i])}>
            {hintTasks[songHintKey(i)] === 'save' ? 'Сохраняем эту песню…' : 'Сохранить подсказку этой песни'}
          </button>
          {hintFeedback[songHintKey(i)]?.text && <p
            className={hintFeedback[songHintKey(i)].error ? 'hint-job-error' : 'hint-job-success'}
            role={hintFeedback[songHintKey(i)].error ? 'alert' : 'status'}>
            {hintFeedback[songHintKey(i)].text}
          </p>}
        </>}
      </div>)}
      </section>
    </>}
    {preview && <div className="modal-backdrop" onClick={() => setPreview(null)}><div className="modal panel" role="dialog" aria-modal="true" aria-label="Предпросмотр видео" onClick={e => e.stopPropagation()}><div className="modal-head"><h2>{preview.artist} — {preview.title}</h2><button aria-label="Закрыть" className="text-button" onClick={() => setPreview(null)}>✕</button></div><div className="video"><iframe title={`Предпросмотр ${preview.title}`} src={`https://www.youtube.com/embed/${preview.youtubeId}?start=${preview.startSeconds ?? 0}&playsinline=1`} allow="encrypted-media; picture-in-picture" allowFullScreen /></div><p className="muted">Начало: {preview.startSeconds ?? 0} сек. Проверь, что видео доступно и это нужная версия песни.</p></div></div>}
  </main>;
}
