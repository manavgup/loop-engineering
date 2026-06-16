import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGate } from './gate.mjs';

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
