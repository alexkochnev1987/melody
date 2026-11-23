import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPlayerView, type PlayerSnapshot } from './player-view.ts';

const base: PlayerSnapshot = {
  status: 'lobby', round: 1, totalRounds: 5,
  players: [{ id: 'one', name: 'Anna', score: 20 }, { id: 'two', name: 'Max', score: 40 }],
  winnerId: null, blockedPlayerIds: [], song: { id: 'song', points: 30 },
};
const view = (state: Partial<PlayerSnapshot> = {}, connected = true, busy = false) =>
  getPlayerView({ ...base, ...state }, 'one', connected, busy);

test('personal score and rank update without changing server state', () => {
  const result = view();
  assert.equal(result.score, 20);
  assert.equal(result.rank, 2);
  assert.equal(result.playersCount, 2);
  assert.deepEqual(base.players.map(p => p.name), ['Anna', 'Max']);
});

test('STOP is enabled only when the player can answer', () => {
  assert.equal(view({ status: 'playing' }).canBuzz, true);
  assert.equal(view({ status: 'playing', blockedPlayerIds: ['one'] }).canBuzz, false);
  assert.equal(view({ status: 'playing' }, false).canBuzz, false);
  assert.equal(view({ status: 'playing' }, true, true).canBuzz, false);
  assert.equal(view({ status: 'buzzed', winnerId: 'one' }).canBuzz, false);
});

test('pending state never claims player was first before server confirmation', () => {
  const pending = view({ status: 'playing' }, true, true);
  assert.equal(pending.title, 'Отправляем сигнал…');
  assert.equal(pending.canBuzz, false);
  assert.equal(view({ status: 'buzzed', winnerId: 'one' }).title, 'Ты первый!');
  assert.notEqual(view({ status: 'buzzed', winnerId: 'two' }).title, 'Ты первый!');
});

test('song answer is hidden until the round has been revealed', () => {
  const song = { id: 'song', points: 30, title: 'Secret', artist: 'Band' };
  assert.equal(view({ status: 'playing', song }).answer, null);
  assert.equal(view({ status: 'buzzed', song }).answer, null);
  assert.equal(view({ status: 'revealed', song }).answer, 'Band — Secret');
  assert.equal(view({ status: 'finished', song }).answer, 'Band — Secret');
});
