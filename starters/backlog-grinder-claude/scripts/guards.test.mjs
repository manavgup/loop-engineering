import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGuards } from './guards.mjs';

const DELETED_TEST = `diff --git a/tests/test_foo.py b/tests/test_foo.py
deleted file mode 100644
--- a/tests/test_foo.py
+++ /dev/null
@@ -1,3 +0,0 @@
-def test_foo():
-    assert bar() == 1
`;

const WEAKENED = `diff --git a/tests/test_bar.py b/tests/test_bar.py
--- a/tests/test_bar.py
+++ b/tests/test_bar.py
@@ -1,3 +1,2 @@
 def test_bar():
-    assert bar() == 1
     pass
`;

const OUT_OF_SCOPE = `diff --git a/backend/other.py b/backend/other.py
--- a/backend/other.py
+++ b/backend/other.py
@@ -1 +1 @@
-x = 1
+x = 2
`;

const CLEAN = `diff --git a/backend/openai.py b/backend/openai.py
--- a/backend/openai.py
+++ b/backend/openai.py
@@ -1 +1 @@
-api_key=str(k)
+api_key=k.get_secret_value()
`;

test('deleted test file is a hard violation', () => {
  const r = checkGuards(DELETED_TEST, { allow: ['tests/'], deny: [] });
  assert.equal(r.ok, false);
  assert.match(r.violations.join(' '), /deleted.*test/i);
});

test('assertion-count drop is advisory (warning, not a block)', () => {
  const r = checkGuards(WEAKENED, { allow: ['tests/'], deny: [] });
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(' '), /assertion-count/i);
});

test('out-of-allowlist file is a hard violation', () => {
  const r = checkGuards(OUT_OF_SCOPE, { allow: ['backend/openai.py'], deny: [] });
  assert.equal(r.ok, false);
  assert.match(r.violations.join(' '), /allowlist/i);
});

test('passes a clean in-scope diff', () => {
  const r = checkGuards(CLEAN, { allow: ['backend/openai.py'], deny: ['auth/'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test('path matching is segment-based, not substring', () => {
  // deny 'auth' must NOT fire on backend/oauth_helper.py (false denial)
  const oauth = `diff --git a/backend/oauth_helper.py b/backend/oauth_helper.py
--- a/backend/oauth_helper.py
+++ b/backend/oauth_helper.py
@@ -1 +1 @@
-a
+b
`;
  assert.equal(checkGuards(oauth, { allow: ['backend/oauth_helper.py'], deny: ['auth'] }).ok, true);
  // allow 'src/a.py' must NOT admit src/a.py.bak (false allow)
  const bak = `diff --git a/src/a.py.bak b/src/a.py.bak
--- a/src/a.py.bak
+++ b/src/a.py.bak
@@ -1 +1 @@
-a
+b
`;
  assert.equal(checkGuards(bak, { allow: ['src/a.py'], deny: [] }).ok, false);
});
