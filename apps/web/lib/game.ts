/** Pure game rules. The route serializes every command in a Postgres transaction. */
export type Player = { id: string; name: string; score: number };
export type Song = { id: string; title: string; artist: string; youtubeId: string; points: number; startSeconds?: number; category?: string; hints?: string[]; introHint?: string };
export type ScoreEvent = { id: string; playerId: string; delta: number; songId: string; reason: string };
export type Bid = { playerId: string; points: number; seconds: number; songId: string; commandId: string };
export type Game = {
  id: string;
  revision: number;
  status: 'lobby' | 'bidding' | 'selected' | 'playing' | 'buzzed' | 'revealed' | 'finished';
  songs: Song[];
  songIndex: number;
  players: Player[];
  winnerId: string | null;
  blockedPlayerIds: string[];
  scoreEvents: ScoreEvent[];
  commandIds: string[];
  playedSongIds?: string[];
  chooserId?: string | null;
  hintLevel?: number;
  playbackActive?: boolean;
  playbackConfirmedAt?: string;
  playbackElapsedMs?: number;
  playbackSegmentStartedAt?: string;
  /** Missing on older rooms: retain their original buzzer rules until completion. */
  auctionEnabled?: boolean;
  currentBid?: Bid | null;
  bidHistory?: Bid[];
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
  | { type: 'bid'; id: string; songId: string; playerId: string; points: number; seconds: number }
  | { type: 'closeBidding'; id: string }
  | { type: 'expire'; id: string; songId: string }
  | { type: 'playback'; id: string; songId: string; active: boolean }
  | { type: 'skip'; id: string }
  | { type: 'next'; id: string }
  /** Compatibility with existing rooms created before the new single-hint rules. */
  | { type: 'hint'; id: string };

export const PLAYBACK_LEASE_MS = 12000;
export const MIN_BID_SECONDS = 2;
export const MAX_BID_POINTS = 100000;

/** With buffering or host disconnect the recorded playing segment stops at the last host lease. */
export function playbackUsedMs(game: Game, now = Date.now()): number {
  const accrued = game.playbackElapsedMs ?? 0;
  if (!game.playbackActive || !game.playbackSegmentStartedAt) return accrued;
  const started = Date.parse(game.playbackSegmentStartedAt);
  const lastSeen = Date.parse(game.playbackConfirmedAt ?? '');
  if (!Number.isFinite(started) || !Number.isFinite(lastSeen)) return accrued;
  return accrued + Math.max(0, Math.min(now, lastSeen + PLAYBACK_LEASE_MS) - started);
}

export function hasActivePlayback(game: Game, now = Date.now()): boolean {
  const confirmedAt = Date.parse(game.playbackConfirmedAt ?? '');
  const leaseValid = game.playbackActive === true && Number.isFinite(confirmedAt) &&
    confirmedAt <= now && now - confirmedAt < PLAYBACK_LEASE_MS;
  return leaseValid && (!game.auctionEnabled || !game.currentBid ||
    playbackUsedMs(game, now) < game.currentBid.seconds * 1000);
}

export function playedIds(game: Game): string[] {
  if (game.playedSongIds) return game.playedSongIds;
  const count = game.songIndex + (game.status === 'revealed' || game.status === 'finished' ? 1 : 0);
  return game.songs.slice(0, count).map(song => song.id);
}

export function roundPoints(game: Game): number {
  if (game.auctionEnabled && game.currentBid) return game.currentBid.points;
  const hintFactors = [1, 0.7, 0.5, 0.3];
  return Math.max(0, Math.round(game.songs[game.songIndex].points *
    hintFactors[Math.min(3, game.hintLevel ?? 0)]));
}

export function validateBid(points: number, seconds: number, nominal: number, previous?: Bid | null): void {
  if (!Number.isSafeInteger(points) || points < nominal || points > MAX_BID_POINTS) {
    throw new Error(`Ставка — от ${nominal} до ${MAX_BID_POINTS} очков`);
  }
  if (!Number.isSafeInteger(seconds) || seconds < MIN_BID_SECONDS) {
    throw new Error('Время прослушивания — целое число от 2 секунд');
  }
  if (previous && (points < previous.points || seconds > previous.seconds ||
    (points === previous.points && seconds === previous.seconds))) {
    throw new Error('Чтобы перебить: очки не меньше, время не больше; хотя бы одно значение лучше');
  }
}

export function createGame(id: string, songs: Song[], ownerId?: string): Game {
  if (!id || !songs.length || songs.some(s =>
    !s.id || !s.title || !s.artist || !/^[\w-]{11}$/.test(s.youtubeId) ||
    !Number.isSafeInteger(s.points) || s.points < 0 || s.points > MAX_BID_POINTS ||
    !Number.isSafeInteger(s.startSeconds ?? 0) || (s.startSeconds ?? 0) < 0 || (s.startSeconds ?? 0) > 86400 ||
    (s.category !== undefined && (!s.category.trim() || s.category.length > 60)) ||
    (s.introHint !== undefined && s.introHint.length > 220) ||
    (s.hints !== undefined && (s.hints.length > 3 || s.hints.some(h => !h.trim() || h.length > 220)))
  )) throw new Error('Необходимо добавить корректные песни, категории и подсказки');
  if (new Set(songs.map(s => s.id)).size !== songs.length) throw new Error('Повторяющийся идентификатор песни');
  return {
    id, revision: 0, status: 'lobby',
    songs: songs.map(s => ({ ...s, startSeconds: s.startSeconds ?? 0,
      category: s.category?.trim() || 'Разное', hints: s.hints ?? [],
      introHint: s.introHint?.trim() || s.hints?.[0] || '' })),
    songIndex: 0, players: [], winnerId: null, blockedPlayerIds: [],
    scoreEvents: [], commandIds: [], playedSongIds: [], chooserId: null,
    hintLevel: 0, playbackActive: false, auctionEnabled: true,
    currentBid: null, bidHistory: [], playbackElapsedMs: 0,
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
  next.playbackActive ??= false;
  const song = next.songs[next.songIndex];

  const player = (id: string) => {
    const found = next.players.find(p => p.id === id);
    if (!found) throw new Error('Игрок не найден');
    return found;
  };
  const award = (playerId: string, delta: number, reason: string) => {
    const target = player(playerId);
    if (!Number.isSafeInteger(delta) || Math.abs(delta) > MAX_BID_POINTS ||
      !Number.isSafeInteger(target.score + delta)) throw new Error('Неверное количество баллов');
    target.score += delta;
    next.scoreEvents.push({ id: command.id, playerId, delta, songId: song.id, reason });
  };
  const resetClip = () => {
    next.playbackActive = false;
    next.playbackConfirmedAt = undefined;
    next.playbackSegmentStartedAt = undefined;
    next.playbackElapsedMs = 0;
  };
  const markPlayed = () => {
    if (!next.playedSongIds!.includes(song.id)) next.playedSongIds!.push(song.id);
  };
  const completeRound = (chooserId: string | null) => {
    markPlayed();
    next.winnerId = null;
    next.blockedPlayerIds = [];
    next.chooserId = chooserId;
    resetClip();
    if (next.playedSongIds!.length === next.songs.length) {
      next.status = 'finished';
      next.endedAt = new Date().toISOString();
    } else next.status = 'revealed';
  };

  switch (command.type) {
    case 'join': {
      const name = command.name.normalize('NFKC').trim().replace(/\s+/g, ' ');
      if (next.status === 'finished' || !command.playerId || !name || name.length > 40 ||
        next.players.some(p => p.id === command.playerId)) throw new Error('Невозможно добавить игрока');
      if (next.players.some(p => p.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) throw new Error('Это имя уже занято в комнате. Выберите другое.');
      next.players.push({ id: command.playerId, name, score: 0 });
      break;
    }
    case 'choose': {
      const allowed = next.auctionEnabled ? ['lobby', 'revealed', 'bidding'] : ['lobby', 'revealed', 'selected'];
      if (!allowed.includes(next.status) || (next.status === 'bidding' && next.currentBid)) {
        throw new Error('Сейчас нельзя выбрать песню');
      }
      const index = next.songs.findIndex(s => s.id === command.songId);
      if (index < 0 || next.playedSongIds.includes(command.songId)) throw new Error('Песня уже сыграна или недоступна');
      if (command.playerId && command.playerId !== next.chooserId) throw new Error('Сейчас выбирает другой игрок');
      next.songIndex = index;
      next.status = next.auctionEnabled ? 'bidding' : 'selected';
      next.chooserId = null;
      next.hintLevel = 0;
      next.currentBid = null;
      resetClip();
      next.winnerId = null;
      next.blockedPlayerIds = [];
      break;
    }
    case 'bid': {
      if (!next.auctionEnabled || next.status !== 'bidding' || command.songId !== song.id) {
        throw new Error('Торги сейчас недоступны');
      }
      player(command.playerId);
      validateBid(command.points, command.seconds, song.points, next.currentBid);
      const bid = { playerId: command.playerId, points: command.points, seconds: command.seconds,
        songId: song.id, commandId: command.id };
      next.currentBid = bid;
      next.bidHistory ??= [];
      next.bidHistory.push(bid);
      break;
    }
    case 'closeBidding':
      if (!next.auctionEnabled || next.status !== 'bidding' || !next.currentBid) {
        throw new Error('Для закрытия аукциона нужна хотя бы одна ставка');
      }
      next.status = 'selected';
      break;
    case 'start':
      if (next.auctionEnabled) {
        if (next.status !== 'selected' || !next.currentBid) throw new Error('Сначала выберите песню и завершите торги');
      } else if (next.status !== 'lobby' && next.status !== 'selected') {
        throw new Error('Раунд уже начался');
      }
      if (!next.players.length) throw new Error('Для начала игры нужен хотя бы один игрок');
      next.status = 'playing';
      resetClip();
      next.startedAt ??= new Date().toISOString();
      break;
    case 'playback': {
      if (command.songId !== song.id) throw new Error('Сигнал воспроизведения относится к другой песне');
      if (command.active && next.status !== 'playing') throw new Error('Нельзя включить STOP до начала раунда');
      if (next.playbackActive) {
        next.playbackElapsedMs = playbackUsedMs(next);
        next.playbackSegmentStartedAt = undefined;
      }
      next.playbackActive = command.active && next.status === 'playing';
      next.playbackConfirmedAt = next.playbackActive ? new Date().toISOString() : undefined;
      if (next.playbackActive) {
        // Heartbeats may not reset the timer while playback is continuous.
        if (game.playbackActive && game.playbackSegmentStartedAt) {
          next.playbackSegmentStartedAt = game.playbackSegmentStartedAt;
          next.playbackElapsedMs = game.playbackElapsedMs ?? 0;
        } else next.playbackSegmentStartedAt = new Date().toISOString();
      }
      break;
    }
    case 'buzz':
      player(command.playerId);
      if (next.status !== 'playing' || !hasActivePlayback(next) || command.songId !== song.id ||
        next.blockedPlayerIds.includes(command.playerId) ||
        (next.auctionEnabled && next.currentBid?.playerId !== command.playerId)) {
        throw new Error('Нажатие недоступно');
      }
      next.status = 'buzzed';
      next.winnerId = command.playerId;
      next.playbackActive = false;
      break;
    case 'judge':
      if (next.status !== 'buzzed' || !next.winnerId) throw new Error('Нет ответа для оценки');
      if (next.auctionEnabled) {
        if (!next.currentBid || next.winnerId !== next.currentBid.playerId ||
          (command.playerId && command.playerId !== next.currentBid.playerId)) {
          throw new Error('Оценить можно только победителя аукциона');
        }
        award(next.currentBid.playerId, command.correct ? roundPoints(next) : -roundPoints(next),
          command.correct ? 'Аукцион: правильный ответ' : 'Аукцион: неправильный ответ');
        completeRound(command.correct ? next.currentBid.playerId : null);
      } else if (command.correct) {
        const correctId = command.playerId ?? next.winnerId;
        award(correctId, roundPoints(next), 'Правильный ответ');
        completeRound(correctId);
      } else {
        next.blockedPlayerIds.push(next.winnerId);
        next.winnerId = null;
        next.status = 'playing';
        next.playbackActive = false;
      }
      break;
    case 'expire':
      if (!next.auctionEnabled || next.status !== 'playing' || command.songId !== song.id ||
        !next.currentBid) throw new Error('Сейчас нельзя завершить прослушивание');
      award(next.currentBid.playerId, -next.currentBid.points, 'Аукцион: время истекло');
      completeRound(null);
      break;
    case 'resume':
      if (next.auctionEnabled || next.status !== 'buzzed') throw new Error('Продолжение раунда недоступно');
      next.winnerId = null;
      next.status = 'playing';
      next.playbackActive = false;
      break;
    case 'adjust':
      if (!command.reason.trim() || command.reason.length > 200) throw new Error('Укажите причину изменения баллов');
      award(command.playerId, command.delta, command.reason.trim());
      break;
    case 'hint':
      if (next.auctionEnabled || next.status !== 'playing') throw new Error('Дополнительные подсказки отключены');
      if (next.hintLevel >= Math.min(3, song.hints?.length ?? 0)) throw new Error('Больше подсказок нет');
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
      next.status = next.auctionEnabled ? 'bidding' : 'selected';
      next.chooserId = null;
      next.currentBid = null;
      next.hintLevel = 0;
      resetClip();
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

/** Player and TV snapshots must never reveal upcoming titles or the YouTube ID. */
export function publicGame(game: Game) {
  const song = game.songs[game.songIndex];
  const played = playedIds(game);
  const revealed = game.status === 'revealed' || game.status === 'finished';
  const currentRound = played.length + (revealed ? 0 : 1);
  const isPreparation = game.status === 'bidding' || game.status === 'selected';
  return {
    id: game.id, revision: game.revision, status: game.status,
    auctionEnabled: game.auctionEnabled === true,
    currentBid: game.auctionEnabled ? game.currentBid ?? null : null,
    bidHistory: game.auctionEnabled ? game.bidHistory ?? [] : [],
    round: Math.min(game.songs.length, Math.max(1, currentRound)), totalRounds: game.songs.length,
    players: game.players, winnerId: game.winnerId, chooserId: game.chooserId ?? null,
    blockedPlayerIds: game.blockedPlayerIds, playbackActive: hasActivePlayback(game),
    remainingSeconds: game.auctionEnabled && game.currentBid ?
      Math.max(0, game.currentBid.seconds - playbackUsedMs(game) / 1000) : null,
    board: game.songs.map(s => ({
      id: s.id, category: s.category || 'Разное', points: s.points,
      played: played.includes(s.id), selected: s.id === song.id && isPreparation,
    })),
    hintLevel: game.auctionEnabled ? 0 : game.hintLevel ?? 0,
    revealedHints: game.auctionEnabled ? [] : song.hints?.slice(0, game.hintLevel ?? 0) ?? [],
    introHint: game.auctionEnabled && isPreparation ? song.introHint?.trim() || song.hints?.[0] || '' : null,
    song: revealed
      ? { id: song.id, points: song.points, availablePoints: roundPoints(game), title: song.title,
          artist: song.artist, category: song.category || 'Разное' }
      : { id: song.id, points: song.points, availablePoints: roundPoints(game), category: song.category || 'Разное' },
  };
}
