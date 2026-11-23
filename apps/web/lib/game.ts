/** Pure game rules. Persist and serialize changes per room outside this module. */
export type Player = { id: string; name: string; score: number };
export type Song = { id: string; title: string; artist: string; youtubeId: string; points: number; startSeconds?: number };
export type Game = {
  id: string;
  revision: number;
  status: 'lobby' | 'playing' | 'buzzed' | 'revealed' | 'finished';
  songs: Song[];
  songIndex: number;
  players: Player[];
  winnerId: string | null;
  blockedPlayerIds: string[];
  scoreEvents: { id: string; playerId: string; delta: number; songId: string; reason: string }[];
  commandIds: string[];
};

export type Command =
  | { type: 'join'; id: string; playerId: string; name: string }
  | { type: 'start'; id: string }
  | { type: 'buzz'; id: string; playerId: string; songId: string }
  | { type: 'judge'; id: string; correct: boolean; playerId?: string }
  | { type: 'resume'; id: string }
  | { type: 'adjust'; id: string; playerId: string; delta: number; reason: string }
  | { type: 'next'; id: string };

export function createGame(id: string, songs: Song[]): Game {
  if (!id || songs.length === 0 || songs.some(s => !s.id || !s.title || !s.artist || !/^[\w-]{11}$/.test(s.youtubeId) || !Number.isSafeInteger(s.points) || s.points < 0 || !Number.isSafeInteger(s.startSeconds ?? 0) || (s.startSeconds ?? 0) < 0 || (s.startSeconds ?? 0) > 86400)) {
    throw new Error('Необходимо добавить хотя бы одну корректную песню с баллами и YouTube ID');
  }
  if (new Set(songs.map(s => s.id)).size !== songs.length) throw new Error('Повторяющийся идентификатор песни');
  return { id, revision: 0, status: 'lobby', songs: songs.map(song => ({ ...song, startSeconds: song.startSeconds ?? 0 })), songIndex: 0, players: [], winnerId: null, blockedPlayerIds: [], scoreEvents: [], commandIds: [] };
}

export function applyCommand(game: Game, command: Command): Game {
  if (!command.id || command.id.length > 128) throw new Error('Неверный идентификатор команды');
  if (game.commandIds.includes(command.id)) return game;
  const next = structuredClone(game);
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
  switch (command.type) {
    case 'join': {
      const name = command.name.normalize('NFKC').trim().replace(/\s+/g, ' ');
      if (next.status === 'finished' || !command.playerId || !name || name.length > 40 || next.players.some(p => p.id === command.playerId)) throw new Error('Невозможно добавить игрока');
      if (next.players.some(p => p.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) throw new Error('Это имя уже занято в комнате. Выберите другое.');
      next.players.push({ id: command.playerId, name, score: 0 });
      break;
    }
    case 'start':
      if (next.status !== 'lobby') throw new Error('Игра уже началась');
      if (next.players.length === 0) throw new Error('Для начала игры нужен хотя бы один игрок');
      next.status = 'playing';
      break;
    case 'buzz':
      player(command.playerId);
      if (next.status !== 'playing' || command.songId !== song.id || next.blockedPlayerIds.includes(command.playerId)) throw new Error('Нажатие недоступно');
      next.status = 'buzzed'; next.winnerId = command.playerId;
      break;
    case 'judge':
      if (next.status !== 'buzzed' || !next.winnerId) throw new Error('Нет ответа для оценки');
      if (command.correct) {
        award(command.playerId ?? next.winnerId, song.points, 'Правильный ответ');
        next.status = 'revealed';
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
    case 'next':
      if (next.status !== 'revealed') throw new Error('Сначала завершите раунд');
      if (next.songIndex + 1 >= next.songs.length) next.status = 'finished';
      else { next.songIndex++; next.status = 'playing'; }
      next.winnerId = null; next.blockedPlayerIds = [];
      break;
    default: {
      const exhaustive: never = command;
      throw new Error(`Неизвестная команда: ${exhaustive}`);
    }
  }
  next.commandIds.push(command.id);
  next.revision++;
  return next;
}

/** Player/display view intentionally excludes the answer and YouTube ID until revealed. */
export function publicGame(game: Game) {
  const song = game.songs[game.songIndex];
  return {
    id: game.id, revision: game.revision, status: game.status,
    round: game.songIndex + 1, totalRounds: game.songs.length,
    players: game.players, winnerId: game.winnerId, blockedPlayerIds: game.blockedPlayerIds,
    song: game.status === 'revealed' || game.status === 'finished'
      ? { id: song.id, points: song.points, title: song.title, artist: song.artist }
      : { id: song.id, points: song.points },
  };
}
