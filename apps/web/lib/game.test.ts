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

test('only the host judges the winner after the full clip ends', () => {
  let g = prepared();
  assert.throws(() => exec(g,{type:'buzz',id:'winner-early',playerId:'one',songId:'a'}));
  assert.throws(() => exec(g,{type:'judge',id:'judge-early',correct:true}));
  g = exec(g,{type:'expire',id:'clip-end',songId:'a'});
  assert.equal(g.status,'awaitingJudgment');
  assert.equal(g.playbackActive,false);
  assert.equal(g.players[0].score,300);
  assert.equal(g.winnerId,'one');
  assert.equal(publicGame(g).roundResult,null);
  assert.equal(JSON.stringify(publicGame(g)).includes('Secret song'), false);
  assert.throws(()=>exec(g,{type:'judge',id:'other-person',correct:true,playerId:'two'}),/победителя/);
  g = exec(g,{type:'judge',id:'correct',correct:true});
  assert.equal(g.players[0].score,350);
  assert.equal(g.chooserId,'one');
  assert.equal(g.status,'revealed');
  assert.equal(publicGame(g).roundResult?.playerId,'one');
  assert.equal(publicGame(g).roundResult?.points,50);
  assert.equal(publicGame(g).song.title,'Secret song');
  assert.equal(g.scoreEvents.length,1);
  assert.throws(()=>exec(g,{type:'judge',id:'second-judgment',correct:false}));
});

test('wrong answer loses wager once and opens second-chance replay', () => {
  let g = prepared();
  g = exec(g,{type:'expire',id:'clip-end',songId:'a'});
  g = exec(g,{type:'judge',id:'wrong',correct:false});
  assert.equal(g.players[0].score,250);
  assert.equal(g.scoreEvents.length,1);
  assert.equal(g.status,'openAnswer');
  assert.equal(g.chooserId,null);
  assert.throws(()=>exec(g,{type:'buzz',id:'silent-stop',songId:'a',playerId:'two'}),/повторного воспроизведения/);
  g = exec(g,{type:'playback',id:'replay-play',songId:'a',active:true});
  assert.equal(hasActivePlayback(g),true);
  assert.throws(()=>exec(g,{type:'buzz',id:'bidder-retry',songId:'a',playerId:'one'}),/повторного воспроизведения/);
  g = exec(g,{type:'buzz',id:'new-player',songId:'a',playerId:'two'});
  assert.equal(g.status,'secondBuzzed');
  assert.equal(g.playbackActive,false);
  g = exec(g,{type:'judge',id:'second-correct',correct:true});
  assert.equal(g.players[1].score,350);
  assert.equal(g.players[0].score,250);
  assert.equal(g.scoreEvents.length,2);
  assert.deepEqual(g.scoreEvents.map(e=>e.reason),
    ['Аукцион: неправильный ответ','Второй шанс: правильный ответ']);
  assert.equal(g.chooserId,'two');
  assert.equal(publicGame(g).roundResult?.points,50);
  assert.equal(g.status,'revealed');
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

test('after a correct wager the winning player chooses the next song', () => {
  let g = prepared();
  g = exec(g,{type:'expire',id:'end',songId:'a'});
  g = exec(g,{type:'judge',id:'j',correct:true});
  g = exec(g,{type:'choose',id:'next-song',songId:'b',playerId:'one'});
  assert.equal(g.status,'bidding');
  assert.equal(g.currentBid,null);
  assert.equal(g.bidHistory?.length,1);
  assert.equal(publicGame(g).introHint,'Другая история');
  assert.equal(publicGame(g).board.find(x=>x.id==='a')?.played,true);
  assert.equal(publicGame(g).roundResult,null);
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

test('finished auction records loss only after host judgment, then reveal', () => {
  let g = createGame('room',[songs[0]],'owner');
  g = exec(g,{type:'join',id:'join',playerId:'one',name:'Anna'});
  g = exec(g,{type:'choose',id:'pick',songId:'a'});
  g = exec(g,{type:'bid',id:'bid',songId:'a',playerId:'one',points:60,seconds:2});
  g = exec(g,{type:'closeBidding',id:'close'});
  g = exec(g,{type:'start',id:'start'});
  g = exec(g,{type:'playback',id:'play',songId:'a',active:true});
  g = exec(g,{type:'expire',id:'expire',songId:'a'});
  assert.equal(g.status,'awaitingJudgment');
  assert.equal(g.players[0].score,300);
  g = exec(g,{type:'judge',id:'judge-wrong',correct:false});
  assert.equal(g.players[0].score,240);
  assert.equal(g.status,'openAnswer');
  g = exec(g,{type:'skip',id:'end-second-chance'});
  assert.equal(g.status,'finished');
  assert.equal(g.bidHistory?.length,1);
  assert.equal(g.scoreEvents.length,1);
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
  g = exec(g,{type:'expire',id:'clip-end',songId:'a'});
  g = exec(g,{type:'judge',id:'miss-all',correct:false});
  assert.equal(g.players[0].score,0);
  g = exec(g,{type:'skip',id:'skip-second-chance'});
  g = exec(g,{type:'choose',id:'next',songId:'b'});
  assert.throws(()=>exec(g,{type:'bid',id:'broke',songId:'b',playerId:'one',points:30,seconds:2}),/нужны очки/);
});

test('server serializes clip completion and judgment with no double awarding', () => {
  let g = prepared();
  assert.throws(()=>exec(g,{type:'judge',id:'early',correct:true}));
  g = exec(g,{type:'expire',id:'end',songId:'a'});
  assert.equal(g.scoreEvents.length,0);
  assert.throws(()=>exec(g,{type:'expire',id:'end-twice',songId:'a'}));
  g = exec(g,{type:'judge',id:'correct',correct:true});
  assert.equal(g.scoreEvents.length,1);
  assert.equal(g.players[0].score,350);
  assert.throws(()=>exec(g,{type:'judge',id:'wrong-after-correct',correct:false}));
  assert.equal(g.scoreEvents.length,1);
});

test('bidder cannot outbid their own leading offer, but may re-enter after someone else', () => {
  let g = auction();
  g = exec(g,{type:'bid',id:'first',songId:'a',playerId:'one',points:50,seconds:9});
  assert.throws(()=>exec(g,{type:'bid',id:'self',songId:'a',playerId:'one',points:80,seconds:8}),/собственную ставку/);
  assert.equal(g.bidHistory?.length,1);
  g = exec(g,{type:'bid',id:'other',songId:'a',playerId:'two',points:70,seconds:9});
  g = exec(g,{type:'bid',id:'return',songId:'a',playerId:'one',points:70,seconds:8});
  assert.equal(g.currentBid?.playerId,'one');
});

test('wrong second-chance answer resumes replay with no extra penalty; bidder remains excluded', () => {
  let g = prepared();
  g = exec(g,{type:'expire',id:'end',songId:'a'});
  g = exec(g,{type:'judge',id:'wrong',correct:false});
  g = exec(g,{type:'playback',id:'play-full',songId:'a',active:true});
  g = exec(g,{type:'buzz',id:'two-stop',songId:'a',playerId:'two'});
  assert.equal(g.status,'secondBuzzed');
  assert.throws(()=>exec(g,{type:'playback',id:'invalid-play',songId:'a',active:true}));
  g = exec(g,{type:'judge',id:'two-wrong',correct:false});
  assert.equal(g.status,'openAnswer');
  assert.deepEqual(g.scoreEvents.map(e=>e.delta),[-50]);
  g = exec(g,{type:'playback',id:'play-again',songId:'a',active:true});
  assert.throws(()=>exec(g,{type:'buzz',id:'bidder',songId:'a',playerId:'one'}));
  g = exec(g,{type:'buzz',id:'two-retry',songId:'a',playerId:'two'});
  g = exec(g,{type:'judge',id:'two-right',correct:true});
  assert.equal(g.players[1].score,350);
  assert.equal(g.status,'revealed');
  assert.equal(g.scoreEvents.length,2);
});

test('host can reveal answer without a winner if nobody guesses', () => {
  let g = prepared();
  g = exec(g,{type:'expire',id:'end',songId:'a'});
  g = exec(g,{type:'judge',id:'wrong',correct:false});
  g = exec(g,{type:'skip',id:'give-up'});
  assert.equal(g.status,'revealed');
  assert.equal(g.roundResult,null);
  assert.equal(publicGame(g).song.title,'Secret song');
  assert.equal(g.scoreEvents.length,1);
});

test('late playback and STOP events cannot spoil revealed answer or award twice', () => {
  let g = prepared();
  g = exec(g,{type:'expire',id:'end',songId:'a'});
  g = exec(g,{type:'judge',id:'right',correct:true});
  assert.throws(()=>exec(g,{type:'playback',id:'late',songId:'a',active:true}));
  assert.throws(()=>exec(g,{type:'buzz',id:'late-stop',songId:'a',playerId:'two'}));
  assert.deepEqual(g.scoreEvents.map(e=>e.delta),[50]);
});
