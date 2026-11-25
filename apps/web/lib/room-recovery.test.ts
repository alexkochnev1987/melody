import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyCommand } from './game.ts';
import { getGuestIdentity } from './guest-identity.ts';
import { findGuestPlayer } from './room-recovery.ts';

const songs = [{
  id: 'a', title: 'Song', artist: 'Artist', youtubeId: 'abcdefghijk', points: 20,
}];

test('returning guest recovers exactly their original room player and balance', () => {
  const guest = getGuestIdentity(new Request('https://melody.example/'));
  let game = createGame('A1B2C3', songs);
  game = applyCommand(game, {
    type: 'join', id: 'join', playerId: 'player-one', name: 'Alex',
    identityHash: guest.hash,
  });
  game = applyCommand(game, {
    type: 'adjust', id: 'bonus', playerId: 'player-one', delta: 70,
    reason: 'Scored correctly',
  });
  const found = findGuestPlayer(game, guest.hash);
  assert.deepEqual(found, { id: 'player-one', name: 'Alex', score: 370 });
  assert.equal(game.players.length, 1);
  assert.equal(findGuestPlayer(game, 'b'.repeat(64)), null);
  assert.equal(findGuestPlayer(game, 'invalid'), null);
});

test('legacy rooms without identity mapping cannot be claimed by another guest', () => {
  let old = createGame('A1B2C3', songs);
  old = applyCommand(old, {type:'join',id:'join',playerId:'old',name:'Alex'});
  assert.equal(findGuestPlayer(old, 'a'.repeat(64)), null);
  old.identityHashes = { ['a'.repeat(64)]: 'no-longer-exists' };
  assert.equal(findGuestPlayer(old, 'a'.repeat(64)), null);
});

test('recovery uses HttpOnly cookie secret; only its hash is stored on the server', () => {
  const req = new Request('https://melody.example/api/game');
  const identity = getGuestIdentity(req);
  const cookie = identity.setCookie?.split(';')[0] ?? '';
  const known = getGuestIdentity(new Request('https://melody.example/api/game', { headers: { cookie } }));
  assert.equal(identity.hash, known.hash);
  assert.equal(known.setCookie, undefined);
  assert.match(identity.setCookie ?? '', /HttpOnly; SameSite=Lax; Secure/);
});
