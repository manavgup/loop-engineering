#!/usr/bin/env node
// backlog-grind — CLI entry. Reads a JSON config, drains a finite backlog against a repo.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runGrind } from '../scripts/cli.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      args[key] = next !== undefined && !next.startsWith('--') ? argv[++i] : true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

const HELP = `backlog-grind — drain a finite backlog against a repo (model-agnostic, no LLM required).

Usage:
  backlog-grind --config grinder.config.json [--repo DIR] [--backlog FILE]

Config (JSON):
  {
    "backlogPath":    "BACKLOG.md",            // markdown backlog (relative to repoCwd)
    "repoCwd":        ".",                      // target git repo
    "gateCmd":        "npm test -- --coverage", // MUST emit a coverage artifact
    "coverage":       { "format": "lcov" | "cobertura", "file": "coverage/lcov.info" },
    "implementerCmd": "claude -p \\"$BG_PROMPT\\"", // edits the tree; sees BG_* env vars
    "verifierCmd":    "(optional) exit 0 = APPROVE, non-zero = REJECT",
    "allow":          ["src/"],                 // scope guard (empty = no allowlist)
    "deny":           ["auth/"],                // hard-stop paths
    "maxAttempts":    3,
    "projectName":    "My Service",
    "budgetSeconds":  0,                        // 0 = unbounded
    "stopFile":       "(optional) touch to halt"
  }

Implementer env vars: BG_ITEM_ID, BG_ITEM_TITLE, BG_ITEM_PATH, BG_ITEM_FIX, BG_PROMPT.
Verifier env vars:    BG_ITEM_ID, BG_DIFF_FILE, BG_WARNINGS.
Flags override config keys: --repo => repoCwd, --backlog => backlogPath.
Exit 0 = complete|drained, 2 = halted (budget/kill/config) or bad usage.`;

const args = parseArgs(process.argv.slice(2));
if (args.help || (!args.config && !args.backlog)) {
  console.log(HELP);
  process.exit(args.help ? 0 : 2);
}

let config = {};
if (args.config) config = JSON.parse(readFileSync(resolve(String(args.config)), 'utf8'));
if (typeof args.repo === 'string') config.repoCwd = args.repo;
if (typeof args.backlog === 'string') config.backlogPath = args.backlog;
if (config.repoCwd) config.repoCwd = resolve(String(config.repoCwd));

const summary = await runGrind(config);
console.log(`\nend state: ${summary.endState}`);
console.log(`counts:    ${JSON.stringify(summary.counts)}`);
console.log(`state:     ${summary.statePath}`);
console.log(`provenance:${summary.provenancePath}`);
console.log(`triage:    ${summary.stateMarkdownPath}`);
process.exit(summary.endState === 'halted' ? 2 : 0);
