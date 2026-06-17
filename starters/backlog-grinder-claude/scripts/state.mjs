// Persist EVERY item (pending/abandoned/parked too), not just done — so a halt or crash
// doesn't lose attempts/failures (§8 "feedback intact").
export function saveItem(state, item) {
  const prev = state.items[item.id] || {};
  state.items[item.id] = {
    status: item.status,
    attempts: item.attempts || 0,
    failures: item.failures || [],
    commitSha: item.commitSha || prev.commitSha || '',
  };
  return state;
}

export function markDone(state, item, commitSha) {
  item.status = 'done';
  item.commitSha = commitSha;
  saveItem(state, item);
  state.lastGoodSha = commitSha;
  return state;
}

// Copy persisted attempts/failures back onto freshly-parsed queue items before the loop,
// so a resumed pending item keeps its retry history (the "do not repeat" feedback).
export function rehydrate(queue, state) {
  for (const it of queue) {
    const rec = state.items[it.id];
    if (rec && rec.status !== 'done') {
      it.attempts = rec.attempts || 0;
      it.failures = rec.failures || [];
      it.status = rec.status;
    }
  }
  return queue;
}

export function pendingItems(queue, state) {
  return queue.filter((it) => {
    if (it.stale) return false;
    const rec = state.items[it.id];
    return !rec || (rec.status !== 'done' && rec.status !== 'abandoned');
  });
}

// Crash between commit and marker: HEAD moved but no 'done' written. Idempotent reconcile.
export function reconcile(state, inFlightItem, headSha, lastRecordedSha) {
  if (inFlightItem && headSha && headSha !== lastRecordedSha && !state.items[inFlightItem.id]) {
    markDone(state, inFlightItem, headSha);
  }
  return state;
}
