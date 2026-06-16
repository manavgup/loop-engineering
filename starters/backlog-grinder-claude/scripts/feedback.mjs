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

// Scoped, retractable lessons (§3.5). A lesson is { id, pattern, fix, confidence,
// sourceItemId, status, category }. NOT a naive global append-only log: retrieval is scoped
// to the item's category (a lesson with no category is global), ranked by confidence, and
// capped to a context budget — this bounds both the poisoning vector and unbounded growth.
const LESSON_CAP = 5;
const EVICT_THRESHOLD = 0;
const RETRACT_DROP = 1;

export function relevantLessons(store, item, cap = LESSON_CAP) {
  return store
    .filter((l) => l.status !== 'evicted')
    .filter((l) => !l.category || l.category === item.category)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, cap);
}

// Retraction: a lesson blamed for a failure loses confidence and is evicted below the
// threshold. Mutates the shared store in place (the store is shared mutable state, §10).
export function retractLesson(store, lessonId) {
  const l = store.find((x) => x.id === lessonId);
  if (!l) return store;
  l.confidence = (l.confidence ?? 0) - RETRACT_DROP;
  if (l.confidence <= EVICT_THRESHOLD) l.status = 'evicted';
  return store;
}

// Adapter the driver consumes as deps.lessons: relevant(item) injects the scoped lessons and
// remembers which it applied to the item; retract(item) retracts the lesson(s) last applied
// to that item (the driver calls it when the item fails attributably). The adapter just wraps
// the pure functions above and tracks per-item application — same design, no disagreement.
export function makeLessonsAdapter(store, { cap = LESSON_CAP } = {}) {
  const lastApplied = {};
  return {
    relevant(item) {
      const ls = relevantLessons(store, item, cap);
      lastApplied[item.id] = ls.map((l) => l.id);
      return ls;
    },
    retract(item) {
      for (const id of lastApplied[item.id] || []) retractLesson(store, id);
      return store;
    },
  };
}
