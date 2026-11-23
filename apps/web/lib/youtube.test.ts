import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, titleLooksRelevant } from './youtube.ts';

test('accepts real YouTube links and rejects lookalike hosts', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeId('http://youtube.com/watch?v=dQw4w9WgXcQ'), null);
});
test('rejects unrelated compilation videos', () => {
  assert.equal(titleLooksRelevant('Destination Calabria', "2000s Best Dance Hits Vol.1"), false);
  assert.equal(titleLooksRelevant('Hung Up', 'Madonna - Hung Up (Official Video)'), true);
});
