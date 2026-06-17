import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markDone, saveItem, rehydrate, pendingItems, reconcile } from './state.mjs';

test('markDone records sha and status (write AFTER commit)', () => {
  const s = { items: {} };
  markDone(s, { id: 'a1' }, 'deadbeef');
  assert.equal(s.items.a1.status, 'done');
  assert.equal(s.items.a1.commitSha, 'deadbeef');
});

test('pendingItems skips done/abandoned/stale, keeps pending', () => {
  const s = { items: { a1: { status: 'done' }, b2: { status: 'abandoned' } } };
  const q = [{ id: 'a1' }, { id: 'b2' }, { id: 'c3' }, { id: 'd4', stale: true }];
  assert.deepEqual(pendingItems(q, s).map((i) => i.id), ['c3']);
});

test('saveItem persists attempts+failures for a non-terminal item; rehydrate restores them', () => {
  const s = { items: {} };
  saveItem(s, { id: 'p1', status: 'pending', attempts: 2, failures: [{ attempt: 1 }, { attempt: 2 }] });
  const queue = [{ id: 'p1' }]; // freshly parsed: attempts:0, failures:[]
  rehydrate(queue, s);
  assert.equal(queue[0].attempts, 2);
  assert.equal(queue[0].failures.length, 2);
  assert.equal(queue[0].status, 'pending');
});

test('reconcile marks an in-flight item done if HEAD advanced past last recorded', () => {
  const s = { items: {}, lastGoodSha: 'old' };
  reconcile(s, { id: 'x9' }, 'newsha', 'old'); // crash between commit and marker
  assert.equal(s.items.x9.status, 'done');
  assert.equal(s.items.x9.commitSha, 'newsha');
});
