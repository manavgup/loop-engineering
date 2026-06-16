import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGate, runGateChecked } from './gate.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('runGate reports pass on exit 0', async () => {
  const r = await runGate("printf 'ok'; exit 0", process.cwd());
  assert.equal(r.passed, true);
  assert.match(r.output, /ok/);
});

test('runGate reports fail on non-zero exit (real red, not infra)', async () => {
  const r = await runGate("printf 'boom' 1>&2; exit 1", process.cwd());
  assert.equal(r.passed, false);
  assert.equal(r.infraError, false);
  assert.match(r.output, /boom/);
});

test('runGate flags an infra error (command not found), not a test failure', async () => {
  const r = await runGate('definitely_not_a_real_command_xyz', process.cwd());
  assert.equal(r.passed, false);
  assert.equal(r.infraError, true);
});

test('runGateChecked: green on first run is trusted, not flaky', async () => {
  const r = await runGateChecked("printf 'ok'; exit 0", process.cwd());
  assert.equal(r.passed, true);
  assert.equal(r.flaky, false);
});

test('runGateChecked: two agreeing reds -> trusted red, not flaky', async () => {
  const r = await runGateChecked('exit 1', process.cwd());
  assert.equal(r.passed, false);
  assert.equal(r.flaky, false);
});

test('runGateChecked: red then green (disagreement) -> flaky, not a failed attempt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bg-flake-'));
  const marker = join(dir, 'seen');
  // first invocation: marker absent -> create it + exit 1; second: marker present -> exit 0
  const cmd = `if [ -e '${marker}' ]; then exit 0; else : > '${marker}'; exit 1; fi`;
  const r = await runGateChecked(cmd, process.cwd());
  assert.equal(r.flaky, true);
  await rm(dir, { recursive: true, force: true });
});

test('runGateChecked: infra error is passed through, never flaky', async () => {
  const r = await runGateChecked('definitely_not_a_real_command_xyz', process.cwd());
  assert.equal(r.infraError, true);
  assert.equal(r.flaky, false);
});
