import type { Game } from './game';

export type PlayerRoom = { id: string; state: Game };
export type PlayerGameRow = {
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

export function summarizePlayerRooms(rooms: PlayerRoom[], identityHash: string) {
  const history: PlayerGameRow[] = [];
  let wins = 0;
  let gamesPlayed = 0;
  let completedGames = 0;
  let correctAnswers = 0;
  let bidsPlaced = 0;
  let pointsEarned = 0;
  let pointsLost = 0;
  let bestScore: number | null = null;

  for (const { id, state } of rooms) {
    const playerId = state.identityHashes?.[identityHash];
    const player = state.players.find(item => item.id === playerId);
    if (!player) continue;
    const isStarted = Boolean(state.startedAt);
    const isFinished = state.status === 'finished';
    if (isStarted) gamesPlayed++;
    if (isFinished) completedGames++;

    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const place = sorted.findIndex(item => item.id === player.id) + 1;
    if (isFinished && sorted[0]?.id === player.id && sorted.filter(item => item.score === player.score).length === 1) {
      wins++;
    }
    if (isStarted) bestScore = Math.max(bestScore ?? -Infinity, player.score);

    const events = state.scoreEvents.filter(event => event.playerId === player.id);
    const correct = events.filter(event =>
      /(?:^|:\\s)правильный ответ$/i.test(event.reason)).length;
    const bids = state.bidHistory?.filter(bid => bid.playerId === player.id).length ?? 0;
    const earned = events.reduce((sum, event) => sum + Math.max(0, event.delta), 0);
    const lost = events.reduce((sum, event) => sum + Math.max(0, -event.delta), 0);
    correctAnswers += correct;
    bidsPlaced += bids;
    pointsEarned += earned;
    pointsLost += lost;

    history.push({
      room: id,
      name: player.name,
      status: state.status,
      startedAt: state.startedAt ?? null,
      endedAt: state.endedAt ?? null,
      score: player.score,
      place,
      participants: state.players.length,
      correctAnswers: correct,
      bids,
      earned,
      lost,
      roundsPlayed: state.playedSongIds?.length ?? (state.songIndex + (['revealed','finished'].includes(state.status) ? 1 : 0)),
      totalRounds: state.songs.length,
    });
  }
  return {
    gamesPlayed,
    completedGames,
    wins,
    correctAnswers,
    bidsPlaced,
    pointsEarned,
    pointsLost,
    bestScore,
    history,
  };
}
