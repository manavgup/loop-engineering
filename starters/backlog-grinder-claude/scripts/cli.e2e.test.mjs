// Standalone-tool E2E: runGrind drains a real backlog against a REAL temp git repo using a
// shell implementer (NO model) and a REAL gate that emits lcov coverage. Proves the whole
// tool runs end to end: parse -> stale-check -> grind -> gate+coverage+guards -> commit ->
// STATE + provenance on disk, with honest end states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runGrind } from './cli.mjs';

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }); }

async function fixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'bg-cli-e2e-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name', 't');
  await mkdir(join(dir, 'src'), { recursive: true });
  // Broken source: the repo's own test calls compute() and demands 2. The changed line lives
  // inside a function body the test executes, so coverage-of-change gets a real DA: record.
  await writeFile(join(dir, 'src/x.mjs'), 'export function compute() {\n  return 1;\n}\n');
  await writeFile(join(dir, 'x.test.mjs'),
    "import { test } from 'node:test';\n" +
    "import assert from 'node:assert/strict';\n" +
    "import { compute } from './src/x.mjs';\n" +
    "test('compute is 2', () => { assert.equal(compute(), 2); });\n");
  // The gate's coverage artifact and the grinder's own state dir must not pollute the diff.
  await writeFile(join(dir, '.gitignore'), 'cov.info\n.backlog-grinder/\n');
  await writeFile(join(dir, 'BACKLOG.md'),
    '### 🔴 CRITICAL (1)\n\n' +
    '#### bug-fix\n\n' +
    '- [ ] **make compute return 2**  ·  `src/x.mjs:2`  ·  _S/high_\n' +
    '    - _Evidence:_ compute returns 1 but the test expects 2.\n' +
    '    - _Fix:_ change the return to 2.\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const GATE = 'node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=cov.info x.test.mjs';

test('E2E: runGrind fixes a real repo behind gate+coverage+guards and records provenance', async () => {
  const dir = await fixtureRepo();
  const summary = await runGrind({
    backlogPath: 'BACKLOG.md',
    repoCwd: dir,
    gateCmd: GATE,
    coverage: { format: 'lcov', file: 'cov.info' },
    // model-agnostic implementer: a one-liner that performs the fix
    implementerCmd: "printf 'export function compute() {\\n  return 2;\\n}\\n' > src/x.mjs",
    allow: ['src/x.mjs'],
    deny: [],
    maxAttempts: 2,
    projectName: 'E2E',
  });

  // end state + counts
  assert.equal(summary.endState, 'complete');
  assert.equal(summary.counts.done, 1);
  assert.equal(summary.counts.pending, 0);

  // the real edit landed and is committed
  assert.equal(await readFile(join(dir, 'src/x.mjs'), 'utf8'), 'export function compute() {\n  return 2;\n}\n');
  assert.match(git(dir, 'log', '--oneline'), /make compute return 2/);
  // gate artifact and grinder state were gitignored — the commit is clean
  assert.doesNotMatch(git(dir, 'show', '--stat', 'HEAD'), /cov\.info|backlog-grinder/);

  // STATE persisted, item done
  const state = JSON.parse(await readFile(join(dir, '.backlog-grinder/state.json'), 'utf8'));
  const ids = Object.keys(state.items);
  assert.equal(ids.length, 1);
  assert.equal(state.items[ids[0]].status, 'done');
  assert.ok(state.items[ids[0]].commitSha);

  // provenance: one record, coverage passed, ties to the commit
  const prov = (await readFile(join(dir, '.backlog-grinder/provenance.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(prov.length, 1);
  const rec = JSON.parse(prov[0]);
  assert.equal(rec.itemId, ids[0]);
  assert.equal(rec.coverageOk, true);
  assert.ok(rec.commitSha);
});

test('E2E: a green gate with no coverage artifact halts the run (config error, §5)', async () => {
  const dir = await fixtureRepo();
  // gate that goes green but emits NO coverage file -> driver must halt, not commit blind
  const summary = await runGrind({
    backlogPath: 'BACKLOG.md',
    repoCwd: dir,
    gateCmd: 'true',                                   // vacuously green, no coverage written
    coverage: { format: 'lcov', file: 'cov.info' },    // file never produced
    implementerCmd: "printf 'export function compute() {\\n  return 2;\\n}\\n' > src/x.mjs",
    allow: ['src/x.mjs'],
    maxAttempts: 1,
  });

  assert.equal(summary.endState, 'halted');
  assert.equal(summary.counts.blocked, 1);
  assert.equal(summary.counts.done, 0);
  // nothing committed beyond init; the implementer's edit was reverted (§7)
  assert.equal(git(dir, 'log', '--oneline').trim().split('\n').length, 1);
  assert.equal(await readFile(join(dir, 'src/x.mjs'), 'utf8'), 'export function compute() {\n  return 1;\n}\n');
});
