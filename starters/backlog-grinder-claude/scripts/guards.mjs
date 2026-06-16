const FILE_RE = /^diff --git a\/(.+?) b\/(.+)$/;

export function parseDiff(diffText) {
  const lines = diffText.split('\n');
  const files = [];
  let cur = null;
  for (const line of lines) {
    const f = line.match(FILE_RE);
    if (f) {
      cur = { file: f[2], deleted: false, addedAssert: 0, removedAssert: 0 };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('deleted file mode')) cur.deleted = true;
    else if (line.startsWith('+') && !line.startsWith('+++') && line.includes('assert')) cur.addedAssert += 1;
    else if (line.startsWith('-') && !line.startsWith('---') && line.includes('assert')) cur.removedAssert += 1;
  }
  return files;
}

function isTestFile(f, testGlobs = [/(^|\/)tests?\//, /test_.*\.py$/, /_test\./, /\.test\./]) {
  return testGlobs.some((re) => re.test(f));
}

// Prefix/segment matching, NOT substring. 'auth' matches backend/auth/x.py (a path
// segment) but NOT backend/oauth_helper.py; 'src/a.py' matches exactly, not src/a.py.bak.
export function pathMatches(file, pattern) {
  const pat = pattern.replace(/\/$/, '');
  if (file === pat || file.startsWith(pat + '/')) return true;
  if (!pat.includes('/') && file.split('/').includes(pat)) return true;
  return false;
}

// Hard violations block the commit. Warnings are advisory (assertion-count delta is
// gameable via `assert True` padding and false-positive on legit test refactors), so
// they are surfaced to the verifier rather than auto-blocking.
export function checkGuards(diffText, { allow = [], deny = [] } = {}) {
  const files = parseDiff(diffText);
  const violations = [];
  const warnings = [];
  for (const f of files) {
    if (f.deleted && isTestFile(f.file)) violations.push(`deleted/moved test file: ${f.file}`);
    if (isTestFile(f.file) && f.removedAssert > f.addedAssert) {
      warnings.push(`assertion-count drop in ${f.file} (-${f.removedAssert}/+${f.addedAssert})`);
    }
    if (deny.some((d) => pathMatches(f.file, d))) violations.push(`denylist path touched: ${f.file}`);
    if (allow.length && !allow.some((a) => pathMatches(f.file, a))) violations.push(`outside allowlist: ${f.file}`);
  }
  return { ok: violations.length === 0, violations, warnings };
}
