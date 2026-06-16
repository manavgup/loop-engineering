import { createHash } from 'node:crypto';

export function signature(gateOutput) {
  // Strip ONLY volatile classes. Keep small integers (assert values, line numbers) so
  // "expected 3 got 4" and "expected 3 got 99" — and x.py:46 vs x.py:99 — stay distinct.
  const normalized = (gateOutput || '')
    .replace(/0x[0-9a-fA-F]+/g, '0xADDR')                  // memory addresses
    .replace(/\b\d+(\.\d+)?\s*(s|ms|sec|seconds)\b/gi, 'DUR') // durations
    .replace(/\/tmp\/[^\s'":]+/g, '/tmp/PATH')             // temp paths
    .replace(/\bpid[=: ]?\d+/gi, 'pid=PID')                // pids
    .toLowerCase()
    .trim();
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

// A failure's identity is the FULL rejection reason, not gate output alone: a coverage or
// scope rejection leaves the gate green, so keying on gate output would collapse two
// different rejections into a false "repeat" and abandon the item prematurely.
export function failureFingerprint(record) {
  const parts = [
    signature(record.gateOutput || ''),
    [...(record.guardViolations || [])].sort().join(','),
    [...(record.coverageUncovered || [])].sort().join(','),
  ];
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}

export function isRepeatedFailure(prevRecords, currentRecord) {
  const fp = failureFingerprint(currentRecord);
  return prevRecords.some((r) => failureFingerprint(r) === fp);
}

export function buildRetryPrompt(item, basePrompt, failures = []) {
  const lines = [basePrompt, ''];
  if (failures.length) {
    lines.push('Your previous attempts failed. Do NOT repeat them. Try a different approach.');
    for (const f of failures) {
      lines.push(`--- Attempt ${f.attempt} failed; gate output: ---`);
      lines.push((f.gateOutput || '').slice(0, 1500));
    }
    lines.push('');
  }
  lines.push(`Item: ${item.title}`);
  if (item.fix) lines.push(`Suggested fix from backlog: ${item.fix}`);
  return lines.join('\n');
}

export function appendLesson(lessons, lesson) {
  if (lessons.some((l) => l.pattern === lesson.pattern)) return lessons;
  return [...lessons, lesson];
}
