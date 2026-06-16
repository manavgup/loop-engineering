#!/usr/bin/env node
// Dogfood the coverage backbone (coverage.mjs) on THIS repo: prove that the harness's own
// changed source lines were actually executed by the harness's own test suite — the exact
// guarantee the harness enforces on the repos it grinds ("a behavior change must be executed
// by a test", concept §5).
//
// Pipeline (same three steps the driver uses, §3.3a):
//   1. run the suite under V8 coverage, emit lcov, map lcov -> { file: Set<executedLine> }
//   2. `git diff` the scripts dir (working tree vs a base ref) -> changed lines
//   3. checkCoverage(diff, covMap) -> changed source lines no test executed
//
// Usage:  node self-coverage.mjs [baseRef]      (default baseRef: HEAD)
//   - no args: checks uncommitted working-tree changes vs HEAD
//   - e.g. `node self-coverage.mjs origin/main` to check a whole branch
// Exit 0 if every changed *source* line was executed (or nothing changed); 1 otherwise.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCoverage } from './coverage.mjs';

const SCRIPTS_ABS = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: SCRIPTS_ABS, encoding: 'utf8' }).trim();
const SCRIPTS_REL = relative(REPO_ROOT, SCRIPTS_ABS); // e.g. starters/backlog-grinder-claude/scripts
const baseRef = process.argv[2] || 'HEAD';
const isTestFile = (f) => /\.test\.mjs$/.test(f);

// 1. Run the suite under coverage. Enumerate test files explicitly (no shell glob, no
//    directory-positional — both are Node-version-fragile). SF paths emitted from REPO_ROOT
//    are already repo-relative, matching `git diff` paths.
const testFiles = readdirSync(SCRIPTS_ABS)
  .filter(isTestFile)
  .map((f) => join(SCRIPTS_REL, f));
const lcovPath = join(mkdtempSync(join(tmpdir(), 'bg-selfcov-')), 'lcov.info');
let suiteGreen = true;
try {
  execFileSync('node', [
    '--test', '--experimental-test-coverage',
    '--test-reporter=lcov', `--test-reporter-destination=${lcovPath}`,
    ...testFiles,
  ], { cwd: REPO_ROOT, stdio: 'ignore' });
} catch {
  suiteGreen = false; // suite went red; lcov is still written, so coverage is still meaningful
}

// 2. lcov -> { file: Set<executedLine> }. A DA:line,count with count>0 means executed.
function parseLcov(text) {
  const cov = {};
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) { cur = line.slice(3).trim(); cov[cur] = cov[cur] || new Set(); }
    else if (line.startsWith('DA:') && cur) {
      const [ln, count] = line.slice(3).split(',');
      if (Number(count) > 0) cov[cur].add(Number(ln));
    } else if (line === 'end_of_record') cur = null;
  }
  return cov;
}
const cov = parseLcov(readFileSync(lcovPath, 'utf8'));

// 3. Diff the scripts dir and run the backbone against it.
const diff = execFileSync('git', ['diff', baseRef, '--', SCRIPTS_REL], { cwd: REPO_ROOT, encoding: 'utf8' });
if (!diff.trim()) {
  console.log(`✓ no changes under ${SCRIPTS_REL} vs ${baseRef} — nothing to coverage-check`);
  process.exit(0);
}

const result = checkCoverage(diff, cov); // <-- the coverage backbone, dogfooded on this repo
// checkCoverage already exempts docs/config (isBehavioral). Test files are behavioral source
// to the module, but they ARE the tests, not the product — so we report them separately and
// don't fail on them.
const sourceGaps = result.uncovered.filter((u) => !isTestFile(u.file));
const testGaps = result.uncovered.filter((u) => isTestFile(u.file));

if (!suiteGreen) console.warn('⚠ suite was RED during the coverage run — coverage reflects a failing suite\n');

if (sourceGaps.length === 0) {
  console.log(`✓ coverage backbone: every changed source line under ${SCRIPTS_REL} (vs ${baseRef}) was executed by a test`);
  if (testGaps.length) {
    console.log('  (informational) changed test-file lines not executed:');
    for (const g of testGaps) console.log(`    ${g.file}: ${g.lines.join(', ')}`);
  }
  process.exit(0);
}

console.error(`✗ coverage backbone: changed SOURCE lines no test executed (vs ${baseRef}):`);
for (const g of sourceGaps) console.error(`    ${g.file}: ${g.lines.join(', ')}`);
if (testGaps.length) {
  console.error('  (informational) changed test-file lines not executed:');
  for (const g of testGaps) console.error(`    ${g.file}: ${g.lines.join(', ')}`);
}
process.exit(1);
