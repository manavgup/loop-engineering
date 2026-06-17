import { checkGuards } from './guards.mjs';
import { checkCoverage } from './coverage.mjs';
import { buildRetryPrompt, isRepeatedFailure } from './feedback.mjs';
import { markDone, saveItem, pendingItems, rehydrate } from './state.mjs';

const BASE = 'Fix ONLY this finding with the smallest diff. Do not refactor unrelated code, delete or weaken tests, or touch denylist paths. If your change alters behavior, ensure a test executes the changed lines — add or extend a test if none does; a behavior change with no covering test will be rejected. Stop when done.';
const TERMINAL = ['done', 'abandoned', 'parked-infra', 'parked-flaky', 'blocked-coverage-config'];

function withLessons(prompt, lessons) {
  if (!lessons || !lessons.length) return prompt;
  return `${prompt}\n\nLessons from earlier items:\n${lessons.map((l) => `- ${l.pattern} → ${l.fix}`).join('\n')}`;
}

// Flake-confirm (§3.4): re-run a red ONCE before trusting it. Returns a kind tag so the
// driver never abandons good work on a transient red.
async function runGateConfirmed(deps, gateCmd, cwd) {
  const g = await deps.runGate(gateCmd, cwd);
  if (g.infraError) return { ...g, kind: 'infra' };
  if (g.passed) return { ...g, kind: 'green' };
  const second = await deps.runGate(gateCmd, cwd);
  if (second.infraError) return { ...second, kind: 'infra' };
  if (second.passed) return { ...second, kind: 'flaky' }; // disagreement → flaky, not a failure
  return { ...second, kind: 'red' };                       // confirmed red
}

export async function runItem(item, { deps, state, gateCmd, allow = [], deny = [], maxAttempts = 3 }) {
  item.attempts = (item.attempts || 0) + 1;
  item.failures = item.failures || [];

  const lessons = deps.lessons ? deps.lessons.relevant(item) : [];
  const prompt = buildRetryPrompt(item, withLessons(BASE, lessons), item.failures);
  await deps.implementer(item, prompt);

  const diff = await deps.git.diff(process.cwd());
  const gate = await runGateConfirmed(deps, gateCmd, process.cwd());

  // Couldn't-run or flaky ≠ failed: park, do NOT count the attempt or sign it.
  if (gate.kind === 'infra' || gate.kind === 'flaky') {
    await deps.git.restore(process.cwd());
    item.attempts -= 1;
    item.status = gate.kind === 'infra' ? 'parked-infra' : 'parked-flaky';
    saveItem(state, item);
    return item;
  }

  const guards = checkGuards(diff, { allow, deny });
  // Coverage matters only on a GREEN gate (a red already failed). A green gate that emits
  // NO coverage map is a CONFIG error — halt the run, don't abandon 1,192 items one by one.
  let coverage = { ok: true, uncovered: [] };
  if (gate.passed) {
    if (gate.coverage === undefined) {
      await deps.git.restore(process.cwd()); // §7: every non-commit path reverts the tree
      item.status = 'blocked-coverage-config';
      return item;
    }
    coverage = checkCoverage(diff, gate.coverage);
  }
  const hardOk = gate.passed && guards.ok && coverage.ok;

  let verdict = { verdict: 'REJECT', reasons: ['hard checks failed'] };
  if (hardOk) verdict = await deps.verifier(item, diff, guards.warnings); // warnings surfaced, not auto-block

  if (hardOk && verdict.verdict === 'APPROVE') {
    await deps.git.commit(process.cwd(), `fix(recovery): ${item.title}`);
    const sha = await deps.git.head(process.cwd()); // REQUIRED — throws if not injected
    // Provenance BEFORE the done marker (§6/§8): a done marker must imply audit-on-disk.
    if (deps.provenance) {
      await deps.provenance({
        itemId: item.id, title: item.title, commitSha: sha, promptSent: prompt,
        attempts: item.failures, gateOutput: gate.output, coverageOk: coverage.ok,
        guardResults: { violations: guards.violations, warnings: guards.warnings },
        verifierVerdict: verdict.verdict, verifierRationale: verdict.reasons, finalDiff: diff,
        lessonsApplied: lessons.map((l) => l.id || l.pattern),
      });
    }
    markDone(state, item, sha);
    item.status = 'done';
    return item;
  }

  await deps.git.restore(process.cwd());
  const record = {
    itemId: item.id, attempt: item.attempts, gateOutput: gate.output,
    guardViolations: guards.violations,
    coverageOk: coverage.ok,
    coverageUncovered: (coverage.uncovered || []).map((u) => `${u.file}:${(u.lines || []).join(',')}`),
    verifierVerdict: verdict.verdict, diffSummary: diff.slice(0, 500),
  };
  item.failures.push(record);
  // Repeat detection keyed on the FULL rejection (gate + guards + uncovered), not gate output
  // alone — so two different coverage rejections (gate 'ok') do NOT collapse to a false repeat.
  const repeated = isRepeatedFailure(item.failures.slice(0, -1), record);
  if (repeated && deps.lessons) deps.lessons.retract(item);
  item.status = repeated || item.attempts >= maxAttempts ? 'abandoned' : 'pending';
  saveItem(state, item); // persist attempts+failures so resume keeps feedback (§8)
  return item;
}

export async function runQueue(queue, opts) {
  const { deps, state = { items: {} }, stopFile } = opts;
  rehydrate(queue, state); // restore attempts+failures onto pending items before the loop (§8)
  const checkpoint = async () => { if (deps.persistState) await deps.persistState(state); };
  for (const item of pendingItems(queue, state)) {
    if (deps.budget && !deps.budget.ok()) { await checkpoint(); break; }      // budget gate IN the loop (§9)
    if (stopFile && deps.exists && (await deps.exists(stopFile))) { await checkpoint(); break; } // kill switch
    let r = item;
    while (!TERMINAL.includes(r.status)) {
      if (deps.budget && !deps.budget.ok()) break;
      r = await runItem(r, { ...opts, state });
    }
    await checkpoint();
    if (r.status === 'blocked-coverage-config') break; // run-level halt: gate emits no coverage
  }
  return queue;
}
