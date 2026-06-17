import { execFileSync } from 'node:child_process';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

// The §7 git safety adapter. Canonical diff stages everything (incl. untracked) then diffs
// the index, so guards see exactly what a commit would include. revert = reset --hard + clean
// -fd, so a rejected attempt can never leak files into the next item.
export function makeGit() {
  return {
    diff: async (cwd) => { git(cwd, ['add', '-A']); return git(cwd, ['diff', '--cached', 'HEAD']); },
    commit: async (cwd, msg) => { git(cwd, ['add', '-A']); git(cwd, ['commit', '-q', '-m', msg]); },
    restore: async (cwd) => { git(cwd, ['reset', '-q', '--hard', 'HEAD']); git(cwd, ['clean', '-fdq']); },
    head: async (cwd) => git(cwd, ['rev-parse', 'HEAD']).trim(),
  };
}
