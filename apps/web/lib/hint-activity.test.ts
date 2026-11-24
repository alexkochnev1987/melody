import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_HINTS, canStartHintTask, songHintKey } from './hint-activity.ts';

test('generating one song does not block work on another', () => {
  const pending = { [songHintKey(0)]: 'generate' as const };
  assert.equal(canStartHintTask(pending, songHintKey(0)), false);
  assert.equal(canStartHintTask(pending, songHintKey(1)), true);
  assert.equal(canStartHintTask(pending, ALL_HINTS), false);
});

test('saving one song blocks its own generation but not another song save', () => {
  const pending = { [songHintKey(3)]: 'save' as const };
  assert.equal(canStartHintTask(pending, songHintKey(3)), false);
  assert.equal(canStartHintTask(pending, songHintKey(2)), true);
});

test('bulk generation or bulk save blocks all per-song actions', () => {
  for (const operation of ['generate','save'] as const) {
    const pending = { all: operation };
    assert.equal(canStartHintTask(pending, songHintKey(0)), false);
    assert.equal(canStartHintTask(pending, songHintKey(99)), false);
    assert.equal(canStartHintTask(pending, ALL_HINTS), false);
  }
  assert.equal(canStartHintTask({}, ALL_HINTS), true);
});
