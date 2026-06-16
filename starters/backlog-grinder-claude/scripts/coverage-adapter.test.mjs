import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLcov, parseCobertura } from './coverage-adapter.mjs';

test('parseLcov maps executed lines per file (count>0 only)', () => {
  const lcov = 'SF:src/x.js\nDA:1,1\nDA:2,0\nDA:3,5\nend_of_record\n';
  const c = parseLcov(lcov);
  assert.deepEqual([...c['src/x.js']].sort((a, b) => a - b), [1, 3]);
});

test('parseCobertura maps hit lines per file', () => {
  const xml = '<coverage><packages><package><classes>' +
    '<class filename="src/x.py"><lines>' +
    '<line number="10" hits="1"/><line number="11" hits="0"/><line number="12" hits="3"/>' +
    '</lines></class></classes></package></packages></coverage>';
  const c = parseCobertura(xml);
  assert.deepEqual([...c['src/x.py']].sort((a, b) => a - b), [10, 12]);
});
