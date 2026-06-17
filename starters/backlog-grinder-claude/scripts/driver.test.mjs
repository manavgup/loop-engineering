import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runItem } from './driver.mjs';

function stubs(overrides = {}) {
  const calls = { commits: [], restores: [] };
  return {
    calls,
    deps: {
      implementer: async () => ({ ok: true, summary: 'edited' }),
      verifier: async () => ({ verdict: 'APPROVE', reasons: [] }),
      runGate: async () => ({ passed: true, output: 'ok', coverage: { 'backend/x.py': new Set([1]) } }),
      git: {
        diff: async () => 'diff --git a/backend/x.py b/backend/x.py\n--- a/backend/x.py\n+++ b/backend/x.py\n@@ -1 +1 @@\n-a\n+b\n',
        commit: async (cwd, msg) => calls.commits.push(msg),
        restore: async () => calls.restores.push(true),
        head: async () => 'sha1',
      },
      ...overrides.deps,
    },
  };
}

const ITEM = { id: 'x1', title: 'Fix X', path: 'backend/x.py:1', fix: 'do Y', status: 'pending', attempts: 0, failures: [] };

test('green gate + clean guards + APPROVE -> commit, status done', async () => {
  const { deps, calls } = stubs();
  const r = await runItem({ ...ITEM }, { deps, state: { items: {} }, gateCmd: 'true', allow: ['backend/x.py'], deny: [], maxAttempts: 3 });
  assert.equal(r.status, 'done');
  assert.equal(calls.commits.length, 1);
  assert.equal(calls.restores.length, 0);
});

test('red gate -> revert, record failure, stays pending under maxAttempts', async () => {
  const s = stubs();
  s.deps.runGate = async () => ({ passed: false, output: 'AssertionError' });
  const r = await runItem({ ...ITEM }, { deps: s.deps, state: { items: {} }, gateCmd: 'false', allow: ['backend/x.py'], deny: [], maxAttempts: 3 });
  assert.equal(r.status, 'pending');
  assert.equal(r.failures.length, 1);
  assert.equal(s.calls.restores.length, 1);
  assert.equal(s.calls.commits.length, 0);
});

test('guard violation (out of allowlist) -> revert, not committed', async () => {
  const s = stubs();
  const r = await runItem({ ...ITEM }, { deps: s.deps, state: { items: {} }, gateCmd: 'true', allow: ['backend/NOTHING.py'], deny: [], maxAttempts: 3 });
  assert.notEqual(r.status, 'done');
  assert.equal(s.calls.commits.length, 0);
  assert.equal(s.calls.restores.length, 1);
});

test('exhausting maxAttempts -> abandoned', async () => {
  const s = stubs();
  s.deps.runGate = async () => ({ passed: false, output: 'AssertionError' });
  const item = { ...ITEM, attempts: 2 };
  const r = await runItem(item, { deps: s.deps, state: { items: {} }, gateCmd: 'false', allow: ['backend/x.py'], deny: [], maxAttempts: 3 });
  assert.equal(r.status, 'abandoned');
});
