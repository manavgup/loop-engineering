import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, appendRecord } from './provenance.mjs';

const ITEM = { id: 'a1', title: 'Fix X', path: 'backend/x.py:46' };

test('makeRecord contains every §6 field for an approved item', () => {
  const rec = makeRecord(ITEM, {
    prompt: 'do the fix', attempts: [{ attempt: 1 }], gateOutput: 'ok',
    testsCollected: 12, coverage: { ok: true },
    guardResults: { coverage: true, scope: true, tamperWarnings: ['w'] },
    verifierVerdict: 'APPROVE', verifierRationale: ['looks good'],
    finalDiff: 'diff...', commitSha: 'abc123', lessonsApplied: ['l1'],
  }, () => '2026-06-16T00:00:00Z');
  assert.equal(rec.itemId, 'a1');
  assert.equal(rec.title, 'Fix X');
  assert.equal(rec.sourcePath, 'backend/x.py:46');
  assert.equal(rec.commitSha, 'abc123');
  assert.equal(rec.timestamp, '2026-06-16T00:00:00Z');
  assert.equal(rec.promptSent, 'do the fix');
  assert.deepEqual(rec.attempts, [{ attempt: 1 }]);
  assert.equal(rec.gateOutput, 'ok');
  assert.equal(rec.testsCollected, 12);
  assert.deepEqual(rec.coverageOfChange, { ok: true });
  assert.deepEqual(rec.guardResults, { coverage: true, scope: true, tamperWarnings: ['w'] });
  assert.equal(rec.verifierVerdict, 'APPROVE');
  assert.deepEqual(rec.verifierRationale, ['looks good']);
  assert.equal(rec.finalDiff, 'diff...');
  assert.deepEqual(rec.lessonsApplied, ['l1']);
});

test('appendRecord stores one record per commit, append-only', () => {
  let store = [];
  store = appendRecord(store, makeRecord(ITEM, { commitSha: 's1' }, () => 't'));
  store = appendRecord(store, makeRecord(ITEM, { commitSha: 's2' }, () => 't'));
  assert.equal(store.length, 2);
  assert.equal(store[0].commitSha, 's1');
  assert.equal(store[1].commitSha, 's2');
});
