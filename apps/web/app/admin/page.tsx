'use client';
import { useCallback, useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Track = { title: string; artist: string; youtubeId: string; points: number; startSeconds?: number };
type GameSet = { id: string; owner_id: string | null; title: string; description: string; songs: Track[] };
type Viewer = { id: string; name: string; email: string };
type Catalog = { games: GameSet[]; user: Viewer | null; googleConfigured: boolean };

const blankSong = (): Track => ({ title: '', artist: '', youtubeId: '', points: 10, startSeconds: 0 });
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
  const refresh = useCallback(async () => {
    const res = await fetch('/api/sets', { cache: 'no-store' });
    if (!res.ok) throw new Error('Не удалось загрузить игры');
    setCatalog(await res.json());
  }, []);
  useEffect(() => { fetch('/api/sets', { cache: 'no-store' }).then(res => { if (!res.ok) throw new Error('Не удалось загрузить игры'); return res.json(); }).then(setCatalog).catch(e => setError(e.message)); }, []);
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
      setEditing({ ...editing, songs: [...editing.songs, ...data.songs.map((s: { title: string; artist: string; youtubeId: string }) => ({ title: s.title, artist: s.artist, youtubeId: s.youtubeId || '', points: 10, startSeconds: 0 }))] });
    });
  }
  const readonly = editing?.owner_id === null;
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
    </> : <>
      <button className="text-button back" onClick={() => setEditing(null)}>← Все игры</button><div className="catalog-head"><div><span className="eyebrow">{readonly ? 'ОБЩАЯ ИГРА · ТОЛЬКО ПРОСМОТР' : 'РЕДАКТОР ИГРЫ'}</span><h1>{editing.title || 'Новая игра'}</h1><p className="muted">Подготовь список песен и баллы до начала игры.</p></div><div className="editor-actions">{readonly ? <><button disabled={!catalog.user || busy} onClick={() => copy(editing.id)}>Скопировать к себе</button><button className="secondary" disabled={!catalog.user || busy} onClick={() => start(editing.id)}>Создать комнату</button></> : <><button disabled={busy} onClick={save}>Сохранить игру</button>{editing.id && <button className="secondary" disabled={busy || !editing.songs.length} onClick={() => start(editing.id)}>Создать комнату</button>}</>}</div></div>
      <section className="panel"><div className="editor-meta"><label>Название игры<input disabled={readonly} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Например, Вечеринка 2000-х" /></label><label>Описание<input disabled={readonly} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="Для кого и какое настроение" /></label></div>
      {!readonly && <div className="ai-box"><div className="ai-heading">✦ Добавить песни с AI</div><p className="muted">Опиши подборку. Проверенные варианты добавятся в таблицу; остальные можно найти вручную.</p><label>Пожелания<textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Например, танцевальные хиты 2000-х" /></label><div className="ai-actions"><label>Количество<input type="number" min="1" max="20" value={count} onChange={e => setCount(Number(e.target.value))} /></label><button className="secondary" disabled={busy || prompt.trim().length < 5} onClick={generate}>{busy ? 'Ищем…' : 'Подобрать песни'}</button></div></div>}
      <div className="table-heading"><div><span className="eyebrow">СОСТАВ ИГРЫ</span><h2>Песни · {editing.songs.length}</h2></div>{!readonly && <button className="secondary table-add" onClick={() => setEditing({ ...editing, songs: [...editing.songs, blankSong()] })}>+ Добавить песню</button>}</div>
      <div className="table-scroll"><table><thead><tr><th>№</th><th>Название</th><th>Исполнитель</th><th>YouTube ID</th><th>Начало, сек.</th><th>Баллы</th><th>Видео</th>{!readonly && <th>Порядок</th>}</tr></thead><tbody>{editing.songs.map((s, i) => <tr key={i}><td>{i+1}</td><td><input aria-label={`Название песни ${i+1}`} disabled={readonly} value={s.title} onChange={e => patchTrack(i, { title: e.target.value })} /></td><td><input aria-label={`Исполнитель ${i+1}`} disabled={readonly} value={s.artist} onChange={e => patchTrack(i, { artist: e.target.value })} /></td><td><input aria-label={`YouTube ID ${i+1}`} disabled={readonly} value={s.youtubeId} onChange={e => patchTrack(i, { youtubeId: e.target.value })} placeholder="11 символов" /></td><td><input className="points" aria-label={`Начало в секундах ${i+1}`} disabled={readonly} type="number" min="0" max="86400" step="1" value={s.startSeconds ?? 0} onChange={e => patchTrack(i, { startSeconds: Number(e.target.value) })} /></td><td><input className="points" aria-label={`Баллы ${i+1}`} disabled={readonly} type="number" min="0" max="100000" value={s.points} onChange={e => patchTrack(i, { points: Number(e.target.value) })} /></td><td>{/^[\w-]{11}$/.test(s.youtubeId) ? <button className="text-button" onClick={() => setPreview(s)}>▶ Посмотреть</button> : <a className="search-link" target="_blank" rel="noreferrer" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(s.artist + ' ' + s.title)}`}>Найти</a>}</td>{!readonly && <td><div className="row-actions"><button aria-label="Поднять песню" disabled={i === 0} onClick={() => moveTrack(i,-1)}>↑</button><button aria-label="Опустить песню" disabled={i === editing.songs.length-1} onClick={() => moveTrack(i,1)}>↓</button><button aria-label="Удалить песню" onClick={() => setEditing({ ...editing, songs: editing.songs.filter((_, n) => n !== i) })}>×</button></div></td>}</tr>)}</tbody></table>{editing.songs.length === 0 && <p className="muted">Пока нет песен. Добавь первую вручную или с помощью AI.</p>}</div></section>
    </>}
    {preview && <div className="modal-backdrop" onClick={() => setPreview(null)}><div className="modal panel" role="dialog" aria-modal="true" aria-label="Предпросмотр видео" onClick={e => e.stopPropagation()}><div className="modal-head"><h2>{preview.artist} — {preview.title}</h2><button aria-label="Закрыть" className="text-button" onClick={() => setPreview(null)}>✕</button></div><div className="video"><iframe title={`Предпросмотр ${preview.title}`} src={`https://www.youtube.com/embed/${preview.youtubeId}?start=${preview.startSeconds ?? 0}&playsinline=1`} allow="encrypted-media; picture-in-picture" allowFullScreen /></div><p className="muted">Начало: {preview.startSeconds ?? 0} сек. Проверь, что видео доступно и это нужная версия песни.</p></div></div>}
  </main>;
}
