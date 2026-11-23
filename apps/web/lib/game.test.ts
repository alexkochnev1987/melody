import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame, publicGame, roundPoints } from './game.ts';

const songs = [
  { id: 'a', title: 'Secret song', artist: 'Hidden artist', youtubeId: 'abcdefghijk', points: 50, category: 'Pop', hints: ['A joke about waiting', 'A suspicious dance floor', 'Almost a giveaway'] },
  { id: 'b', title: 'Other song', artist: 'Another artist', youtubeId: '12345678901', points: 30, category: 'Rock', hints: [] },
  { id: 'c', title: 'Final song', artist: 'Final artist', youtubeId: '12345abcdef', points: 20, category: 'Pop', hints: [] },
];
const cmd = (game: ReturnType<typeof createGame>, command: Parameters<typeof applyCommand>[1]) => applyCommand(game, command);
function playing() {
  let game = createGame('room', songs, 'owner');
  game = cmd(game, { type: 'join', id: 'join-1', playerId: 'one', name: 'Anna' });
  game = cmd(game, { type: 'join', id: 'join-2', playerId: 'two', name: 'Max' });
  game = cmd(game, { type: 'start', id: 'start' });
  return cmd(game, { type: 'playback', id: 'playback-start', songId: 'a', active: true });
}
test('correct answer gives chosen player the next pick and persists the score', () => {
  let game = playing();
  game = cmd(game, { type: 'buzz', id: 'buzz', songId: 'a', playerId: 'one' });
  game = cmd(game, { type: 'judge', id: 'judge', correct: true });
  assert.equal(game.chooserId, 'one');
  assert.equal(game.status, 'revealed');
  assert.equal(game.players[0].score, 50);
  assert.deepEqual(game.playedSongIds, ['a']);
  assert.equal(publicGame(game).board[0].played, true);
  assert.throws(() => cmd(game, { type: 'choose', id: 'bad', songId: 'b', playerId: 'two' }));
  game = cmd(game, { type: 'choose', id: 'pick', songId: 'c', playerId: 'one' });
  assert.equal(game.status, 'selected');
  assert.equal(game.songs[game.songIndex].id, 'c');
  assert.equal(publicGame(game).round, 2);
  assert.equal(publicGame(game).song.title, undefined);
  assert.throws(() => cmd(game, { type: 'choose', id: 'played', songId: 'a' }));
  game = cmd(game, { type: 'start', id: 'start2' });
  assert.equal(game.status, 'playing');
});
test('host can select a first song, skip and select a different one', () => {
  let game = createGame('room', songs);
  game = cmd(game, { type: 'choose', id: 'preselect', songId: 'c' });
  game = cmd(game, { type: 'join', id: 'j', playerId: 'one', name: 'Anna' });
  game = cmd(game, { type: 'start', id: 's' });
  game = cmd(game, { type: 'skip', id: 'skip' });
  assert.equal(game.chooserId, null);
  game = cmd(game, { type: 'choose', id: 'another', songId: 'a' });
  assert.equal(game.songIndex, 0);
  assert.equal(game.playedSongIds?.length, 1);
});
test('hints reveal only by host command and reduce available award', () => {
  let game = playing();
  assert.equal(JSON.stringify(publicGame(game)).includes('A joke'), false);
  game = cmd(game, { type: 'hint', id: 'hint' });
  assert.equal(roundPoints(game), 35);
  assert.deepEqual(publicGame(game).revealedHints, ['A joke about waiting']);
  game = cmd(game, { type: 'hint', id: 'hint2' });
  assert.equal(roundPoints(game), 25);
  game = cmd(game, { type: 'buzz', id: 'b', songId: 'a', playerId: 'one' });
  game = cmd(game, { type: 'judge', id: 'j', correct: true });
  assert.equal(game.players[0].score, 25);
  assert.equal(cmd(game, { type: 'judge', id: 'j', correct: true }), game);
});
test('finish records stable results and supports older games without new fields', () => {
  let game = playing();
  for (const id of ['a','b','c']) {
    if (game.status === 'revealed') {
      game = cmd(game, { type: 'choose', id: 'choose-'+id, songId: id });
      game = cmd(game, { type: 'start', id: 'start-'+id });
      game = cmd(game, { type: 'playback', id: 'playback-'+id, songId: id, active: true });
    }
    game = cmd(game, { type: 'buzz', id: 'buzz-'+id, songId: id, playerId: 'one' });
    game = cmd(game, { type: 'judge', id: 'judge-'+id, correct: true });
  }
  assert.equal(game.status, 'finished');
  assert.equal(game.scoreEvents.length, 3);
  assert.ok(game.endedAt);
  assert.equal(game.ownerId, 'owner');
  assert.equal(game.players[0].score, 100);
  const legacy = createGame('old', songs);
  delete legacy.playedSongIds;
  delete legacy.hintLevel;
  assert.equal(publicGame(legacy).board.length, 3);
});
test('invalid hint, duplicate names and repeat commands are rejected safely', () => {
  let game = playing();
  assert.throws(() => cmd(game,{type:'join',id:'same',playerId:'three',name:'anna'}), /имя уже занято/);
  assert.throws(() => cmd(game,{type:'choose',id:'wrong',songId:'b',playerId:'one'}));
  game = cmd(game,{type:'buzz',id:'buzz-1',playerId:'one',songId:'a'});
  assert.equal(cmd(game,{type:'buzz',id:'buzz-1',playerId:'one',songId:'a'}),game);
  game = cmd(game,{type:'judge',id:'bad',correct:false});
  assert.equal(game.blockedPlayerIds[0],'one');
  assert.throws(() => cmd(game,{type:'buzz',id:'again',playerId:'one',songId:'a'}));
});

test('STOP is rejected before playback, while paused, and after the track ends', () => {
  let game = createGame('room', songs);
  game = cmd(game, { type: 'join', id: 'join', playerId: 'one', name: 'Anna' });
  assert.throws(() => cmd(game, { type: 'buzz', id: 'early', playerId: 'one', songId: 'a' }));
  game = cmd(game, { type: 'start', id: 'start' });
  assert.equal(publicGame(game).playbackActive, false);
  assert.throws(() => cmd(game, { type: 'buzz', id: 'no-sound', playerId: 'one', songId: 'a' }));
  game = cmd(game, { type: 'playback', id: 'playing', songId: 'a', active: true });
  assert.equal(publicGame(game).playbackActive, true);
  game = cmd(game, { type: 'playback', id: 'pause', songId: 'a', active: false });
  assert.equal(publicGame(game).playbackActive, false);
  assert.throws(() => cmd(game, { type: 'buzz', id: 'on-pause', playerId: 'one', songId: 'a' }));
  game = cmd(game, { type: 'playback', id: 'resume-audio', songId: 'a', active: true });
  game = cmd(game, { type: 'buzz', id: 'valid', playerId: 'one', songId: 'a' });
  assert.equal(game.status, 'buzzed');
  assert.equal(game.playbackActive, false);
  assert.throws(() => cmd(game, { type: 'playback', id: 'late-on', songId: 'a', active: true }));
  game = cmd(game, { type: 'judge', id: 'incorrect', correct: false });
  assert.equal(game.playbackActive, false);
  assert.throws(() => cmd(game, { type: 'buzz', id: 'still-paused', playerId: 'two', songId: 'a' }));
});

test('stale YouTube events cannot activate a new song', () => {
  let game = playing();
  game = cmd(game, { type: 'skip', id: 'skip-first' });
  game = cmd(game, { type: 'choose', id: 'pick-second', songId: 'b' });
  game = cmd(game, { type: 'start', id: 'start-second' });
  assert.throws(() => cmd(game, { type: 'playback', id: 'old-song', songId: 'a', active: true }));
  assert.equal(game.playbackActive, false);
  game = cmd(game, { type: 'playback', id: 'second-sound', songId: 'b', active: true });
  assert.equal(game.playbackActive, true);
});
