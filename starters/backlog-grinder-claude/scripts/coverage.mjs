const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const FILE_RE = /^\+\+\+ b\/(.+)$/;
const NON_BEHAVIORAL = /\.(md|txt|rst|json|ya?ml|toml|ini|cfg|lock)$/i;

export function isBehavioral(file) {
  return !NON_BEHAVIORAL.test(file);
}

export function changedLines(diff) {
  const map = {};
  let file = null;
  let lineNo = 0;
  for (const line of diff.split('\n')) {
    const f = line.match(FILE_RE);
    if (f) { file = f[1]; map[file] = map[file] || new Set(); continue; }
    const h = line.match(HUNK_RE);
    if (h) { lineNo = Number(h[1]); continue; }
    if (!file) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) { map[file].add(lineNo); lineNo += 1; }
    else if (!line.startsWith('-')) { lineNo += 1; }
  }
  return map;
}

// coverage = { file: Set<executedLineNumber> }
export function checkCoverage(diff, coverage) {
  const changed = changedLines(diff);
  const uncovered = [];
  for (const [file, lines] of Object.entries(changed)) {
    if (!isBehavioral(file) || lines.size === 0) continue;
    const cov = coverage[file] || new Set();
    const missing = [...lines].filter((l) => !cov.has(l));
    if (missing.length) uncovered.push({ file, lines: missing });
  }
  return { ok: uncovered.length === 0, uncovered };
}
