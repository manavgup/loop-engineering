import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Pluggable, model-agnostic implementer: runs a configured shell command that is expected to
// edit the working tree to fix the item. The item + prompt are exposed via env so ANY tool
// (a script, sed, or an LLM CLI like `claude -p "$BG_PROMPT"`) drops in without the harness
// hardcoding a model. The command runs in process.cwd() (the target repo).
export function makeShellImplementer(command) {
  return async (item, prompt) => {
    execFileSync('sh', ['-c', command], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BG_ITEM_ID: item.id || '', BG_ITEM_TITLE: item.title || '',
        BG_ITEM_PATH: item.path || '', BG_ITEM_FIX: item.fix || '',
        BG_PROMPT: prompt || '',
      },
      stdio: 'inherit',
    });
    return { ok: true };
  };
}

// Pluggable verifier. With no command, defaults to APPROVE — the hybrid checker's HARD checks
// (gate ∧ coverage ∧ guards) already gated the commit; the verifier is the optional semantic
// layer. A configured command sees the diff (via BG_DIFF_FILE) and guard warnings; exit 0 =
// APPROVE, non-zero = REJECT (its output becomes the rejection reason).
export function makeShellVerifier(command) {
  if (!command) {
    return async () => ({ verdict: 'APPROVE', reasons: ['no verifier configured; hard checks only'] });
  }
  return async (item, diff, warnings = []) => {
    const dir = mkdtempSync(join(tmpdir(), 'bg-verify-'));
    const diffFile = join(dir, 'diff.patch');
    writeFileSync(diffFile, diff || '');
    try {
      execFileSync('sh', ['-c', command], {
        cwd: process.cwd(),
        env: { ...process.env, BG_ITEM_ID: item.id || '', BG_DIFF_FILE: diffFile, BG_WARNINGS: (warnings || []).join('\n') },
        stdio: 'pipe', encoding: 'utf8',
      });
      return { verdict: 'APPROVE', reasons: [] };
    } catch (e) {
      return { verdict: 'REJECT', reasons: [`${e.stdout || ''}${e.stderr || ''}`.trim() || 'verifier rejected'] };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
