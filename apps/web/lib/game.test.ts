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
  assert.equal(g.players.find(x=>x.id==='one')?.score, 350);
  assert.equal(g.chooserId, 'one');
  assert.deepEqual(g.playedSongIds,['a']);
  assert.equal(g.status, 'revealed');
});

test('wrong answer and expired listening time lose bid and open a second chance', () => {
  let g = prepared();
  g = exec(g, { type: 'buzz', id: 'answer', playerId: 'one', songId: 'a' });
  g = exec(g, { type: 'judge', id: 'wrong', correct: false });
  assert.equal(g.players[0].score, 250);
  assert.equal(g.status, 'openAnswer');
  assert.equal(g.chooserId, null);
  assert.equal(g.playbackActive, false);
  assert.deepEqual(g.blockedPlayerIds, ['one']);
  assert.equal(g.scoreEvents.at(-1)?.reason, 'Аукцион: неправильный ответ');
  let timeout = prepared();
  timeout = exec(timeout,{type:'expire',id:'timeout',songId:'a'});
  assert.equal(timeout.players[0].score,250);
  assert.equal(timeout.scoreEvents.at(-1)?.reason,'Аукцион: время истекло');
  assert.equal(timeout.status,'openAnswer');
  assert.throws(()=>exec(timeout,{type:'expire',id:'again',songId:'a'}));
  timeout = exec(timeout,{type:'skip',id:'close-second-chance'});
  assert.equal(timeout.status,'revealed');
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
  const g = prepared();
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
  // Simulate a room saved before starting credits were introduced.
  g.players.forEach(p => { p.score = 0; });
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
  assert.equal(g.status,'openAnswer');
  g = exec(g,{type:'skip',id:'finish-after-second-chance'});
  assert.equal(g.status,'finished');
  assert.equal(g.players[0].score,240);
  assert.equal(g.bidHistory?.length,1);
  assert.ok(g.endedAt);
});

test('every participant receives 300 initial points by default and custom balance is preserved', () => {
  const newRoom = room();
  assert.equal(newRoom.startingPoints, 300);
  assert.deepEqual(newRoom.players.map(p => p.score), [300, 300]);
  let custom = createGame('custom', songs, undefined, 450);
  custom = exec(custom, { type: 'join', id: 'join-custom', playerId: 'new', name: 'New' });
  assert.equal(custom.players[0].score, 450);
  assert.equal(publicGame(custom).startingPoints, 450);
  assert.throws(() => createGame('bad', songs, undefined, 0), /от 1/);
  assert.throws(() => createGame('bad', songs, undefined, 1.5), /от 1/);
});

test('auction forbids wagering more than current balance or with zero points', () => {
  let game = auction();
  assert.throws(() => exec(game, { type: 'bid', id: 'too-high', songId: 'a',
    playerId: 'one', points: 301, seconds: 3 }), /Недостаточно очков/);
  game = exec(game, { type: 'adjust', id: 'reduce', playerId: 'one',
    delta: -300, reason: 'Test spend' });
  assert.throws(() => exec(game, { type: 'bid', id: 'empty', songId: 'a',
    playerId: 'one', points: 50, seconds: 3 }), /нужны очки/);
  assert.throws(() => exec(game, { type: 'bid', id: 'nominal', songId: 'a',
    playerId: 'two', points: 301, seconds: 3 }), /Недостаточно/);
  game = exec(game, { type: 'bid', id: 'full', songId: 'a',
    playerId: 'two', points: 300, seconds: 3 });
  assert.equal(game.currentBid?.points, 300);
  assert.throws(() => exec(game, { type: 'adjust', id: 'reduce-active', playerId: 'two',
    delta: -1, reason: 'Manual change' }), /ниже уже принятой ставки/);
});

test('losing an all-in wager leaves no bidding power in the following round', () => {
  let g = auction();
  g = exec(g,{type:'bid',id:'all-in',songId:'a',playerId:'one',points:300,seconds:2});
  g = exec(g,{type:'closeBidding',id:'close-all'});
  g = exec(g,{type:'start',id:'start-all'});
  g = exec(g,{type:'playback',id:'playing-all',songId:'a',active:true});
  g = exec(g,{type:'expire',id:'miss-all',songId:'a'});
  assert.equal(g.players[0].score,0);
  g = exec(g,{type:'skip',id:'pass-second-chance'});
  g = exec(g,{type:'choose',id:'next',songId:'b'});
  assert.throws(()=>exec(g,{type:'bid',id:'broke',songId:'b',playerId:'one',points:30,seconds:2}),/нужны очки/);
});

test('server serializes STOP versus expired wager to award or penalize only once', () => {
  let answer = prepared();
  answer = exec(answer,{type:'buzz',id:'buzz-first',songId:'a',playerId:'one'});
  assert.throws(()=>exec(answer,{type:'expire',id:'late-expire',songId:'a'}));
  answer = exec(answer,{type:'judge',id:'right',correct:true});
  assert.equal(answer.scoreEvents.length,1);
  let timedOut = prepared();
  timedOut = exec(timedOut,{type:'expire',id:'expire-first',songId:'a'});
  assert.equal(timedOut.status, 'openAnswer');
  timedOut = exec(timedOut,{type:'buzz',id:'second-buzz',songId:'a',playerId:'two'});
  assert.equal(timedOut.scoreEvents.length,1);
  assert.throws(()=>exec(timedOut,{type:'expire',id:'late-expire',songId:'a'}));
});

test('the leading bidder cannot outbid themselves, even with a better offer', () => {
  let game = auction();
  game = exec(game, { type: 'bid', id: 'first-bid', songId: 'a', playerId: 'one', points: 50, seconds: 12 });
  assert.throws(() => exec(game, { type: 'bid', id: 'self-bid', songId: 'a', playerId: 'one', points: 80, seconds: 10 }), /собственную ставку/);
  assert.equal(game.currentBid?.points, 50);
  assert.equal(game.bidHistory?.length, 1);
  game = exec(game, { type: 'bid', id: 'other-bid', songId: 'a', playerId: 'two', points: 60, seconds: 12 });
  game = exec(game, { type: 'bid', id: 'return-bid', songId: 'a', playerId: 'one', points: 60, seconds: 11 });
  assert.equal(game.currentBid?.playerId, 'one');
});

test('after a wrong wager the next player can press STOP with no audio and earn nominal points', () => {
  let game = prepared();
  game = exec(game, { type: 'buzz', id: 'wager-buzz', songId: 'a', playerId: 'one' });
  game = exec(game, { type: 'judge', id: 'wager-wrong', correct: false });
  assert.equal(game.status, 'openAnswer');
  assert.equal(game.players[0].score, 250);
  assert.throws(() => exec(game, { type: 'buzz', id: 'same-answer-again', songId: 'a', playerId: 'one' }), /недоступно/);
  assert.equal(game.playbackActive, false);
  game = exec(game, { type: 'buzz', id: 'second-chance-buzz', songId: 'a', playerId: 'two' });
  assert.equal(game.status, 'secondBuzzed');
  assert.equal(game.winnerId, 'two');
  assert.throws(() => exec(game, { type: 'judge', id: 'judge-other', correct: true, playerId: 'one' }), /ответившего/);
  game = exec(game, { type: 'judge', id: 'second-right', correct: true });
  assert.equal(game.status, 'revealed');
  assert.equal(game.players[0].score, 250);
  assert.equal(game.players[1].score, 350);
  assert.equal(game.scoreEvents.length, 2);
  assert.deepEqual(game.scoreEvents.map(e => e.reason), ['Аукцион: неправильный ответ', 'Второй шанс: правильный ответ']);
  assert.equal(game.chooserId, 'two');
  assert.throws(() => exec(game, { type: 'buzz', id: 'late', songId: 'a', playerId: 'one' }));
});

test('on timeout any player can press STOP, and repeated wrong answers do not cause new wager losses', () => {
  let game = prepared();
  game = exec(game, { type: 'expire', id: 'time-finished', songId: 'a' });
  assert.equal(game.status, 'openAnswer');
  assert.equal(game.playbackActive, false);
  game = exec(game, { type: 'buzz', id: 'second-one', songId: 'a', playerId: 'one' });
  game = exec(game, { type: 'judge', id: 'second-wrong', correct: false });
  assert.equal(game.status, 'openAnswer');
  assert.equal(game.scoreEvents.length, 1);
  assert.deepEqual(game.blockedPlayerIds, ['one']);
  assert.throws(() => exec(game, { type: 'buzz', id: 'retry', songId: 'a', playerId: 'one' }));
  game = exec(game, { type: 'buzz', id: 'second-two', songId: 'a', playerId: 'two' });
  game = exec(game, { type: 'judge', id: 'second-win', correct: true });
  assert.equal(game.players[0].score, 250);
  assert.equal(game.players[1].score, 350);
  assert.equal(game.status, 'revealed');
  assert.equal(game.scoreEvents.length, 2);
});

test('host can close second chance without any positive award', () => {
  let game = prepared();
  game = exec(game, { type: 'expire', id: 'timeout', songId: 'a' });
  game = exec(game, { type: 'skip', id: 'reveal' });
  assert.equal(game.status, 'revealed');
  assert.deepEqual(game.scoreEvents.map(e => e.delta), [-50]);
  assert.equal(game.chooserId, null);
});
