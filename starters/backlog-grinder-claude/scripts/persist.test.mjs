import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, makeStatePersister, makeProvenanceWriter } from './persist.mjs';

test('loadState returns empty shape when file is missing', () => {
  assert.deepEqual(loadState(join(tmpdir(), `bg-nope-${process.pid}.json`)), { items: {} });
});

test('state persister round-trips through disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bg-state-'));
  const p = join(dir, 'state.json');
  const save = makeStatePersister(p);
  await save({ items: { a1: { status: 'done', attempts: 1, failures: [], commitSha: 's' } }, lastGoodSha: 's' });
  const loaded = loadState(p);
  assert.equal(loaded.items.a1.status, 'done');
  assert.equal(loaded.lastGoodSha, 's');
  await rm(dir, { recursive: true, force: true });
});

test('provenance writer appends one JSONL record per commit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bg-prov-'));
  const p = join(dir, 'provenance.jsonl');
  const write = makeProvenanceWriter(p);
  await write({ itemId: 'a1', commitSha: 's1' });
  await write({ itemId: 'a2', commitSha: 's2' });
  const lines = (await readFile(p, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).commitSha, 's1');
  assert.equal(JSON.parse(lines[1]).itemId, 'a2');
  await rm(dir, { recursive: true, force: true });
});
