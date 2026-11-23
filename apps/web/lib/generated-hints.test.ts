import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { cleanGeneratedHints, generatedHintsSchema } from './generated-hints.ts';

test('OpenAI output schema uses fixed object fields, not unsupported tuple prefixItems', () => {
  const wireSchema = z.toJSONSchema(generatedHintsSchema);
  const json = JSON.stringify(wireSchema);
  for (const forbidden of ['prefixItems', 'minItems', 'maxItems', 'minLength', 'maxLength']) {
    assert.equal(json.includes(`"${forbidden}"`), false, `Unsupported OpenAI keyword: ${forbidden}`);
  }
  assert.match(json, /"first"/);
  assert.match(json, /"second"/);
  assert.match(json, /"third"/);
  assert.equal((wireSchema as { type?: string }).type, 'object');
});

test('a generated hint response is decoded into exactly three edited inputs', () => {
  const result = generatedHintsSchema.parse({ songs: [{ index: 0, hints: {
    first: 'Шутка про опоздание',
    second: 'На вечеринке не хватает часов',
    third: 'Очень неудобно ждать на танцполе',
  } }] });
  assert.deepEqual(cleanGeneratedHints(result.songs[0].hints, 'Hung Up', 'Madonna'), [
    'Шутка про опоздание', 'На вечеринке не хватает часов', 'Очень неудобно ждать на танцполе',
  ]);
});

test('missing, empty, oversized, and spoiler hints are rejected without clearing saved values', () => {
  assert.equal(cleanGeneratedHints(undefined, 'A', 'B'), null);
  assert.equal(cleanGeneratedHints({ first: '', second: 'Вторая', third: 'Третья' }, 'A', 'B'), null);
  assert.equal(cleanGeneratedHints({ first: 'x'.repeat(221), second: 'Вторая', third: 'Третья' }, 'A', 'B'), null);
  assert.equal(cleanGeneratedHints({ first: 'Madonna снова танцует', second: 'Вторая', third: 'Третья' }, 'Hung Up', 'Madonna'), null);
});
