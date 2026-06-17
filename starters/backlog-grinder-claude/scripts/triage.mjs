const ORDER = { critical: 0, high: 1, medium: 2, low: 3, unspecified: 4 };

export function summarize(items) {
  const bySeverity = {};
  const byCategory = {};
  let stale = 0;
  for (const it of items) {
    bySeverity[it.severity] = (bySeverity[it.severity] || 0) + 1;
    byCategory[it.category] = (byCategory[it.category] || 0) + 1;
    if (it.stale) stale += 1;
  }
  return { total: items.length, stale, queueable: items.length - stale, bySeverity, byCategory };
}

// Deny is injected, never hardcoded (concept §7 — no module carries assumptions).
// Segment match so 'auth' flags backend/auth/x.py but not backend/oauth_helper.py.
function denylistFlag(it, deny) {
  const segs = `${it.path}`.split(/[/. :]/);
  const hit = deny.some((d) => it.path.startsWith(d.replace(/\/$/, '') + '/') || segs.includes(d));
  return hit ? ' [DENYLIST: human gate]' : '';
}

export function toStateMarkdown(items, { projectName = 'Backlog Grinder', lastRun = '(not yet run)', deny = [] } = {}) {
  const s = summarize(items);
  const queue = items.filter((it) => !it.stale && !it.checked)
    .sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9));
  const stale = items.filter((it) => it.stale);
  const out = [
    `# Loop State — ${projectName}`, '',
    `Last run: ${lastRun}`, '',
    '## Summary', '',
    `- Total: ${s.total} | Queueable: ${s.queueable} | Stale: ${s.stale}`,
    `- By severity: ${JSON.stringify(s.bySeverity)}`,
    `- By category: ${JSON.stringify(s.byCategory)}`, '',
    '## High Priority (queueable, sorted by severity)', '',
  ];
  for (const it of queue) {
    out.push(`- [ ] ${it.id} — ${it.title}${denylistFlag(it, deny)}`);
    out.push(`  ${it.severity}/${it.effort} · ${it.category} · ${it.path}`);
    out.push('  Loop action: (none yet)');
  }
  out.push('', '## Stale / needs human re-validation (NOT auto-queued)', '');
  for (const it of stale) out.push(`- ${it.id} — ${it.title} · ${it.path} (evidence no longer matches tree)`);
  out.push('', '## Lessons (accrued across items)', '', '## Recent Noise', '', '---');
  out.push(`Run log: ${lastRun} | total ${s.total} | queueable ${s.queueable} | stale ${s.stale}`);
  return out.join('\n') + '\n';
}
