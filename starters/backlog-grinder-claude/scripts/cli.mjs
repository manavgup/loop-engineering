// runGrind — the standalone orchestrator. Wires the pure modules to REAL adapters (git,
// coverage, shell implementer/verifier, disk persistence) and drains a finite backlog against
// a real repo. Model-agnostic: the implementer is a configured shell command, so any tool
// (script, sed, or an LLM CLI) plugs in without the harness hardcoding a model.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { parseBacklog, isStale } from './parse.mjs';
import { toStateMarkdown } from './triage.mjs';
import { runQueue } from './driver.mjs';
import { runGate } from './gate.mjs';
import { makeGit } from './git-adapter.mjs';
import { loadCoverage } from './coverage-adapter.mjs';
import { makeShellImplementer, makeShellVerifier } from './implementer.mjs';
import { loadState, makeStatePersister, makeProvenanceWriter } from './persist.mjs';

export async function runGrind(config) {
  const {
    backlogPath,
    repoCwd = process.cwd(),
    gateCmd,
    coverage,
    implementerCmd,
    verifierCmd,
    allow = [],
    deny = [],
    maxAttempts = 3,
    projectName = 'Backlog Grinder',
    stopFile,
    budgetSeconds,
    statePath = join(repoCwd, '.backlog-grinder/state.json'),
    provenancePath = join(repoCwd, '.backlog-grinder/provenance.jsonl'),
    stateMarkdownPath = join(repoCwd, '.backlog-grinder/STATE.md'),
    now = () => Date.now(),
  } = config;

  if (!backlogPath) throw new Error('config.backlogPath is required');
  if (!gateCmd) throw new Error('config.gateCmd is required');
  if (!implementerCmd) throw new Error('config.implementerCmd is required');
  if (!coverage || !coverage.format || !coverage.file) {
    throw new Error('config.coverage {format,file} is required — the coverage backbone is mandatory (concept §5)');
  }

  // 1. Parse the backlog and re-validate each item against the real tree (park stale).
  const items = parseBacklog(readFileSync(resolve(repoCwd, backlogPath), 'utf8'));
  for (const it of items) it.stale = isStale(it, (f) => existsSync(join(repoCwd, f)));

  // 2. Write the triage view (queue + stale + denylist flags) to disk.
  mkdirSync(dirname(stateMarkdownPath), { recursive: true });
  writeFileSync(stateMarkdownPath, toStateMarkdown(items, { projectName, deny }));

  // 3. Resume: load prior STATE (done items skipped, failures restored by the driver).
  const state = loadState(statePath);

  // 4. Real adapters. The gate wrapper attaches a coverage map on a green run; a green gate
  //    that yields no map leaves coverage undefined, so the driver halts (blocked-coverage-
  //    config) instead of silently committing untested changes.
  const covFileAbs = resolve(repoCwd, coverage.file);
  const runGateWithCoverage = async (cmd, cwd) => {
    const g = await runGate(cmd, cwd);
    if (g.passed && !g.infraError) {
      try { g.coverage = loadCoverage({ format: coverage.format, file: covFileAbs, repoCwd }); }
      catch { /* no coverage artifact -> undefined -> driver halts with a config error */ }
    }
    return g;
  };
  const deadline = budgetSeconds ? now() + budgetSeconds * 1000 : null;
  const deps = {
    implementer: makeShellImplementer(implementerCmd),
    verifier: makeShellVerifier(verifierCmd),
    runGate: runGateWithCoverage,
    git: makeGit(),
    provenance: makeProvenanceWriter(provenancePath),
    persistState: makeStatePersister(statePath),
    exists: async (p) => existsSync(p),
    ...(deadline ? { budget: { ok: () => now() < deadline } } : {}),
  };

  // 5. Run. The driver uses process.cwd() for git ops, so grind from inside the target repo.
  const cwd0 = process.cwd();
  process.chdir(repoCwd);
  try {
    await runQueue(items, { deps, state, gateCmd, allow, deny, maxAttempts, stopFile });
  } finally {
    process.chdir(cwd0);
  }
  await deps.persistState(state);

  // 6. Honest end states (§4). STATE is authoritative for status.
  const statusOf = (it) => (state.items[it.id] && state.items[it.id].status) || it.status || 'pending';
  const nonStale = items.filter((it) => !it.stale);
  const counts = { total: items.length, stale: items.length - nonStale.length, done: 0, abandoned: 0, parked: 0, blocked: 0, pending: 0 };
  for (const it of nonStale) {
    const s = statusOf(it);
    if (s === 'done') counts.done += 1;
    else if (s === 'abandoned') counts.abandoned += 1;
    else if (s === 'parked-infra' || s === 'parked-flaky') counts.parked += 1;
    else if (s === 'blocked-coverage-config') counts.blocked += 1;
    else counts.pending += 1;
  }
  let endState;
  if (counts.pending > 0 || counts.blocked > 0) endState = 'halted';   // budget/kill/config — work remains
  else if (counts.done === nonStale.length) endState = 'complete';     // every queueable item done
  else endState = 'drained';                                           // done ∪ abandoned ∪ parked, no pending
  return { endState, counts, statePath, provenancePath, stateMarkdownPath };
}
