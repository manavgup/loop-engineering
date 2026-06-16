import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signature, isRepeatedFailure, buildRetryPrompt, appendLesson, relevantLessons, retractLesson, makeLessonsAdapter } from './feedback.mjs';

test('signature normalizes volatile bits so repeats match', () => {
  const a = signature('FAILED tests/test_x.py::test_a at 0x7f12 in 1.23s');
  const b = signature('FAILED tests/test_x.py::test_a at 0x9ab0 in 4.56s');
  assert.equal(a, b);
});

test('isRepeatedFailure matches on full rejection fingerprint, not gate output alone', () => {
  const prev = [{ gateOutput: 'FAILED test_a at 0xAAAA in 1s', guardViolations: [], coverageUncovered: [] }];
  // volatile-only difference → same fingerprint → repeat
  assert.equal(isRepeatedFailure(prev, { gateOutput: 'FAILED test_a at 0xBBBB in 9s', guardViolations: [], coverageUncovered: [] }), true);
  // different gate output → different fingerprint
  assert.equal(isRepeatedFailure(prev, { gateOutput: 'FAILED test_z', guardViolations: [], coverageUncovered: [] }), false);
  // THE BUG WE FIXED: same green gate ('ok'), DIFFERENT coverage rejection → NOT a repeat
  const cov1 = { gateOutput: 'ok', guardViolations: [], coverageUncovered: ['src/x.py:11'] };
  const cov2 = { gateOutput: 'ok', guardViolations: [], coverageUncovered: ['src/x.py:42'] };
  assert.equal(isRepeatedFailure([cov1], cov2), false);
});

test('buildRetryPrompt embeds prior failure output', () => {
  const item = { title: 'Fix X', fix: 'do Y' };
  const p = buildRetryPrompt(item, 'BASE', [{ attempt: 1, gateOutput: 'AssertionError: nope' }]);
  assert.match(p, /BASE/);
  assert.match(p, /Attempt 1 failed/);
  assert.match(p, /AssertionError: nope/);
});

test('distinct numeric failures keep distinct signatures (no over-collapse)', () => {
  assert.notEqual(signature('expected 3 got 4'), signature('expected 3 got 99'));
  assert.notEqual(signature('x.py:46 failed'), signature('x.py:99 failed'));
});

test('appendLesson dedups by pattern', () => {
  let lessons = [];
  lessons = appendLesson(lessons, { pattern: 'SecretStr mask', fix: 'get_secret_value()' });
  lessons = appendLesson(lessons, { pattern: 'SecretStr mask', fix: 'get_secret_value()' });
  assert.equal(lessons.length, 1);
});

test('relevantLessons injects only category-matching lessons, ranked + capped', () => {
  const store = [
    { id: 'l1', pattern: 'p1', fix: 'f1', confidence: 3, category: 'bug-fix', status: 'active' },
    { id: 'l2', pattern: 'p2', fix: 'f2', confidence: 9, category: 'bug-fix', status: 'active' },
    { id: 'l3', pattern: 'p3', fix: 'f3', confidence: 5, category: 'security', status: 'active' },
  ];
  assert.deepEqual(relevantLessons(store, { category: 'bug-fix' }, 5).map((l) => l.id), ['l2', 'l1']);
  assert.equal(relevantLessons(store, { category: 'bug-fix' }, 1).length, 1); // capped
});

test('unrelated-category lesson is never injected', () => {
  const store = [{ id: 'l1', pattern: 'p', fix: 'f', confidence: 9, category: 'security', status: 'active' }];
  assert.deepEqual(relevantLessons(store, { category: 'bug-fix' }), []);
});

test('retractLesson drops confidence and evicts below threshold', () => {
  const store = [{ id: 'l1', pattern: 'p', fix: 'f', confidence: 1, category: 'bug-fix', status: 'active' }];
  retractLesson(store, 'l1');
  assert.equal(store[0].status, 'evicted');                              // 1 -> 0 -> evicted
  assert.equal(relevantLessons(store, { category: 'bug-fix' }).length, 0); // evicted not injected
});

test('lessons adapter relevant(item)/retract(item) match the driver contract', () => {
  const store = [{ id: 'l1', pattern: 'p', fix: 'f', confidence: 1, category: 'bug-fix', status: 'active' }];
  const adapter = makeLessonsAdapter(store, { cap: 5 });
  const item = { id: 'i1', category: 'bug-fix' };
  assert.deepEqual(adapter.relevant(item).map((l) => l.id), ['l1']); // injected for matching item
  adapter.retract(item);                                             // item failed attributably
  assert.equal(store[0].status, 'evicted');                          // applied lesson retracted + evicted
  assert.deepEqual(adapter.relevant({ id: 'i2', category: 'bug-fix' }), []); // no longer injected
});
