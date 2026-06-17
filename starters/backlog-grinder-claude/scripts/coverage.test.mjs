import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedLines, checkCoverage, isBehavioral } from './coverage.mjs';

const DIFF = `diff --git a/src/x.py b/src/x.py
--- a/src/x.py
+++ b/src/x.py
@@ -10,2 +10,3 @@ def f():
 a = 1
+b = 2
 return a
`;

test('changedLines extracts added line numbers per file', () => {
  const m = changedLines(DIFF);
  assert.deepEqual([...m['src/x.py']], [11]);
});

test('isBehavioral exempts docs/config, flags source', () => {
  assert.equal(isBehavioral('src/x.py'), true);
  assert.equal(isBehavioral('README.md'), false);
  assert.equal(isBehavioral('config/app.yaml'), false);
});

test('checkCoverage fails when a changed source line was not executed', () => {
  const cov = { 'src/x.py': new Set([10, 12]) }; // 11 not covered
  const r = checkCoverage(DIFF, cov);
  assert.equal(r.ok, false);
  assert.match(r.uncovered[0].file, /x\.py/);
});

test('checkCoverage passes when changed lines were executed', () => {
  const cov = { 'src/x.py': new Set([10, 11, 12]) };
  assert.equal(checkCoverage(DIFF, cov).ok, true);
});
