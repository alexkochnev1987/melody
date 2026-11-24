import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyCommand, publicGame } from './game.ts';
import { summarizePlayerRooms } from './player-history.ts';
import { getGuestIdentity } from './guest-identity.ts';

const songs = [{ id:'track', title:'Secret song', artist:'Hidden artist', youtubeId:'abcdefghijk', points:50 }];

function guestRoom(room: string, hash: string, finished = false) {
  let game = createGame(room, songs, 'owner');
  game = applyCommand(game, { type: 'join', id:room+'-join', playerId:'one', name:'Anna', identityHash:hash });
  game = applyCommand(game, { type: 'join', id:room+'-other', playerId:'two', name:'Max' });
  game.startedAt = '2026-11-24T12:00:00.000Z';
  game.scoreEvents.push({ id:'win', playerId:'one', delta:50, songId:'track', reason:'Аукцион: правильный ответ' });
  game.players[0].score += 50;
  if (finished) {
    game.status='finished';
    game.endedAt='2026-11-24T12:20:00.000Z';
  }
  return game;
}

test('new guests get secure HttpOnly SameSite cookie; returning guests keep same identity', () => {
  const newGuest = getGuestIdentity(new Request('https://melody.example/api/profile'));
  assert.equal(newGuest.hash.length, 64);
  assert.match(newGuest.setCookie ?? '', /HttpOnly; SameSite=Lax; Secure/);
  assert.match(newGuest.setCookie ?? '', /Max-Age=31536000/);
  const cookie = newGuest.setCookie?.split(';')[0];
  const returning = getGuestIdentity(new Request('https://melody.example/api/profile', {
    headers: { cookie: `other=123; ${cookie}` },
  }));
  assert.equal(returning.hash, newGuest.hash);
  assert.equal(returning.setCookie, undefined);
  const invalid = getGuestIdentity(new Request('https://melody.example/api/profile',{
    headers:{cookie:'melody_guest_v1=invalid; other=abc'},
  }));
  assert.notEqual(invalid.hash, newGuest.hash);
  assert.ok(invalid.setCookie);
});

test('secret profile identity stays hidden from room and player snapshots', () => {
  const hash='a'.repeat(64);
  const game=guestRoom('AAA111',hash);
  assert.equal(game.identityHashes?.[hash],'one');
  assert.equal(JSON.stringify(publicGame(game)).includes(hash),false);
  assert.throws(()=>applyCommand(game,{type:'join',id:'double',playerId:'third',name:'Zoe',identityHash:hash}), /уже участвуешь/);
});

test('profile summary aggregates across rooms without mixing other guest players', () => {
  const own='b'.repeat(64), other='c'.repeat(64);
  const one=guestRoom('ROOM01',own,true);
  const two=guestRoom('ROOM02',own,true);
  const three=guestRoom('ROOM03',other,true);
  // A loss plus manual adjustment must be counted but not as a correct answer.
  two.scoreEvents.push({ id:'lost',playerId:'one',delta:-20,songId:'track',reason:'Аукцион: неправильный ответ' });
  two.players[0].score-=20;
  const summary=summarizePlayerRooms([
    {id:'ROOM01',state:one},{id:'ROOM02',state:two},{id:'ROOM03',state:three},
  ],own);
  assert.equal(summary.gamesPlayed,2);
  assert.equal(summary.completedGames,2);
  assert.equal(summary.wins,2);
  assert.equal(summary.correctAnswers,2);
  assert.equal(summary.pointsEarned,100);
  assert.equal(summary.pointsLost,20);
  assert.equal(summary.bestScore,350);
  assert.equal(summary.history.length,2);
  assert.equal(summary.history[1].score,330);
  assert.deepEqual(summary.history.map(r=>r.room),['ROOM01','ROOM02']);
  assert.equal(summary.history[0].name,'Anna');
});

test('no completed wins before a room finishes; ties do not count as wins', () => {
  const hash='d'.repeat(64);
  const game=guestRoom('ROOM04',hash,false);
  let summary=summarizePlayerRooms([{id:'ROOM04',state:game}],hash);
  assert.equal(summary.gamesPlayed,1);
  assert.equal(summary.completedGames,0);
  assert.equal(summary.wins,0);
  game.status='finished';
  game.players[1].score=game.players[0].score;
  summary=summarizePlayerRooms([{id:'ROOM04',state:game}],hash);
  assert.equal(summary.wins,0);
});

test('guest rooms from old versions remain valid without identity mapping', () => {
  const legacy=createGame('ROOM05',songs,'owner');
  delete legacy.identityHashes;
  const summary=summarizePlayerRooms([{id:'ROOM05',state:legacy}], 'a'.repeat(64));
  assert.equal(summary.history.length,0);
  assert.equal(summary.gamesPlayed,0);
});
