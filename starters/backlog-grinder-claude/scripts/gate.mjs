import { exec } from 'node:child_process';

// The gate runs in a clean-ish env: strip the parent's own test-runner context so a gate that
// itself shells out to `node --test` (the common case) behaves as a standalone run even when
// the harness is invoked from within a test runner. Without this, NODE_TEST_CONTEXT leaks into
// the child and the nested runner reports to the parent instead of emitting its report.
function gateEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

export function runGate(command, cwd, { timeoutMs = 600000 } = {}) {
  return new Promise((resolve) => {
    exec(command, { cwd, env: gateEnv(), timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      // Distinguish a real test failure (red) from "couldn't run" — spawn error,
      // timeout (err.killed), or shell 127 (command not found). Infra errors must NOT
      // count as a failed attempt or feed a garbage failure signature.
      const infraError = !!err && (err.killed === true || typeof err.code !== 'number' || err.code === 127);
      resolve({ passed: !err, output, infraError });
    });
  });
}

// Flake handling (§3.4): a red gate is re-run ONCE before it is trusted. Two agreeing reds →
// trusted red. Red-then-green disagreement → flaky (park for human review, NOT a failed
// attempt — a flaky gate must not burn good work). A green first run is trusted immediately
// (no re-run). Infra errors are passed through and are never marked flaky.
export async function runGateChecked(command, cwd, opts = {}) {
  const first = await runGate(command, cwd, opts);
  if (first.infraError) return { ...first, flaky: false };
  if (first.passed) return { ...first, flaky: false };
  const second = await runGate(command, cwd, opts);
  if (second.infraError) return { ...second, flaky: false };
  if (second.passed) return { ...second, flaky: true }; // disagreement → flaky
  return { ...second, flaky: false };                    // confirmed (trusted) red
}
