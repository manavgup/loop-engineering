// Provenance (§6): every approved commit emits a machine-generated audit record so
// "why did the system make this edit and what did it check" is answerable from disk without
// re-running anything. makeRecord builds the §6 record from the item + the run artifacts;
// appendRecord stores it append-only (one record per commit). The clock is injected so the
// timestamp is deterministic in tests.
export function makeRecord(item, {
  prompt = '', attempts = [], gateOutput = '', testsCollected = null,
  coverage = null, guardResults = {}, verifierVerdict = '', verifierRationale = [],
  finalDiff = '', commitSha = '', lessonsApplied = [], timestamp,
} = {}, clock = () => new Date().toISOString()) {
  return {
    itemId: item.id,
    title: item.title,
    sourcePath: item.path,
    commitSha,
    timestamp: timestamp || clock(),
    promptSent: prompt,
    attempts,
    gateOutput,
    testsCollected,
    coverageOfChange: coverage,
    guardResults: {
      coverage: guardResults.coverage ?? null,
      scope: guardResults.scope ?? null,
      tamperWarnings: guardResults.tamperWarnings ?? guardResults.warnings ?? [],
    },
    verifierVerdict,
    verifierRationale,
    finalDiff,
    lessonsApplied,
  };
}

export function appendRecord(store, record) {
  return [...store, record];
}
