import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runItem } from './driver.mjs';

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }); }

test('E2E: stub implementer fixes a file, real gate passes, driver commits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bg-e2e-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name', 't');
  await mkdir(join(dir, 'src'), { recursive: true });
  // BROKEN source: gate is "node check" which requires VALUE === 2
  await writeFile(join(dir, 'src/x.js'), 'export const VALUE = 1;\n');
  await writeFile(join(dir, 'check.mjs'), "import {VALUE} from './src/x.js'; process.exit(VALUE===2?0:1);\n");
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');

  const item = { id: 'e1', title: 'set VALUE to 2', path: 'src/x.js:1', fix: 'VALUE = 2', status: 'pending', attempts: 0, failures: [] };
  const deps = {
    implementer: async () => { await writeFile(join(dir, 'src/x.js'), 'export const VALUE = 2;\n'); return { ok: true }; },
    verifier: async () => ({ verdict: 'APPROVE', reasons: [] }),
    runGate: async (cmd, cwd) => {
      // green gate must carry a coverage map; the changed line (src/x.js:1) is covered
      try { execFileSync('node', ['check.mjs'], { cwd }); return { passed: true, output: 'ok', coverage: { 'src/x.js': new Set([1]) } }; }
      catch (e) { return { passed: false, output: String(e.stderr || e) }; }
    },
    git: {
      // Canonical diff: stage EVERYTHING (incl. untracked) then diff the index, so guards
      // see exactly what commit will commit. `git diff HEAD` alone misses untracked adds.
      diff: async (cwd) => { git(cwd, 'add', '-A'); return git(cwd, 'diff', '--cached', 'HEAD'); },
      commit: async (cwd, msg) => { git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', msg); },
      head: async (cwd) => git(cwd, 'rev-parse', 'HEAD').trim(), // required by the v2 driver
      // §7 git safety invariant: reset to last-good-commit AND clean untracked
      restore: async (cwd) => { git(cwd, 'reset', '-q', '--hard', 'HEAD'); git(cwd, 'clean', '-fdq'); },
    },
  };

  process.chdir(dir);
  const r = await runItem(item, { deps, state: { items: {} }, gateCmd: 'node check.mjs', allow: ['src/x.js'], deny: [], maxAttempts: 2 });

  assert.equal(r.status, 'done');
  assert.match(await readFile(join(dir, 'src/x.js'), 'utf8'), /VALUE = 2/);
  assert.match(git(dir, 'log', '--oneline'), /set VALUE to 2/);
});

test('E2E: stub implementer that cheats (deletes the test) is reverted by guards', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bg-e2e-cheat-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name', 't');
  await mkdir(join(dir, 'tests'), { recursive: true });
  await writeFile(join(dir, 'tests/test_x.py'), 'def test_x():\n    assert False\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');

  const item = { id: 'e2', title: 'make tests pass', path: 'tests/test_x.py:1', status: 'pending', attempts: 0, failures: [] };
  const deps = {
    implementer: async () => { execFileSync('git', ['rm', '-q', 'tests/test_x.py'], { cwd: dir }); return { ok: true }; },
    verifier: async () => ({ verdict: 'APPROVE', reasons: [] }), // verifier would approve; guards must catch it
    runGate: async () => ({ passed: true, output: 'no tests, vacuously green', coverage: {} }),
    git: {
      // Canonical diff: identical to E2E #1 — stage all (incl. untracked) then diff index.
      diff: async (cwd) => { git(cwd, 'add', '-A'); return git(cwd, 'diff', '--cached', 'HEAD'); },
      commit: async (cwd, msg) => { git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', msg); },
      // §7 git safety invariant: identical revert semantics everywhere
      restore: async (cwd) => { git(cwd, 'reset', '-q', '--hard', 'HEAD'); git(cwd, 'clean', '-fdq'); },
    },
  };

  process.chdir(dir);
  const r = await runItem(item, { deps, state: { items: {} }, gateCmd: 'true', allow: ['tests/'], deny: [], maxAttempts: 1 });

  assert.notEqual(r.status, 'done'); // guards must block the cheat even though gate+verifier said OK
  assert.match(r.failures[0].guardViolations.join(' '), /deleted.*test/i);
});

test('E2E: implementer adds an out-of-allowlist NEW file (the untracked exploit) is blocked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bg-e2e-newfile-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name', 't');
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src/x.js'), 'export const VALUE = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');

  const item = { id: 'e3', title: 'fix VALUE', path: 'src/x.js:1', status: 'pending', attempts: 0, failures: [] };
  const deps = {
    // cheats by CREATING a new untracked file outside the allowlist instead of editing in-scope
    implementer: async () => { await writeFile(join(dir, 'auth_bypass.py'), 'GRANT_ALL = True\n'); return { ok: true }; },
    verifier: async () => ({ verdict: 'APPROVE', reasons: [] }),
    runGate: async () => ({ passed: true, output: 'ok', infraError: false, coverage: {} }),
    git: {
      // canonical diff stages the untracked file so the guard can see it
      diff: async (cwd) => { git(cwd, 'add', '-A'); return git(cwd, 'diff', '--cached', 'HEAD'); },
      commit: async (cwd, msg) => { git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', msg); },
      restore: async (cwd) => { git(cwd, 'reset', '-q', '--hard', 'HEAD'); git(cwd, 'clean', '-fdq'); },
    },
  };

  process.chdir(dir);
  const r = await runItem(item, { deps, state: { items: {} }, gateCmd: 'true', allow: ['src/x.js'], deny: [], maxAttempts: 1 });

  assert.notEqual(r.status, 'done');                                   // not committed
  assert.match(r.failures[0].guardViolations.join(' '), /allowlist/i); // caught by scope guard
  assert.equal(git(dir, 'log', '--oneline').split('\n').filter(Boolean).length, 1); // still just 'init'
});
