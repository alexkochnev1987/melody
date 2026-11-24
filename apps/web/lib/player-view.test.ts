import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPlayerView, type PlayerSnapshot } from './player-view.ts';

const base: PlayerSnapshot = {
  status: 'lobby', round: 1, totalRounds: 5,
  players: [{ id: 'one', name: 'Anna', score: 20 }, { id: 'two', name: 'Max', score: 40 }],
  winnerId: null, playbackActive: true, blockedPlayerIds: [], song: { id: 'song', points: 30 },
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
  assert.equal(view({ status: 'playing', playbackActive: false }).canBuzz, false);
  assert.equal(view({ status: 'playing', playbackActive: false }).title, 'Ждём музыку');
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

test('auction bidder listens to timed clip without STOP', () => {
  const auctionState = { status: 'playing', auctionEnabled: true,
    currentBid: { playerId: 'two', points: 60, seconds: 5, commandId: 'bid-1' } };
  assert.equal(view(auctionState).canBuzz, false);
  assert.equal(view(auctionState).title, 'Слушает победитель торгов');
  assert.equal(getPlayerView({ ...base, ...auctionState }, 'two', true, false).canBuzz, false);
});
test('bidding screen does not allow STOP', () => {
  assert.equal(view({ status: 'bidding', auctionEnabled: true }).canBuzz, false);
  assert.equal(view({ status: 'bidding', auctionEnabled: true }).title, 'Аукцион открыт!');
});

test('the bidder receives a confirmed leading bid message and cannot buzz during judgment', () => {
  const bid = { playerId: 'one', points: 50, seconds: 3, commandId: 'bid-1' };
  assert.equal(view({ status: 'bidding', auctionEnabled: true, currentBid: bid }).title,'Ты лидируешь!');
  assert.equal(view({ status: 'awaitingJudgment', auctionEnabled: true, currentBid: bid }).title,'Назови свой ответ!');
  assert.equal(view({ status: 'awaitingJudgment', auctionEnabled: true, currentBid: bid }).canBuzz,false);
});

test('only other players can use STOP during an active second-chance replay', () => {
  const bid = { playerId: 'one', points: 50, seconds: 3, commandId: 'bid-1' };
  const snap = { status: 'openAnswer', auctionEnabled: true, currentBid: bid };
  assert.equal(view({ ...snap, playbackActive: true }).canBuzz,false);
  assert.equal(getPlayerView({ ...base,...snap,playbackActive:true },'two',true,false).canBuzz,true);
  assert.equal(getPlayerView({ ...base,...snap,playbackActive:false },'two',true,false).canBuzz,false);
  assert.equal(getPlayerView({ ...base,...snap,playbackActive:true },'two',false,false).canBuzz,false);
  assert.equal(view({ ...snap,status:'secondBuzzed',winnerId:'one' }).canBuzz,false);
});

test('correct answer is displayed to all players before the host opens selection', () => {
  const state = { status:'revealed',auctionEnabled:true,choiceOpen:false,chooserId:'one',
    roundResult:{playerId:'one',points:50},
    song:{id:'song',title:'Secret',artist:'Band',points:50} };
  const result = view(state);
  assert.equal(result.title,'Правильный ответ!');
  assert.equal(result.answer,'Band — Secret');
  assert.equal(result.canBuzz,false);
  assert.notEqual(result.title,'Теперь твой выбор!');
  assert.equal(view({...state,choiceOpen:true}).title,'Теперь твой выбор!');
});
