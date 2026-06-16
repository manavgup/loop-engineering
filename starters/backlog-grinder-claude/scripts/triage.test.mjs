import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, toStateMarkdown } from './triage.mjs';

const ITEMS = [
  { id: 'a1', title: 'X', path: 'backend/a.py:1', effort: 'S', severity: 'critical', category: 'bug-fix', checked: false, stale: false },
  { id: 'b2', title: 'Y', path: 'backend/auth/b.py:2', effort: 'M', severity: 'critical', category: 'security', checked: false, stale: true },
  { id: 'c3', title: 'Z', path: 'backend/c.py:3', effort: 'L', severity: 'high', category: 'bug-fix', checked: false, stale: false },
  { id: 'e5', title: 'W', path: 'backend/auth/login.py:9', effort: 'S', severity: 'high', category: 'security', checked: false, stale: false },
];

test('summarize groups by severity x category and counts stale', () => {
  const s = summarize(ITEMS);
  assert.equal(s.total, 4);
  assert.equal(s.stale, 1);
  assert.equal(s.queueable, 3);
  assert.equal(s.bySeverity.critical, 2);
  assert.equal(s.byCategory['bug-fix'], 2);
});

test('toStateMarkdown queues non-stale, parks stale, flags injected denylist', () => {
  const md = toStateMarkdown(ITEMS, { projectName: 'T', deny: ['auth'] });
  assert.match(md, /# Loop State — T/);
  assert.match(md, /a1 — X/);
  assert.ok(!/- \[ \] b2 — Y/.test(md));            // stale, not queued
  assert.match(md, /Stale \/ needs human re-validation/);
  assert.match(md, /b2 — Y/);                        // present in stale section
  // non-stale auth item is queued AND flagged
  assert.match(md, /e5 — W \[DENYLIST: human gate\]/);
});
