import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLcov, parseCobertura, coberturaSources, loadCoverage } from './coverage-adapter.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('loadCoverage remaps cobertura filenames against <source> to repo-relative paths', async () => {
  // coverage.py `--cov=mathy` from repo root /repo yields filename="ops.py" under source=/repo/mathy
  const dir = await mkdtemp(join(tmpdir(), 'bg-cov-'));
  const repoCwd = join(dir, 'repo');
  const xml =
    '<coverage><sources><source>' + join(repoCwd, 'mathy') + '</source></sources>' +
    '<packages><package><classes><class filename="ops.py"><lines>' +
    '<line number="2" hits="1"/></lines></class></classes></package></packages></coverage>';
  const file = join(dir, 'cov.xml');
  await writeFile(file, xml);
  assert.deepEqual(coberturaSources(xml), [join(repoCwd, 'mathy')]);
  const cov = loadCoverage({ format: 'cobertura', file, repoCwd });
  // key is now repo-relative 'mathy/ops.py', matching what `git diff` emits
  assert.ok(cov['mathy/ops.py'], 'expected repo-relative key mathy/ops.py');
  assert.deepEqual([...cov['mathy/ops.py']], [2]);
  await rm(dir, { recursive: true, force: true });
});
