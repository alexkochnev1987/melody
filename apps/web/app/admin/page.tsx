'use client';
import { useCallback, useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Track = { title: string; artist: string; youtubeId: string; points: number; startSeconds?: number; category?: string; hints?: string[] };
type HistoricGame = { id: string; status: string; startedAt: string | null; endedAt: string | null; roundsPlayed: number; totalRounds: number; players: { id: string; name: string; score: number }[]; scoreEvents: { id: string; playerId: string; delta: number; songId: string; reason: string }[] };
type GameSet = { id: string; owner_id: string | null; title: string; description: string; songs: Track[] };
type Viewer = { id: string; name: string; email: string };
type Catalog = { games: GameSet[]; user: Viewer | null; googleConfigured: boolean };

const blankSong = (): Track => ({ title: '', artist: '', youtubeId: '', points: 10, startSeconds: 0, category: 'Разное', hints: [] });
const emptyGame = (): GameSet => ({ id: '', owner_id: '', title: '', description: '', songs: [] });
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
  const [history, setHistory] = useState<HistoricGame[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [hintNotice, setHintNotice] = useState('');
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
    await perform(async () => { const result = await post({ action: 'start', id }); localStorage.setItem('melody-session', JSON.stringify({ ...result, role: 'host' })); router.push('/?room=' + encodeURIComponent(result.room)); });
  }
  async function generate() {
    if (!editing) return;
    await perform(async () => {
      const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, count }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Не удалось подобрать песни');
      setEditing({ ...editing, songs: [...editing.songs, ...data.songs.map((s: { title: string; artist: string; youtubeId: string; category?: string; hints?: string[] }) => ({ title: s.title, artist: s.artist, youtubeId: s.youtubeId || '', points: 10, startSeconds: 0, category: s.category || 'Разное', hints: s.hints ?? [] }))] });
    });
  }
  async function generateHints(indices?: number[]) {
    if (!editing) return;
    const currentGame = editing;
    const selected = indices ?? currentGame.songs.map((_, index) => index);
    if (!selected.length || selected.some(index => !currentGame.songs[index]?.title.trim() ||
        !currentGame.songs[index]?.artist.trim())) {
      setError('Сначала укажи название и исполнителя для каждой выбранной песни.');
      return;
    }
    setHintNotice('');
    await perform(async () => {
      const updates = new Map<number, string[]>();
      let failed = 0;
      // Smaller batches keep structured output within model limits.
      for (let offset = 0; offset < selected.length; offset += 15) {
        const batch = selected.slice(offset, offset + 15);
        const songs = batch.map(i => ({
          title: currentGame.songs[i].title,
          artist: currentGame.songs[i].artist,
          category: currentGame.songs[i].category || 'Разное',
        }));
        const res = await fetch('/api/hints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ songs }),
        });
        const data: { songs?: { index: number; hints: string[] }[]; error?: string } = await res.json();
        if (!res.ok) throw new Error(data.error || 'Не удалось создать подсказки');
        for (const result of data.songs ?? []) {
          const i = batch[result.index];
          if (i === undefined) continue;
          if (result.hints.length === 3) updates.set(i, result.hints);
          else failed++;
        }
      }
      setEditing(current => {
        if (!current || current.id !== currentGame.id) return current;
        return {
          ...current,
          songs: current.songs.map((song, index) => {
            const expected = currentGame.songs[index];
            const hints = updates.get(index);
            if (!hints || !expected || song.title !== expected.title || song.artist !== expected.artist) return song;
            return { ...song, hints };
          }),
        };
      });
      if (failed) setError(`Для ${failed} песен подсказки не прошли проверку. Повтори генерацию для них.`);
      if (updates.size) setHintNotice(indices?.length === 1
        ? 'Три подсказки заполнены. Проверь их и нажми «Сохранить подсказки этой песни».'
        : `Подсказки заполнены для ${updates.size} песен. Проверь и нажми «Сохранить все подсказки».`);
    });
  }

  async function saveHints(indices?: number[]) {
    if (!editing) return;
    if (!editing.id) {
      setError('Сначала сохрани новую игру, затем отдельно сохраняй подсказки.');
      return;
    }
    const selected = indices ?? editing.songs.map((_, index) => index);
    if (!selected.length) return;
    const game = editing;
    setHintNotice('');
    await perform(async () => {
      const updates = selected.map(index => {
        const song = game.songs[index];
        return { index, title: song.title, artist: song.artist, youtubeId: song.youtubeId,
          hints: (song.hints ?? []).map(hint => hint.trim()).filter(Boolean) };
      });
      await post({ action: 'saveHints', id: game.id, updates });
      await refresh();
      setHintNotice(indices?.length === 1
        ? 'Подсказки этой песни сохранены в базе. Остальные песни не изменены.'
        : 'Подсказки всех песен сохранены в базе.');
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
  const invalidCount = !Number.isInteger(count) || count < 1 || count > 30;
  const patchTrack = (index: number, update: Partial<Track>) => setEditing(g => g ? { ...g, songs: g.songs.map((s, i) => i === index ? { ...s, ...update } : s) } : g);
  const moveTrack = (index: number, offset: number) => setEditing(g => {
    if (!g || index + offset < 0 || index + offset >= g.songs.length) return g;
    const next = [...g.songs]; [next[index], next[index + offset]] = [next[index + offset], next[index]];
    return { ...g, songs: next };
  });
  return <main className="shell admin-shell">
    <header><Link className="brand" href="/">♫ melody<span className="brand-dot">.</span></Link><span className="tag">ИГРЫ И ПОДБОРКИ</span><div className="header-actions">{catalog?.user ? <><span>{catalog.user.name}</span><button className="text-button" onClick={() => perform(async () => { await authClient.signOut(); setEditing(null); await refresh(); })}>Выйти</button></> : <button className="secondary" onClick={login}>Войти через Google</button>}</div></header>
    {error && <div className="notice" role="alert">{error}</div>}
    {!catalog ? <div className="panel">Загружаем игры…</div> : !editing ? <>
      <div className="catalog-head"><div><span className="eyebrow">ТВОЯ МУЗЫКАЛЬНАЯ КОЛЛЕКЦИЯ</span><h1>Игры для любой компании</h1><p className="muted">Выбери готовый набор или создай свой. Комнату для игроков можно открыть в любой момент.</p></div><button className="new-game" disabled={!catalog.user} onClick={() => setEditing(emptyGame())}>+ Создать игру</button></div>
      {!catalog.user && <div className="login-hint">{catalog.googleConfigured ? 'Войди через Google, чтобы копировать и создавать игры.' : 'Для создания своих игр нужно подключить вход через Google.'}</div>}
      <h2>Общие игры</h2><div className="catalog-grid">{catalog.games.filter(g => !g.owner_id).map(g => <article className="panel game-card" key={g.id}><span className="game-mark">♫</span><span className="eyebrow">ОБЩИЙ НАБОР</span><h2>{g.title}</h2><p className="muted">{g.description}</p><p>{g.songs.length} песен</p><button className="secondary" onClick={() => setEditing(g)}>Посмотреть песни</button><button disabled={!catalog.user || busy} onClick={() => copy(g.id)}>Скопировать к себе</button></article>)}</div>
      <h2 className="section-title">Мои игры</h2>{catalog.user ? <div className="catalog-grid">{catalog.games.filter(g => g.owner_id === catalog.user?.id).map(g => <article className="panel game-card" key={g.id}><span className="game-mark">♪</span><span className="eyebrow">МОЯ ИГРА</span><h2>{g.title}</h2><p className="muted">{g.description || 'Своя музыкальная подборка'}</p><p>{g.songs.length} песен</p><button className="secondary" onClick={() => setEditing(g)}>Редактировать</button><button disabled={busy || !g.songs.length} onClick={() => start(g.id)}>Создать комнату</button></article>)}{catalog.games.every(g => g.owner_id !== catalog.user?.id) && <p className="muted">Пока нет своих игр. Создай игру или скопируй общий набор.</p>}</div> : <p className="muted">Здесь будут игры, которые ты создашь или скопируешь.</p>}
      {catalog.user && <section className="panel history-results"><h2>История игр и результаты</h2>{history.length > 0 && <button className="secondary" onClick={downloadHistory}>Скачать историю (JSON)</button>}<p className="muted">Очки хранятся в PostgreSQL и остаются после завершения игры.</p>{historyError && <p role="alert">{historyError}</p>}{history.length === 0 && <p className="muted">Пока нет сохранённых игр этого аккаунта.</p>}{history.map(game => <article key={game.id}><strong>Комната {game.id} · {game.status === 'finished' ? 'Завершена' : 'В процессе'}</strong><div><time>{game.startedAt ? new Date(game.startedAt).toLocaleString('ru-RU') : 'Начало ещё не записано'}</time><span className="muted"> · {game.roundsPlayed} из {game.totalRounds} песен</span></div><ol>{game.players.map(p => <li key={p.id}>{p.name} — <strong>{p.score}</strong> очков</li>)}</ol></article>)}</section>}
    </> : <>
      <button className="text-button back" onClick={() => setEditing(null)}>← Все игры</button><div className="catalog-head"><div><span className="eyebrow">{readonly ? 'ОБЩАЯ ИГРА · ТОЛЬКО ПРОСМОТР' : 'РЕДАКТОР ИГРЫ'}</span><h1>{editing.title || 'Новая игра'}</h1><p className="muted">Подготовь список песен и баллы до начала игры.</p></div><div className="editor-actions">{readonly ? <><button disabled={!catalog.user || busy} onClick={() => copy(editing.id)}>Скопировать к себе</button><button className="secondary" disabled={!catalog.user || busy} onClick={() => start(editing.id)}>Создать комнату</button></> : <><button disabled={busy} onClick={save}>Сохранить игру</button>{editing.id && <button className="secondary" disabled={busy || !editing.songs.length} onClick={() => start(editing.id)}>Создать комнату</button>}</>}</div></div>
      <section className="panel"><div className="editor-meta"><label>Название игры<input disabled={readonly} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Например, Вечеринка 2000-х" /></label><label>Описание<input disabled={readonly} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="Для кого и какое настроение" /></label></div>
      {!readonly && <div className="ai-box"><div className="ai-heading">✦ Добавить песни с AI</div><p className="muted">Опиши подборку. Проверенные варианты добавятся в таблицу; остальные можно найти вручную.</p><label>Пожелания<textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Например, танцевальные хиты 2000-х" /></label><div className="ai-actions"><label>Количество<input type="number" min="1" max="30" value={count || ''} aria-invalid={invalidCount} aria-describedby={invalidCount ? 'admin-count-error' : undefined} onChange={e => setCount(Number(e.target.value))} /></label><button className="secondary" disabled={busy || prompt.trim().length < 5 || invalidCount} onClick={generate}>{busy ? 'Ищем…' : 'Подобрать песни'}</button></div>{invalidCount && <p id="admin-count-error" className="field-error" role="alert">Можно выбрать от 1 до 30 песен.</p>}</div>}
      <div className="table-heading"><div><span className="eyebrow">СОСТАВ ИГРЫ</span><h2>Песни · {editing.songs.length}</h2></div>{!readonly && <button className="secondary table-add" onClick={() => setEditing({ ...editing, songs: [...editing.songs, blankSong()] })}>+ Добавить песню</button>}</div>
      <div className="table-scroll"><table><thead><tr><th>№</th><th>Название</th><th>Исполнитель</th><th>Категория</th><th>YouTube ID</th><th>Начало, сек.</th><th>Баллы</th><th>Видео</th>{!readonly && <th>Порядок</th>}</tr></thead><tbody>{editing.songs.map((s, i) => <tr key={i}><td>{i+1}</td><td><input aria-label={`Название песни ${i+1}`} disabled={readonly} value={s.title} onChange={e => patchTrack(i, { title: e.target.value })} /></td><td><input aria-label={`Исполнитель ${i+1}`} disabled={readonly} value={s.artist} onChange={e => patchTrack(i, { artist: e.target.value })} /></td><td><input aria-label={`Категория песни ${i+1}`} disabled={readonly} value={s.category || 'Разное'} maxLength={60} onChange={e => patchTrack(i, { category: e.target.value })} /></td><td><input aria-label={`YouTube ID ${i+1}`} disabled={readonly} value={s.youtubeId} onChange={e => patchTrack(i, { youtubeId: e.target.value })} placeholder="11 символов" /></td><td><input className="points" aria-label={`Начало в секундах ${i+1}`} disabled={readonly} type="number" min="0" max="86400" step="1" value={s.startSeconds ?? 0} onChange={e => patchTrack(i, { startSeconds: Number(e.target.value) })} /></td><td><input className="points" aria-label={`Баллы ${i+1}`} disabled={readonly} type="number" min="0" max="100000" value={s.points} onChange={e => patchTrack(i, { points: Number(e.target.value) })} /></td><td>{/^[\w-]{11}$/.test(s.youtubeId) ? <button className="text-button" onClick={() => setPreview(s)}>▶ Посмотреть</button> : <a className="search-link" target="_blank" rel="noreferrer" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(s.artist + ' ' + s.title)}`}>Найти</a>}</td>{!readonly && <td><div className="row-actions"><button aria-label="Поднять песню" disabled={i === 0} onClick={() => moveTrack(i,-1)}>↑</button><button aria-label="Опустить песню" disabled={i === editing.songs.length-1} onClick={() => moveTrack(i,1)}>↓</button><button aria-label="Удалить песню" onClick={() => setEditing({ ...editing, songs: editing.songs.filter((_, n) => n !== i) })}>×</button></div></td>}</tr>)}</tbody></table>{editing.songs.length === 0 && <p className="muted">Пока нет песен. Добавь первую вручную или с помощью AI.</p>}</div>
      {!readonly && editing.songs.length > 0 && <div className="hint-editor">
        <h3>Подсказки для всей игры</h3>
        <button className="secondary" disabled={busy} onClick={() => generateHints()}>✦ Сгенерировать для всех песен</button>
        <button disabled={busy || !editing.id} onClick={() => saveHints()}>Сохранить все подсказки</button>
        {!editing.id && <p className="hint">Для отдельного сохранения подсказок сначала нажми «Сохранить игру».</p>}
      </div>}
      <h2>Подсказки к песням</h2>{hintNotice && <p className="notice" role="status">{hintNotice}</p>}<p className="muted">Подсказки показываются только по команде ведущего. Каждую можно отредактировать или перегенерировать.</p>
      {editing.songs.map((s,i) => <div className="hint-editor" key={i}><h3>{i+1}. {s.artist || 'Исполнитель'} — {s.title || 'Название'}</h3>{[0,1,2].map(index => <input key={index} disabled={readonly} maxLength={220} aria-label={`Подсказка ${index+1} для песни ${i+1}`} placeholder={`Шуточная подсказка ${index+1}`} value={s.hints?.[index] ?? ''} onChange={e => patchTrack(i, { hints: Array.from({length:3},(_,j) => j===index ? e.target.value : s.hints?.[j] ?? '').filter(Boolean) })} />)}{!readonly && <>
        <button className="secondary" disabled={busy} onClick={() => generateHints([i])}>✦ Сгенерировать для этой песни</button>
        <button disabled={busy || !editing.id} onClick={() => saveHints([i])}>Сохранить подсказки этой песни</button>
      </>}</div>)}
      </section>
    </>}
    {preview && <div className="modal-backdrop" onClick={() => setPreview(null)}><div className="modal panel" role="dialog" aria-modal="true" aria-label="Предпросмотр видео" onClick={e => e.stopPropagation()}><div className="modal-head"><h2>{preview.artist} — {preview.title}</h2><button aria-label="Закрыть" className="text-button" onClick={() => setPreview(null)}>✕</button></div><div className="video"><iframe title={`Предпросмотр ${preview.title}`} src={`https://www.youtube.com/embed/${preview.youtubeId}?start=${preview.startSeconds ?? 0}&playsinline=1`} allow="encrypted-media; picture-in-picture" allowFullScreen /></div><p className="muted">Начало: {preview.startSeconds ?? 0} сек. Проверь, что видео доступно и это нужная версия песни.</p></div></div>}
  </main>;
}
