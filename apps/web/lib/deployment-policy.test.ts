import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Vercel only auto-deploys the main branch', () => {
  const path = new URL('../vercel.json', import.meta.url);
  const config = JSON.parse(readFileSync(path, 'utf8')) as {
    git?: { deploymentEnabled?: Record<string, boolean> | boolean };
  };
  assert.deepEqual(config.git?.deploymentEnabled, { '**': false, main: true });
});
