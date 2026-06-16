import { checkGuards } from './guards.mjs';
import { buildRetryPrompt } from './feedback.mjs';

const BASE_PROMPT = 'Fix ONLY this finding with the smallest diff. Follow the repo conventions. Do not refactor unrelated code, do not weaken or delete tests, do not touch denylist paths. Stop when done.';

export async function runItem(item, { deps, gateCmd, allow = [], deny = [], maxAttempts = 3 }) {
  item.attempts = (item.attempts || 0) + 1;
  item.failures = item.failures || [];

  const prompt = buildRetryPrompt(item, BASE_PROMPT, item.failures);
  await deps.implementer(item, prompt);

  const diff = await deps.git.diff(process.cwd());
  const gate = await deps.runGate(gateCmd, process.cwd());
  const guards = checkGuards(diff, { allow, deny });

  let verdict = { verdict: 'REJECT', reasons: [] };
  if (gate.passed && guards.ok) verdict = await deps.verifier(item, diff);

  const approved = gate.passed && guards.ok && verdict.verdict === 'APPROVE';
  if (approved) {
    await deps.git.commit(process.cwd(), `fix(recovery): ${item.title}`);
    item.status = 'done';
    item.lastError = '';
    return item;
  }

  await deps.git.restore(process.cwd());
  item.failures.push({
    itemId: item.id,
    attempt: item.attempts,
    gateOutput: gate.output,
    guardViolations: guards.violations,
    verifierVerdict: verdict.verdict,
    diffSummary: diff.slice(0, 500),
  });
  item.status = item.attempts >= maxAttempts ? 'abandoned' : 'pending';
  return item;
}

export async function runQueue(queue, opts) {
  const { deps, stopFile } = opts;
  for (const item of queue) {
    if (stopFile && deps.exists && (await deps.exists(stopFile))) break;
    if (item.status === 'done' || item.status === 'abandoned') continue;
    let result = item;
    while (result.status !== 'done' && result.status !== 'abandoned') {
      result = await runItem(result, opts);
    }
  }
  return queue;
}
