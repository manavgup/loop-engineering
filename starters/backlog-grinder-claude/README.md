# backlog-grinder

A model-agnostic **loop-engineering harness**: point it at a git repo and a finite backlog of
findings, and it drains the backlog one item at a time behind a **hybrid checker** — every
change must pass the test gate, be *executed by a test* (coverage-of-change), survive
deterministic scope/tamper guards, and clear an optional verifier — before it is committed.
Anything else is reverted. No LLM is required; the implementer is a shell command you choose.

> The decisive guarantee is not "guards catch a crude cheat" but **"a behavior change cannot be
> committed unless a test executed the changed lines."** That defeats the test-deletion cheat,
> the move-out-of-scope cheat, and the silent no-test fix.

## Requirements

- Node ≥ 20 (uses the built-in test runner + V8 coverage; no runtime dependencies)
- `git`
- A repo whose test command can emit a coverage report (**lcov** or **cobertura/coverage.py XML**)

## Quick start

```bash
# from this package dir
npm test                      # run the harness's own suite (60 tests)

# grind a real repo
node bin/grind.mjs --config grinder.config.json --repo /path/to/target
# or, once linked/installed:  backlog-grind --config grinder.config.json
```

`grinder.config.json`:

```json
{
  "backlogPath": "BACKLOG.md",
  "gateCmd": "npm test -- --coverage",
  "coverage": { "format": "lcov", "file": "coverage/lcov.info" },
  "implementerCmd": "claude -p \"$BG_PROMPT\"",
  "verifierCmd": null,
  "allow": ["src/"],
  "deny": ["src/auth/"],
  "maxAttempts": 3,
  "projectName": "My Service",
  "budgetSeconds": 0,
  "stopFile": ".grind-stop"
}
```

## The backlog format

Markdown checklist; severity from `###`/`####` headings, one finding per `- [ ]`:

```markdown
### 🔴 CRITICAL (1)

#### bug-fix

- [ ] **make compute return 2**  ·  `src/x.mjs:2`  ·  _S/high_
    - _Evidence:_ compute returns 1 but the test expects 2.
    - _Fix:_ change the return to 2.
```

Each item gets a content-hash id. Items whose `path` no longer exists in the tree are parked as
**stale** (never auto-attempted).

## Model-agnostic implementer

`implementerCmd` is any shell command that edits the working tree to fix the current item. The
item and prompt are passed via environment, so you can plug in anything:

| Env var | Meaning |
|---|---|
| `BG_ITEM_ID` / `BG_ITEM_TITLE` / `BG_ITEM_PATH` / `BG_ITEM_FIX` | the finding |
| `BG_PROMPT` | base prompt + prior failure feedback ("don't repeat these approaches") |

```jsonc
// headless Claude:        "implementerCmd": "sh examples/claude-implementer.sh"
// any LLM CLI:            "implementerCmd": "claude -p \"$BG_PROMPT\""
// a deterministic script: "implementerCmd": "./fix.sh \"$BG_ITEM_PATH\""
```

`examples/claude-implementer.sh` is a ready-to-use headless-Claude implementer (it turns the
`BG_*` env into a focused prompt and runs `claude -p --permission-mode acceptEdits`). The
implementer only *edits*; the harness runs the gate — so the implementer can be best-effort and
a bad edit is reverted and retried. `examples/python.config.json` is a pytest/coverage.py
template. Coverage paths are resolved against the cobertura `<source>` root, so both `--cov=.`
and `--cov=mypkg` work.

The **verifier** is optional and also pluggable (`verifierCmd`): it sees the staged diff at
`$BG_DIFF_FILE` and `$BG_WARNINGS`; exit 0 = APPROVE, non-zero = REJECT (its output is the
reason). With no `verifierCmd`, the verifier defaults to APPROVE — the hard checks already gate
the commit.

## How an item is decided (per attempt)

```
implementer(item, prompt) → edits tree
gate (flake-checked: a red is re-run once)        ─ couldn't-run / flaky → park, no attempt spent
guards: scope (allow) ∧ deny ∧ tamper (deleted/weakened tests)
coverage: every changed *source* line was executed by a test   ─ green gate with NO map → halt
verifier (only if all hard checks pass)
  ALL green  → commit → provenance record → mark done
  otherwise  → revert (reset --hard + clean -fd) → record failure → retry or abandon
```

On a retry the prompt names exactly why the last attempt was rejected — gate output, guard
violations, and **uncovered changed lines** ("these lines were not executed by any test; add or
extend a test"). The base prompt also tells the implementer up front that a behavior change with
no covering test will be rejected, so behavior-change findings (fix + test) work without looping.

A repeated failure (same gate+guards+coverage fingerprint) abandons early instead of burning
all attempts. The flake re-run prevents a transient red from throwing away good work.

## Outputs (under `<repo>/.backlog-grinder/`)

- `STATE.md` — human triage view (queue by severity, stale section, denylist flags)
- `state.json` — machine state for **resume** (done items skipped; failures restored)
- `provenance.jsonl` — one append-only audit record per commit: prompt sent, gate output,
  coverage result, guard results, verifier verdict+rationale, final diff, commit sha, lessons
  applied. "Why did the system make this edit and what did it check" — answerable from disk.

Add `cov.info`/your coverage artifact and `.backlog-grinder/` to the target repo's `.gitignore`
so they don't pollute commits.

## End states (exit code)

- **complete** — every queueable item is `done` (exit 0)
- **drained** — no item is pending; the rest are `abandoned`/`parked`/`stale` (exit 0)
- **halted** — work remains: budget/`stopFile` hit, or a config error like a green gate that
  emitted no coverage map (`blocked-coverage-config`) (exit 2)

## Safety & resume

- **Git invariant (§7):** every item starts on a clean tree at the last good commit; revert is
  `git reset --hard HEAD` **+ `git clean -fd`**; only an approved commit advances the pointer.
  For L3-autonomy, run each item in a git worktree so `clean -fd` is scoped.
- **Resume (§8):** re-running picks up where it stopped — `done` items are skipped, pending
  items keep their attempt/failure history.

## Library API

Everything is dependency-injected and importable from the barrel:

```js
import {
  parseBacklog, summarize, toStateMarkdown,
  checkGuards, checkCoverage, runGate, runGateChecked,
  runItem, runQueue,            // the driver
  makeGit, loadCoverage, makeShellImplementer, makeShellVerifier,
  loadState, makeStatePersister, makeProvenanceWriter,
  runGrind,                     // the orchestrator the CLI uses
} from 'backlog-grinder';
```

## Testing the harness itself

```bash
npm test                 # 60 tests, all synthetic — zero network, zero real LLM
npm run test:cov         # with a V8 coverage report
npm run self-coverage    # dogfood: are THIS repo's own changed lines test-executed?
```

The suite includes a real end-to-end (`scripts/cli.e2e.test.mjs`) that grinds a temp git repo
with a shell implementer and a real lcov gate — the standalone tool, proven without a model.

## Known limits

- Coverage proves **execution**, not assertion quality (`assert True` padding still satisfies
  it); the assertion guard is a *count* (catches drops, not substitution). Closing that is the
  verifier's / human reviewer's job.
- Scope is **per-run** (`allow`/`deny`), not per-item.
- The crash-between-commit-and-marker reconcile (`state.reconcile`) is implemented and unit
  tested but not yet wired into the driver loop.
