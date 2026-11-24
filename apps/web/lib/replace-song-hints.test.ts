import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceSongHints } from './replace-song-hints.ts';

const original = [
  { title: 'A', artist: 'First', youtubeId: 'abcdefghijk', points: 20, category: 'Pop', hints: ['old'] },
  { title: 'B', artist: 'Second', youtubeId: '12345678901', points: 30, category: 'Rock', hints: ['untouched'] },
];

test('saving one song preserves every field and hint of other songs', () => {
  const next = replaceSongHints(original, [{ index: 0, title: 'A', artist: 'First', youtubeId: 'abcdefghijk', hints: ['one','two','three'] }]);
  assert.deepEqual(next[1], original[1]);
  assert.deepEqual(next[0].hints, ['one','two','three']);
  assert.equal(next[0].points, 20);
  assert.deepEqual(original[0].hints, ['old']);
});
test('saving all hints changes only hints and preserves song metadata', () => {
  const next = replaceSongHints(original, [
    { index: 0, title: 'A', artist: 'First', youtubeId: 'abcdefghijk', hints: ['first'] },
    { index: 1, title: 'B', artist: 'Second', youtubeId: '12345678901', hints: ['second'] },
  ]);
  assert.deepEqual(next.map(s => s.hints), [['first'],['second']]);
  assert.deepEqual(next.map(({ hints, ...s }) => s), original.map(({ hints, ...s }) => s));
});
test('stale identities, out-of-range and duplicate indices do not save', () => {
  assert.throws(() => replaceSongHints(original, [{ index: 0, title: 'wrong', artist: 'First', youtubeId: 'abcdefghijk', hints: [] }]), /изменился/);
  assert.throws(() => replaceSongHints(original, [{ index: 100, title: 'A', artist: 'First', youtubeId: 'abcdefghijk', hints: [] }]), /изменился/);
  const u = { index: 0, title: 'A', artist: 'First', youtubeId: 'abcdefghijk', hints: [] };
  assert.throws(() => replaceSongHints(original, [u,u]), /несколько раз/);
});

test('saving chosen pregame hint affects only the one song', () => {
  const next = replaceSongHints(original, [{
    index: 0, title: 'A', artist: 'First', youtubeId: 'abcdefghijk',
    hints: ['option A', 'option B', 'option C'], introHint: 'option B',
  }]);
  assert.equal((next[0] as typeof next[0] & { introHint?: string }).introHint, 'option B');
  assert.equal(next[0].points, original[0].points);
  assert.deepEqual(next[1], original[1]);
});
