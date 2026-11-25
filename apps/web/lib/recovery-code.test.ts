import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyCommand, publicGame } from './game.ts';
import { issueRecoveryCode, verifyRecoveryCode, findRecoveryPlayer } from './recovery-code.ts';

const song = [{id:'a',title:'Song',artist:'Artist',youtubeId:'abcdefghijk',points:50}];

test('personal recovery code is unambiguous, case-insensitive, and room-bound', () => {
  const { code, credential } = issueRecoveryCode('ABC123',Date.UTC(2026,10,25));
  assert.match(code,/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
  assert.equal(credential.hash.length,64);
  assert.equal(verifyRecoveryCode('ABC123',code,credential,Date.UTC(2026,10,25)),true);
  assert.equal(verifyRecoveryCode('ABC123',code.toLowerCase(),credential,Date.UTC(2026,10,25)),true);
  assert.equal(verifyRecoveryCode('ABC123',code.replaceAll('-',''),credential,Date.UTC(2026,10,25)),true);
  assert.equal(verifyRecoveryCode('ABC123','0000-0000-0000',credential,Date.UTC(2026,10,25)),false);
  assert.equal(verifyRecoveryCode('ABC124',code,credential,Date.UTC(2026,10,25)),false);
  assert.equal(verifyRecoveryCode('ABC123',code,credential,Date.UTC(2026,11,4)),false);
});

test('recovery code maps only to the original player, never leaks to public snapshot', () => {
  let game=createGame('ABC123',song);
  game=applyCommand(game,{type:'join',id:'j1',name:'Alex',playerId:'alex'});
  game=applyCommand(game,{type:'join',id:'j2',name:'Max',playerId:'max'});
  const {code,credential}=issueRecoveryCode('ABC123');
  game.recoveryCredentials={alex:credential};
  assert.equal(findRecoveryPlayer(game,code),'alex');
  assert.equal(JSON.stringify(publicGame(game)).includes(credential.hash),false);
  assert.equal(JSON.stringify(publicGame(game)).includes(code),false);
  assert.equal(findRecoveryPlayer(game,'INVALID'),null);
  const rotated=issueRecoveryCode('ABC123');
  game.recoveryCredentials.alex=rotated.credential;
  assert.equal(findRecoveryPlayer(game,code),null);
  assert.equal(findRecoveryPlayer(game,rotated.code),'alex');
});

test('unknown and removed players cannot claim a recovery record', () => {
  const game=createGame('ABC123',song);
  const {code,credential}=issueRecoveryCode('ABC123');
  game.recoveryCredentials={old:credential};
  assert.equal(findRecoveryPlayer(game,code),null);
});
