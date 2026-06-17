import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runItem, runQueue } from './driver.mjs';
import { markDone } from './state.mjs';

const DIFF = 'diff --git a/src/x.py b/src/x.py\n--- a/src/x.py\n+++ b/src/x.py\n@@ -10,1 +11,1 @@\n-a\n+b\n';

function baseDeps(over = {}) {
  return {
    implementer: async () => ({ ok: true }),
    verifier: async () => ({ verdict: 'APPROVE', reasons: [] }),
    runGate: async () => ({ passed: true, output: 'ok', infraError: false, coverage: { 'src/x.py': new Set([11]) } }),
    git: { diff: async () => DIFF, commit: async () => {}, restore: async () => {}, head: async () => 'sha1' },
    ...over,
  };
}
const item = (o = {}) => ({ id: 'i1', title: 'fix', path: 'src/x.py:11', status: 'pending', attempts: 0, failures: [], ...o });

test('PROOF 1: a no-test fix is rejected by coverage (changed line not executed)', async () => {
  const deps = baseDeps({ runGate: async () => ({ passed: true, output: 'ok', infraError: false, coverage: { 'src/x.py': new Set([99]) } }) });
  const r = await runItem(item(), { deps, state: { items: {} }, gateCmd: 'true', allow: ['src/x.py'], maxAttempts: 1 });
  assert.notEqual(r.status, 'done');
  assert.equal(r.failures[0].coverageOk, false);
});

test('PROOF 2: a signature-identical repeat escalates, not burns max attempts', async () => {
  const deps = baseDeps({ runGate: async () => ({ passed: false, output: 'AssertionError: nope', infraError: false }) });
  const it = item();
  // maxAttempts is 5, but the 2nd identical failure must abandon
  let r = await runItem(it, { deps, state: { items: {} }, gateCmd: 'false', allow: ['src/x.py'], maxAttempts: 5 });
  assert.equal(r.status, 'pending');
  r = await runItem(it, { deps, state: { items: {} }, gateCmd: 'false', allow: ['src/x.py'], maxAttempts: 5 });
  assert.equal(r.status, 'abandoned');
  assert.equal(r.attempts, 2); // escalated early, did not reach 5
});

test('PROOF 3: budget halts mid-queue after one item and checkpoints', async () => {
  let persisted = false;
  let committed = 0;
  // Keyed on commits completed, NOT ok() call-count — robust to extra budget checks.
  const deps = baseDeps({
    budget: { ok: () => committed < 1 },
    git: { diff: async () => DIFF, commit: async () => { committed += 1; }, restore: async () => {}, head: async () => 'sha1' },
    persistState: async () => { persisted = true; },
  });
  const queue = [item({ id: 'q1' }), item({ id: 'q2' })];
  await runQueue(queue, { deps, state: { items: {} }, gateCmd: 'true', allow: ['src/x.py'], maxAttempts: 1 });
  assert.equal(queue[0].status, 'done');    // first item completed (one commit)
  assert.equal(queue[1].status, 'pending'); // budget halted before the second
  assert.equal(queue[1].attempts, 0);       // q2 was never touched (discriminates halt from crash)
  assert.equal(persisted, true);            // checkpoint written
});

test('PROOF 4: resume skips an already-done item; reconcile handles a crash-commit', async () => {
  const state = { items: {} };
  markDone(state, { id: 'q1' }, 'sha-q1'); // q1 committed + marked in a prior run
  let ran = [];
  const deps = baseDeps({ implementer: async (it) => { ran.push(it.id); return { ok: true }; } });
  const queue = [item({ id: 'q1' }), item({ id: 'q2' })];
  await runQueue(queue, { deps, state, gateCmd: 'true', allow: ['src/x.py'], maxAttempts: 1 });
  assert.deepEqual(ran, ['q2']); // q1 skipped on resume, only q2 processed
});

test('PROOF 6: a coverage rejection is fed back into the retry prompt, and a covering retry commits', async () => {
  let attempt = 0;
  let sawCoverageFeedback = false;
  const deps = baseDeps({
    implementer: async (it, prompt) => { attempt += 1; if (/Coverage gap/i.test(prompt)) sawCoverageFeedback = true; return { ok: true }; },
    // attempt 1: changed line 11 NOT executed; attempt 2 (after the implementer adds a test): executed
    runGate: async () => ({ passed: true, output: 'ok', infraError: false, coverage: { 'src/x.py': new Set(attempt >= 2 ? [11] : [99]) } }),
  });
  const it = item();
  let r = await runItem(it, { deps, state: { items: {} }, gateCmd: 'true', allow: ['src/x.py'], maxAttempts: 3 });
  assert.equal(r.status, 'pending');            // attempt 1 rejected by coverage-of-change
  assert.equal(r.failures[0].coverageOk, false);
  r = await runItem(it, { deps, state: { items: {} }, gateCmd: 'true', allow: ['src/x.py'], maxAttempts: 3 });
  assert.equal(sawCoverageFeedback, true);      // the retry prompt named the uncovered lines
  assert.equal(r.status, 'done');               // the covering retry commits
});

test('PROOF 5: a green gate with NO coverage map halts the run AND restores the tree (§7)', async () => {
  let restored = 0;
  // green gate, but the gate emitted NO coverage map → CONFIG error, run-level halt.
  // §7 invariant: this is a non-commit path, so the implementer's diff must be reverted.
  const deps = baseDeps({
    runGate: async () => ({ passed: true, output: 'ok', infraError: false }), // no `coverage` field
    git: { diff: async () => DIFF, commit: async () => {}, restore: async () => { restored += 1; }, head: async () => 'sha1' },
  });
  const r = await runItem(item(), { deps, state: { items: {} }, gateCmd: 'true', allow: ['src/x.py'], maxAttempts: 1 });
  assert.equal(r.status, 'blocked-coverage-config');
  assert.equal(restored, 1); // §7: the non-commit path reverted the working tree
});
