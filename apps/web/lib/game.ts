/** Pure game rules. All commands are persisted transactionally by the route handler. */
export type Player = { id: string; name: string; score: number };
export type Song = { id: string; title: string; artist: string; youtubeId: string; points: number; startSeconds?: number; category?: string; hints?: string[] };
export type ScoreEvent = { id: string; playerId: string; delta: number; songId: string; reason: string };
export type Game = {
  id: string;
  revision: number;
  status: 'lobby' | 'selected' | 'playing' | 'buzzed' | 'revealed' | 'finished';
  songs: Song[];
  songIndex: number;
  players: Player[];
  winnerId: string | null;
  blockedPlayerIds: string[];
  scoreEvents: ScoreEvent[];
  commandIds: string[];
  /** Optional for old rooms saved before category selection was introduced. */
  playedSongIds?: string[];
  chooserId?: string | null;
  hintLevel?: number;
  ownerId?: string;
  startedAt?: string;
  endedAt?: string;
};

export type Command =
  | { type: 'join'; id: string; playerId: string; name: string }
  | { type: 'start'; id: string }
  | { type: 'buzz'; id: string; playerId: string; songId: string }
  | { type: 'judge'; id: string; correct: boolean; playerId?: string }
  | { type: 'resume'; id: string }
  | { type: 'adjust'; id: string; playerId: string; delta: number; reason: string }
  | { type: 'choose'; id: string; songId: string; playerId?: string }
  | { type: 'hint'; id: string }
  | { type: 'skip'; id: string }
  | { type: 'next'; id: string };

export const MAX_HINTS = 3;
const hintFactors = [1, 0.7, 0.5, 0.3];

export function playedIds(game: Game): string[] {
  if (game.playedSongIds) return game.playedSongIds;
  const count = game.songIndex + (game.status === 'revealed' || game.status === 'finished' ? 1 : 0);
  return game.songs.slice(0, count).map(song => song.id);
}

export function roundPoints(game: Game): number {
  return Math.max(0, Math.round(game.songs[game.songIndex].points * hintFactors[Math.min(MAX_HINTS, game.hintLevel ?? 0)]));
}

export function createGame(id: string, songs: Song[], ownerId?: string): Game {
  if (!id || !songs.length || songs.some(s =>
    !s.id || !s.title || !s.artist || !/^[\w-]{11}$/.test(s.youtubeId) ||
    !Number.isSafeInteger(s.points) || s.points < 0 || s.points > 100000 ||
    !Number.isSafeInteger(s.startSeconds ?? 0) || (s.startSeconds ?? 0) < 0 || (s.startSeconds ?? 0) > 86400 ||
    (s.category !== undefined && (!s.category.trim() || s.category.length > 60)) ||
    (s.hints !== undefined && (s.hints.length > MAX_HINTS || s.hints.some(h => !h.trim() || h.length > 220)))
  )) throw new Error('Необходимо добавить корректные песни, категории и подсказки');
  if (new Set(songs.map(s => s.id)).size !== songs.length) throw new Error('Повторяющийся идентификатор песни');
  return {
    id, revision: 0, status: 'lobby',
    songs: songs.map(s => ({ ...s, startSeconds: s.startSeconds ?? 0, category: s.category?.trim() || 'Разное', hints: s.hints ?? [] })),
    songIndex: 0, players: [], winnerId: null, blockedPlayerIds: [],
    scoreEvents: [], commandIds: [], playedSongIds: [], chooserId: null, hintLevel: 0,
    ...(ownerId ? { ownerId } : {}),
  };
}

export function applyCommand(game: Game, command: Command): Game {
  if (!command.id || command.id.length > 128) throw new Error('Неверный идентификатор команды');
  if (game.commandIds.includes(command.id)) return game;
  const next = structuredClone(game);
  next.playedSongIds = playedIds(next);
  next.chooserId ??= null;
  next.hintLevel ??= 0;
  const song = next.songs[next.songIndex];
  const player = (id: string) => {
    const found = next.players.find(p => p.id === id);
    if (!found) throw new Error('Игрок не найден');
    return found;
  };
  const award = (playerId: string, delta: number, reason: string) => {
    const target = player(playerId);
    if (!Number.isSafeInteger(delta) || Math.abs(delta) > 100000 || !Number.isSafeInteger(target.score + delta)) throw new Error('Неверное количество баллов');
    target.score += delta;
    next.scoreEvents.push({ id: command.id, playerId, delta, songId: song.id, reason });
  };
  const markPlayed = () => {
    if (!next.playedSongIds!.includes(song.id)) next.playedSongIds!.push(song.id);
  };
  const completeRound = (chooserId: string | null) => {
    markPlayed();
    next.winnerId = null;
    next.blockedPlayerIds = [];
    next.chooserId = chooserId;
    if (next.playedSongIds!.length === next.songs.length) {
      next.status = 'finished';
      next.endedAt = new Date().toISOString();
    } else {
      next.status = 'revealed';
    }
  };
  switch (command.type) {
    case 'join': {
      const name = command.name.normalize('NFKC').trim().replace(/\s+/g, ' ');
      if (next.status === 'finished' || !command.playerId || !name || name.length > 40 || next.players.some(p => p.id === command.playerId)) throw new Error('Невозможно добавить игрока');
      if (next.players.some(p => p.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) throw new Error('Это имя уже занято в комнате. Выберите другое.');
      next.players.push({ id: command.playerId, name, score: 0 });
      break;
    }
    case 'start':
      if (next.status !== 'lobby' && next.status !== 'selected') throw new Error('Раунд уже начался');
      if (!next.players.length) throw new Error('Для начала игры нужен хотя бы один игрок');
      next.status = 'playing';
      next.startedAt ??= new Date().toISOString();
      break;
    case 'buzz':
      player(command.playerId);
      if (next.status !== 'playing' || command.songId !== song.id || next.blockedPlayerIds.includes(command.playerId)) throw new Error('Нажатие недоступно');
      next.status = 'buzzed'; next.winnerId = command.playerId;
      break;
    case 'judge':
      if (next.status !== 'buzzed' || !next.winnerId) throw new Error('Нет ответа для оценки');
      if (command.correct) {
        const correctId = command.playerId ?? next.winnerId;
        award(correctId, roundPoints(next), 'Правильный ответ');
        completeRound(correctId);
      } else {
        next.blockedPlayerIds.push(next.winnerId);
        next.winnerId = null;
        next.status = 'playing';
      }
      break;
    case 'resume':
      if (next.status !== 'buzzed') throw new Error('Пауза недоступна');
      next.winnerId = null; next.status = 'playing';
      break;
    case 'adjust':
      if (!command.reason.trim() || command.reason.length > 200) throw new Error('Укажите причину изменения баллов');
      award(command.playerId, command.delta, command.reason.trim());
      break;
    case 'choose': {
      if (!['lobby', 'revealed', 'selected'].includes(next.status)) throw new Error('Сейчас нельзя выбрать песню');
      const index = next.songs.findIndex(s => s.id === command.songId);
      if (index < 0 || next.playedSongIds.includes(command.songId)) throw new Error('Песня уже сыграна или недоступна');
      if (command.playerId && command.playerId !== next.chooserId) throw new Error('Сейчас выбирает другой игрок');
      next.songIndex = index;
      next.status = 'selected';
      next.chooserId = null;
      next.hintLevel = 0;
      next.winnerId = null;
      next.blockedPlayerIds = [];
      break;
    }
    case 'hint':
      if (next.status !== 'playing') throw new Error('Подсказки доступны только во время мелодии');
      if (next.hintLevel >= Math.min(MAX_HINTS, song.hints?.length ?? 0)) throw new Error('Больше подсказок нет');
      next.hintLevel++;
      break;
    case 'skip':
      if (next.status !== 'playing' && next.status !== 'buzzed') throw new Error('Нельзя пропустить этот раунд');
      completeRound(null);
      break;
    case 'next': {
      if (next.status !== 'revealed') throw new Error('Сначала завершите раунд');
      const index = next.songs.findIndex(s => !next.playedSongIds!.includes(s.id));
      if (index < 0) throw new Error('Все песни уже сыграны');
      next.songIndex = index;
      next.status = 'selected';
      next.chooserId = null;
      next.hintLevel = 0;
      next.winnerId = null;
      next.blockedPlayerIds = [];
      break;
    }
    default: {
      const exhaustive: never = command;
      throw new Error(`Неизвестная команда: ${exhaustive}`);
    }
  }
  next.commandIds.push(command.id);
  next.revision++;
  return next;
}

/** Never leak upcoming titles, YouTube IDs, or unrevealed hints into a player/display snapshot. */
export function publicGame(game: Game) {
  const song = game.songs[game.songIndex];
  const played = playedIds(game);
  const revealed = game.status === 'revealed' || game.status === 'finished';
  const currentRound = played.length + (revealed ? 0 : 1);
  return {
    id: game.id, revision: game.revision, status: game.status,
    round: Math.min(game.songs.length, Math.max(1, currentRound)), totalRounds: game.songs.length,
    players: game.players, winnerId: game.winnerId, chooserId: game.chooserId ?? null,
    blockedPlayerIds: game.blockedPlayerIds,
    board: game.songs.map(s => ({
      id: s.id, category: s.category || 'Разное', points: s.points,
      played: played.includes(s.id), selected: s.id === song.id && game.status === 'selected',
    })),
    hintLevel: game.hintLevel ?? 0,
    revealedHints: song.hints?.slice(0, game.hintLevel ?? 0) ?? [],
    song: revealed
      ? { id: song.id, points: song.points, availablePoints: roundPoints(game), title: song.title, artist: song.artist, category: song.category || 'Разное' }
      : { id: song.id, points: song.points, availablePoints: roundPoints(game), category: song.category || 'Разное' },
  };
}
