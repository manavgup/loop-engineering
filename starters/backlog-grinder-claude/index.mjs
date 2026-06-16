// Public API barrel for the backlog-grinder harness.
// The pure modules are dependency-injected and side-effect-free; the adapters and runGrind
// supply the real git/coverage/shell/disk wiring.

// Pure core
export { parseBacklog, parsePathRef, isStale } from './scripts/parse.mjs';
export { summarize, toStateMarkdown } from './scripts/triage.mjs';
export { checkGuards, parseDiff, pathMatches } from './scripts/guards.mjs';
export { changedLines, checkCoverage, isBehavioral } from './scripts/coverage.mjs';
export { runGate, runGateChecked } from './scripts/gate.mjs';
export {
  signature, failureFingerprint, isRepeatedFailure, buildRetryPrompt,
  appendLesson, relevantLessons, retractLesson, makeLessonsAdapter,
} from './scripts/feedback.mjs';
export { markDone, saveItem, rehydrate, pendingItems, reconcile } from './scripts/state.mjs';
export { makeRecord, appendRecord } from './scripts/provenance.mjs';
export { runItem, runQueue } from './scripts/driver.mjs';

// Real adapters
export { makeGit } from './scripts/git-adapter.mjs';
export { parseLcov, parseCobertura, loadCoverage } from './scripts/coverage-adapter.mjs';
export { makeShellImplementer, makeShellVerifier } from './scripts/implementer.mjs';
export { loadState, makeStatePersister, makeProvenanceWriter } from './scripts/persist.mjs';

// Orchestrator
export { runGrind } from './scripts/cli.mjs';
