import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeGit } from './git-adapter.mjs';

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }); }
async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'bg-git-'));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t.t'); git(dir, 'config', 'user.name', 't');
  await writeFile(join(dir, 'a.txt'), '1\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('diff stages untracked + tracked and shows them against HEAD', async () => {
  const dir = await repo(); const g = makeGit();
  await writeFile(join(dir, 'a.txt'), '2\n');   // modify tracked
  await writeFile(join(dir, 'b.txt'), 'new\n'); // add untracked
  const d = await g.diff(dir);
  assert.match(d, /a\.txt/); assert.match(d, /b\.txt/);
  await rm(dir, { recursive: true, force: true });
});

test('commit advances HEAD; head returns the new sha', async () => {
  const dir = await repo(); const g = makeGit();
  const before = await g.head(dir);
  await writeFile(join(dir, 'a.txt'), '2\n');
  await g.commit(dir, 'change a');
  const after = await g.head(dir);
  assert.notEqual(before, after);
  assert.match(git(dir, 'log', '--oneline'), /change a/);
  await rm(dir, { recursive: true, force: true });
});

test('restore resets tracked AND removes untracked (§7)', async () => {
  const dir = await repo(); const g = makeGit();
  await writeFile(join(dir, 'a.txt'), 'CORRUPT\n');
  await writeFile(join(dir, 'junk.txt'), 'leak\n');
  await g.restore(dir);
  assert.equal(git(dir, 'show', 'HEAD:a.txt'), '1\n');
  assert.equal(existsSync(join(dir, 'junk.txt')), false);
  await rm(dir, { recursive: true, force: true });
});
