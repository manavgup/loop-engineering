import { readFileSync } from 'node:fs';

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

export function loadCoverage({ format, file }) {
  const text = readFileSync(file, 'utf8');
  if (format === 'lcov') return parseLcov(text);
  if (format === 'cobertura' || format === 'coveragepy') return parseCobertura(text);
  throw new Error(`unknown coverage format: ${format}`);
}
