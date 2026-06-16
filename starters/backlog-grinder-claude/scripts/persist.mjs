import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// STATE persistence to disk (§8). state.mjs keeps the in-memory shape { items, lastGoodSha };
// these read/write it as JSON so a halt/crash can resume. No Sets in the persisted shape, so
// JSON round-trips cleanly.
export function loadState(path) {
  if (!existsSync(path)) return { items: {} };
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { items: {} }; }
}

export function makeStatePersister(path) {
  return async (state) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2));
  };
}

// Provenance (§6): append one JSON record per commit (JSONL), so the audit trail is on disk.
export function makeProvenanceWriter(path) {
  return async (record) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(record) + '\n');
  };
}
