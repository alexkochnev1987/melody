import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createGame, publicGame, hasActivePlayback, playbackUsedMs, validateBid } from './game.ts';

const songs = [
  { id: 'a', title: 'Secret song', artist: 'Hidden artist', youtubeId: 'abcdefghijk', points: 50,
    category: 'Pop', introHint: 'Вас ждёт весёлая загадка', hints: ['old hint 1','old hint 2'] },
  { id: 'b', title: 'Other song', artist: 'Another artist', youtubeId: '12345678901', points: 30,
    category: 'Rock', introHint: 'Другая история' },
];
type G = ReturnType<typeof createGame>;
const exec = (g: G, cmd: Parameters<typeof applyCommand>[1]) => applyCommand(g, cmd);
function room() {
  let g = createGame('room', songs, 'owner');
  g = exec(g, { type: 'join', id: 'j1', playerId: 'one', name: 'Anna' });
  g = exec(g, { type: 'join', id: 'j2', playerId: 'two', name: 'Max' });
  return g;
}
function auction() {
  const g = exec(room(), { type: 'choose', id: 'pick', songId: 'a' });
  assert.equal(g.status, 'bidding');
  return g;
}
function prepared() {
  let g = auction();
  g = exec(g, { type: 'bid', id: 'first', songId: 'a', playerId: 'one', points: 50, seconds: 20 });
  g = exec(g, { type: 'closeBidding', id: 'close' });
  assert.equal(g.status, 'selected');
  g = exec(g, { type: 'start', id: 'start' });
  return exec(g, { type: 'playback', id: 'playing', songId: 'a', active: true });
}

test('new rooms require a selected song and closed auction to start', () => {
  let g = room();
  assert.throws(() => exec(g, { type: 'start', id: 'early' }), /выберите песню/);
  g = exec(g, { type: 'choose', id: 'pick', songId: 'a' });
  assert.equal(publicGame(g).introHint, 'Вас ждёт весёлая загадка');
  assert.equal(JSON.stringify(publicGame(g)).includes('Secret song'), false);
  assert.equal(JSON.stringify(publicGame(g)).includes('Hidden artist'), false);
  assert.equal(JSON.stringify(publicGame(g)).includes('abcdefghijk'), false);
  assert.throws(() => exec(g, { type: 'closeBidding', id: 'empty' }), /ставка/);
});

test('first bid accepts arbitrary integer seconds >=2 and points >=nominal', () => {
  validateBid(50, 2, 50);
  validateBid(50, 123456, 50);
  assert.throws(() => validateBid(50, 1, 50), /от 2/);
  assert.throws(() => validateBid(49, 3, 50), /от 50/);
  assert.throws(() => validateBid(50, 2.5, 50), /целое/);
  assert.throws(() => validateBid(100001, 10, 50), /100000/);
});

test('outbidding improves one or both dimensions and never worsens another', () => {
  let g = auction();
  g = exec(g, { type: 'bid', id: 'b1', songId: 'a', playerId: 'one', points: 50, seconds: 20 });
  g = exec(g, { type: 'bid', id: 'b2', songId: 'a', playerId: 'two', points: 60, seconds: 20 });
  assert.throws(() => exec(g, { type: 'bid', id: 'bad1', songId: 'a', playerId: 'one', points: 70, seconds: 21 }));
  assert.throws(() => exec(g, { type: 'bid', id: 'bad2', songId: 'a', playerId: 'one', points: 60, seconds: 20 }));
  assert.throws(() => exec(g, { type: 'bid', id: 'bad3', songId: 'a', playerId: 'one', points: 59, seconds: 19 }));
  g = exec(g, { type: 'bid', id: 'b3', songId: 'a', playerId: 'one', points: 60, seconds: 18 });
  assert.equal(g.currentBid?.playerId, 'one');
  assert.equal(g.currentBid?.seconds, 18);
  assert.equal(g.bidHistory?.length, 3);
  assert.equal(exec(g, { type: 'bid', id: 'b3', songId: 'a', playerId: 'one', points: 60, seconds: 18 }), g);
});

test('only winning bidder can buzz, the server does not trust player IDs', () => {
  let g = prepared();
  assert.throws(() => exec(g, { type: 'buzz', id: 'not-winner', playerId: 'two', songId: 'a' }), /недоступно/);
  g = exec(g, { type: 'buzz', id: 'winner', playerId: 'one', songId: 'a' });
  assert.equal(g.status, 'buzzed');
  assert.throws(() => exec(g, { type: 'judge', id: 'change', correct: true, playerId: 'two' }), /победителя/);
  g = exec(g, { type: 'judge', id: 'correct', correct: true });
  assert.equal(g.players.find(x=>x.id==='one')?.score, 50);
  assert.equal(g.chooserId, 'one');
  assert.deepEqual(g.playedSongIds,['a']);
  assert.equal(g.status, 'revealed');
});

test('wrong answer and expired listening time lose bid and finish the round', () => {
  let g = prepared();
  g = exec(g, { type: 'buzz', id: 'answer', playerId: 'one', songId: 'a' });
  g = exec(g, { type: 'judge', id: 'wrong', correct: false });
  assert.equal(g.players[0].score, -50);
  assert.equal(g.status, 'revealed');
  assert.equal(g.chooserId, null);
  assert.equal(g.scoreEvents.at(-1)?.reason, 'Аукцион: неправильный ответ');
  let timeout = prepared();
  timeout = exec(timeout,{type:'expire',id:'timeout',songId:'a'});
  assert.equal(timeout.players[0].score,-50);
  assert.equal(timeout.scoreEvents.at(-1)?.reason,'Аукцион: время истекло');
  assert.equal(timeout.status,'revealed');
  assert.throws(()=>exec(timeout,{type:'expire',id:'again',songId:'a'}));
});

test('host pause and reconnect do not reset listening time', () => {
  let g = prepared();
  g.playbackSegmentStartedAt = new Date(Date.now() - 3000).toISOString();
  g.playbackConfirmedAt = new Date().toISOString();
  assert.ok(playbackUsedMs(g) >= 2900);
  g = exec(g,{type:'playback',id:'pause',songId:'a',active:false});
  const used = g.playbackElapsedMs ?? 0;
  assert.ok(used >= 2900);
  g = exec(g,{type:'playback',id:'replay',songId:'a',active:true});
  assert.ok(playbackUsedMs(g) >= used);
  g = exec(g,{type:'playback',id:'heartbeat',songId:'a',active:true});
  assert.ok(playbackUsedMs(g) >= used);
  g.playbackConfirmedAt = new Date(Date.now() - 13000).toISOString();
  assert.equal(hasActivePlayback(g),false);
});

test('cannot reactivate STOP after time has elapsed or on another song', () => {
  let g = prepared();
  g.playbackElapsedMs = 20_000;
  g.playbackActive = false;
  assert.throws(()=>exec(g,{type:'buzz',id:'late',playerId:'one',songId:'a'}));
  assert.throws(()=>exec(g,{type:'playback',id:'old',active:true,songId:'b'}));
});

test('remaining songs return to bidding and preserve past bids and results', () => {
  let g = prepared();
  g = exec(g,{type:'buzz',id:'b',playerId:'one',songId:'a'});
  g = exec(g,{type:'judge',id:'j',correct:true});
  g = exec(g,{type:'choose',id:'next-song',songId:'b',playerId:'one'});
  assert.equal(g.status,'bidding');
  assert.equal(g.currentBid,null);
  assert.equal(g.bidHistory?.length,1);
  assert.equal(publicGame(g).introHint,'Другая история');
  assert.equal(publicGame(g).board.find(x=>x.id==='a')?.played,true);
});

test('legacy stored rooms continue with old start and STOP semantics', () => {
  let g = room();
  delete g.auctionEnabled;
  g = exec(g,{type:'start',id:'legacy-start'});
  g = exec(g,{type:'playback',id:'legacy-playing',songId:'a',active:true});
  g = exec(g,{type:'buzz',id:'legacy-buzz',playerId:'two',songId:'a'});
  g = exec(g,{type:'judge',id:'legacy-judge',correct:true});
  assert.equal(g.players[1].score,50);
  assert.equal(g.chooserId,'two');
});

test('finished auction records both stake and score results', () => {
  let g = createGame('room',[songs[0]],'owner');
  g = exec(g,{type:'join',id:'join',playerId:'one',name:'Anna'});
  g = exec(g,{type:'choose',id:'pick',songId:'a'});
  g = exec(g,{type:'bid',id:'bid',songId:'a',playerId:'one',points:60,seconds:2});
  g = exec(g,{type:'closeBidding',id:'close'});
  g = exec(g,{type:'start',id:'start'});
  g = exec(g,{type:'playback',id:'play',songId:'a',active:true});
  g = exec(g,{type:'expire',id:'expire',songId:'a'});
  assert.equal(g.status,'finished');
  assert.equal(g.players[0].score,-60);
  assert.equal(g.bidHistory?.length,1);
  assert.ok(g.endedAt);
});
