import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

// lcov: SF:<file> ... DA:<line>,<execCount> ... end_of_record  ->  { file: Set<line, count>0> }
export function parseLcov(text) {
  const cov = {};
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) { cur = line.slice(3).trim(); cov[cur] = cov[cur] || new Set(); }
    else if (line.startsWith('DA:') && cur) {
      const [ln, count] = line.slice(3).split(',');
      if (Number(count) > 0) cov[cur].add(Number(ln));
    } else if (line === 'end_of_record') cur = null;
  }
  return cov;
}

// Cobertura XML (coverage.py `coverage xml`): <class filename="X"> ... <line number="N" hits="H"/>
// -> { filename: Set<line, hits>0> }. Walks tags in document order so each <line> attaches to
// the preceding <class>. Path normalization to match diff paths is the caller's job (README).
export function parseCobertura(text) {
  const cov = {};
  let cur = null;
  const tokenRe = /<class\b[^>]*\bfilename="([^"]+)"|<line\b[^>]*\bnumber="(\d+)"[^>]*\bhits="(\d+)"/g;
  let m;
  while ((m = tokenRe.exec(text))) {
    if (m[1] !== undefined) { cur = m[1]; cov[cur] = cov[cur] || new Set(); }
    else if (cur && m[2] !== undefined && Number(m[3]) > 0) cov[cur].add(Number(m[2]));
  }
  return cov;
}

// Every line the report LISTS (hit OR miss) — the set of lines the coverage tool considers
// executable. Lines absent from this set (comments, blanks, multi-line-literal continuations,
// docstrings) are NON-executable and can never be "executed by a test".
export function parseCoberturaExecutable(text) {
  const exec = {};
  let cur = null;
  const tokenRe = /<class\b[^>]*\bfilename="([^"]+)"|<line\b[^>]*\bnumber="(\d+)"/g;
  let m;
  while ((m = tokenRe.exec(text))) {
    if (m[1] !== undefined) { cur = m[1]; exec[cur] = exec[cur] || new Set(); }
    else if (cur && m[2] !== undefined) exec[cur].add(Number(m[2]));
  }
  return exec;
}

// Cobertura filenames are relative to a <sources><source> root (e.g. coverage.py `--cov=mathy`
// yields filename="ops.py" under source=".../mathy"). To match git-diff paths (repo-relative),
// resolve each filename against a source root and relativize to repoCwd.
export function coberturaSources(text) {
  const out = [];
  const re = /<source>([^<]+)<\/source>/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1].trim());
  return out;
}

function remapToRepo(flat, sources, repoCwd) {
  if (!repoCwd || sources.length === 0) return flat;
  const out = {};
  for (const [fn, lines] of Object.entries(flat)) {
    let key = fn;
    for (const src of sources) {
      const rel = relative(repoCwd, resolve(src, fn));
      if (!rel.startsWith('..')) { key = rel; break; } // first source that keeps it inside repo
    }
    out[key] = lines;
  }
  return out;
}

// Coverage-of-change requires every CHANGED line to be executed, but trace-based coverage
// (coverage.py/cobertura) only reports executable statements — a whole-file diff's docstrings,
// blank lines, and multi-line-literal continuations are absent and would be flagged "uncovered"
// even though they can never be executed. (V8/lcov is range-based and covers them implicitly,
// so this only bit cobertura targets.) Mark every NON-executable source line as covered so
// coverage-of-change gates only genuine statements; executable-but-unhit lines stay gaps.
function augmentNonExecutable(hit, execMap, repoCwd) {
  for (const [file, execLines] of Object.entries(execMap)) {
    let total;
    try { total = readFileSync(resolve(repoCwd, file), 'utf8').split('\n').length; }
    catch { continue; } // source unreadable -> best-effort, leave hit-only
    const covered = hit[file] || (hit[file] = new Set());
    for (let n = 1; n <= total; n++) if (!execLines.has(n)) covered.add(n);
  }
}

// repoCwd (optional) makes cobertura paths repo-relative so they match git-diff paths.
export function loadCoverage({ format, file, repoCwd }) {
  const text = readFileSync(file, 'utf8');
  if (format === 'lcov') return parseLcov(text);
  if (format === 'cobertura' || format === 'coveragepy') {
    const sources = coberturaSources(text);
    const hit = remapToRepo(parseCobertura(text), sources, repoCwd);
    // With the repo on disk, treat non-executable changed lines as satisfied (see above).
    if (repoCwd) augmentNonExecutable(hit, remapToRepo(parseCoberturaExecutable(text), sources, repoCwd), repoCwd);
    return hit;
  }
  throw new Error(`unknown coverage format: ${format}`);
}
