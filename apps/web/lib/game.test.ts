import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame, publicGame } from './game.ts';

const song = { id: 'song-1', title: 'Secret song', artist: 'Secret artist', youtubeId: 'abcdefghijk', points: 25 };
function playing() {
  let game = createGame('room', [song]);
  game = applyCommand(game, { type: 'join', id: 'j1', playerId: 'p1', name: 'Alice' });
  game = applyCommand(game, { type: 'join', id: 'j2', playerId: 'p2', name: 'Bob' });
  return applyCommand(game, { type: 'start', id: 'start' });
}
test('first accepted buzz wins; repeated command is idempotent', () => {
  const initial = playing();
  const command = { type: 'buzz', id: 'buzz1', playerId: 'p1', songId: song.id } as const;
  const buzzed = applyCommand(initial, command);
  assert.equal(buzzed.winnerId, 'p1');
  assert.equal(applyCommand(buzzed, command), buzzed);
  assert.throws(() => applyCommand(buzzed, { type: 'buzz', id: 'buzz2', playerId: 'p2', songId: song.id }));
  assert.equal(initial.status, 'playing');
});
test('correct answer awards the song points once, optionally to another player', () => {
  const game = applyCommand(playing(), { type: 'buzz', id: 'buzz', playerId: 'p1', songId: song.id });
  const command = { type: 'judge', id: 'judge', correct: true, playerId: 'p2' } as const;
  const judged = applyCommand(game, command);
  assert.equal(judged.players[1].score, 25);
  assert.equal(applyCommand(judged, command).players[1].score, 25);
  assert.equal(judged.status, 'revealed');
});
test('incorrect answer blocks the player and permits others', () => {
  let game = applyCommand(playing(), { type: 'buzz', id: 'buzz', playerId: 'p1', songId: song.id });
  game = applyCommand(game, { type: 'judge', id: 'judge', correct: false });
  assert.throws(() => applyCommand(game, { type: 'buzz', id: 'again', playerId: 'p1', songId: song.id }));
  assert.equal(applyCommand(game, { type: 'buzz', id: 'other', playerId: 'p2', songId: song.id }).winnerId, 'p2');
});
test('public snapshot does not disclose answers or YouTube ID before reveal', () => {
  const snapshot = JSON.stringify(publicGame(playing()));
  assert.equal(snapshot.includes(song.title), false);
  assert.equal(snapshot.includes(song.artist), false);
  assert.equal(snapshot.includes(song.youtubeId), false);
});
test('preserves configured playback start and supplies zero for old songs', () => {
  const oldGame = createGame('room', [song]);
  assert.equal(oldGame.songs[0].startSeconds, 0);
  const newGame = createGame('room', [{ ...song, startSeconds: 75 }]);
  assert.equal(newGame.songs[0].startSeconds, 75);
  assert.equal(JSON.stringify(publicGame(newGame)).includes('startSeconds'), false);
  assert.throws(() => createGame('room', [{ ...song, startSeconds: -1 }]));
  assert.throws(() => createGame('room', [{ ...song, startSeconds: 1.5 }]));
});
test('requires at least one player before starting', () => {
  const room = createGame('room', [song]);
  assert.throws(() => applyCommand(room, { type: 'start', id: 'start' }), /хотя бы один игрок/);
  const joined = applyCommand(room, { type: 'join', id: 'join', playerId: 'p', name: 'Аня' });
  assert.equal(applyCommand(joined, { type: 'start', id: 'start' }).status, 'playing');
});
test('rejects duplicate names within one room regardless of case and spacing', () => {
  let room = createGame('room', [song]);
  room = applyCommand(room, { type: 'join', id: 'join1', playerId: 'p1', name: '  Анна   Мария  ' });
  assert.equal(room.players[0].name, 'Анна Мария');
  assert.throws(() => applyCommand(room, { type: 'join', id: 'join2', playerId: 'p2', name: 'анна мария' }), /имя уже занято/);
  const other = createGame('another-room', [song]);
  assert.equal(applyCommand(other, { type: 'join', id: 'join3', playerId: 'p3', name: 'Анна Мария' }).players.length, 1);
});
