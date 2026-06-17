import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBacklog, parsePathRef, isStale } from './parse.mjs';

const FIXTURE = `### 🔴 CRITICAL (9)

#### bug-fix

- [ ] **Providers pass masked SecretStr to SDK**  ·  \`backend/openai.py:46\`  ·  _S/high_
    - _Evidence:_ str(SecretStr) returns the mask string.
    - _Fix:_ use api_key.get_secret_value().

#### security

- [ ] **verify_jwt disables signature verification**  ·  \`backend/auth/oidc.py:74-82\`  ·  _M/high_
    - _Evidence:_ options verify_signature False.
    - _Fix:_ verify signature against jwt_secret_key.
`;

test('parseBacklog extracts full item fields from the real format', () => {
  const items = parseBacklog(FIXTURE);
  assert.equal(items.length, 2);
  const a = items[0];
  assert.equal(a.title, 'Providers pass masked SecretStr to SDK');
  assert.equal(a.path, 'backend/openai.py:46');
  assert.equal(a.effort, 'S');
  assert.equal(a.severity, 'critical');
  assert.equal(a.category, 'bug-fix');
  assert.equal(a.evidence, 'str(SecretStr) returns the mask string.');
  assert.equal(a.fix, 'use api_key.get_secret_value().');
  assert.equal(a.checked, false);
  assert.match(a.id, /^[0-9a-f]{12}$/);
  assert.equal(items[1].category, 'security');
  assert.equal(items[1].severity, 'critical');
});

test('parsePathRef + isStale', () => {
  assert.deepEqual(parsePathRef('backend/openai.py:46'), { file: 'backend/openai.py', line: 46 });
  assert.equal(isStale({ path: 'backend/openai.py:46' }, () => true), false);
  assert.equal(isStale({ path: 'gone.py:1' }, () => false), true);
  assert.equal(isStale({ path: '' }, () => true), true);
});
