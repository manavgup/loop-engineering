import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeShellImplementer, makeShellVerifier } from './implementer.mjs';

test('shell implementer runs the command in cwd and edits the tree', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bg-impl-'));
  const cwd0 = process.cwd();
  process.chdir(dir);
  try {
    const impl = makeShellImplementer('printf "fixed:$BG_ITEM_TITLE" > out.txt');
    const r = await impl({ id: 'i1', title: 'X', path: 'a', fix: 'do' }, 'PROMPT');
    assert.equal(r.ok, true);
    assert.equal(await readFile(join(dir, 'out.txt'), 'utf8'), 'fixed:X');
  } finally { process.chdir(cwd0); await rm(dir, { recursive: true, force: true }); }
});

test('default verifier (no command) approves', async () => {
  const v = makeShellVerifier();
  const r = await v({ id: 'i1' }, 'diff', []);
  assert.equal(r.verdict, 'APPROVE');
});

test('shell verifier: exit 0 approves, non-zero rejects with output', async () => {
  const ok = makeShellVerifier('grep -q . "$BG_DIFF_FILE"'); // diff non-empty -> exit 0
  assert.equal((await ok({ id: 'i' }, 'some diff', [])).verdict, 'APPROVE');
  const bad = makeShellVerifier('echo nope; exit 1');
  const r = await bad({ id: 'i' }, 'd', []);
  assert.equal(r.verdict, 'REJECT');
  assert.match(r.reasons.join(' '), /nope/);
});
