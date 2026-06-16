import { exec } from 'node:child_process';

export function runGate(command, cwd, { timeoutMs = 600000 } = {}) {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      // Distinguish a real test failure (red) from "couldn't run" — spawn error,
      // timeout (err.killed), or shell 127 (command not found). Infra errors must NOT
      // count as a failed attempt or feed a garbage failure signature.
      const infraError = !!err && (err.killed === true || typeof err.code !== 'number' || err.code === 127);
      resolve({ passed: !err, output, infraError });
    });
  });
}
