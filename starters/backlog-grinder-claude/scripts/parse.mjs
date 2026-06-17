import { createHash } from 'node:crypto';

const ITEM_RE = /^- \[( |x|X)\]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const CONT_RE = /^\s+- _([A-Za-z]+):_\s*(.*)$/;
const SEVERITIES = ['critical', 'high', 'medium', 'low'];

function severityFromStack(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const t = stack[i].text.toLowerCase();
    for (const s of SEVERITIES) if (t.includes(s)) return s;
  }
  return 'unspecified';
}

function categoryFromStack(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].level >= 4) return stack[i].text.trim();
  }
  return '';
}

function parseMeta(remainder) {
  const parts = remainder.split('·').map((p) => p.trim());
  const title = (parts[0] || '').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
  let path = '';
  let effort = '';
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('`')) path = p.replace(/`/g, '').trim();
    else if (p.startsWith('_')) effort = p.replace(/_/g, '').trim().split('/')[0].trim();
  }
  return { title, path, effort };
}

export function parseBacklog(markdown) {
  const lines = markdown.split('\n');
  const items = [];
  const stack = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(HEADING_RE);
    if (h) {
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: h[2].trim() });
      current = null;
      continue;
    }
    const m = lines[i].match(ITEM_RE);
    if (m) {
      const { title, path, effort } = parseMeta(m[2]);
      current = {
        id: createHash('sha1').update(`${title}|${path}`).digest('hex').slice(0, 12),
        title, path, effort,
        severity: severityFromStack(stack),
        category: categoryFromStack(stack),
        evidence: '', fix: '',
        line: i + 1,
        checked: m[1].toLowerCase() === 'x',
      };
      items.push(current);
      continue;
    }
    const c = lines[i].match(CONT_RE);
    if (c && current) {
      const label = c[1].toLowerCase();
      if (label === 'evidence') current.evidence = c[2].trim();
      else if (label === 'fix') current.fix = c[2].trim();
    }
  }
  return items;
}

export function parsePathRef(pathField) {
  const first = pathField.split(/\s+and\s+|,/)[0].trim();
  const m = first.match(/^(.*?):(\d+)/);
  if (m) return { file: m[1], line: Number(m[2]) };
  return { file: first, line: null };
}

export function isStale(item, fileExists) {
  if (!item.path) return true;
  return !fileExists(parsePathRef(item.path).file);
}
