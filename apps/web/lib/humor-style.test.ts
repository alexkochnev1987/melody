import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanHumorGuide, humorStyleSchema } from './humor-style.ts';

test('style accepts only supported modes', () => {
  assert.equal(humorStyleSchema.parse('conversational'), 'conversational');
  assert.equal(humorStyleSchema.parse('absurd'), 'absurd');
  assert.equal(humorStyleSchema.safeParse('reveal-the-title').success, false);
});

test('every humor style requires natural short jokes and avoids robotic intros', () => {
  for (const style of humorStyleSchema.options) {
    const prompt = humanHumorGuide(style);
    assert.match(prompt, /разговорным русским/);
    assert.match(prompt, /Варианты для одной песни должны отличаться идеей/);
    assert.match(prompt, /канцелярита/);
    assert.match(prompt, /AI/);
  }
});
