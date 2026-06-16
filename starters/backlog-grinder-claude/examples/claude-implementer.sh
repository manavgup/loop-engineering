#!/bin/sh
# backlog-grinder implementer backed by headless Claude Code.
#
# Wire it in as `implementerCmd` in your grinder config:
#   "implementerCmd": "sh examples/claude-implementer.sh"
#
# The grinder passes the current finding via BG_* env vars. This script turns them into a
# focused prompt and runs `claude -p` headlessly so Claude edits the working tree in place.
# The hybrid checker (gate + coverage + guards + verifier) decides whether the edit commits;
# a bad edit is reverted and retried with feedback, so the implementer can be "best effort".
#
# Permissions: --permission-mode acceptEdits auto-accepts file edits. For a fully unattended
# run in a SANDBOXED/disposable checkout (e.g. a git worktree per item), use
# --dangerously-skip-permissions instead. Never use that flag on a repo you can't throw away.
set -e

PROMPT="You are fixing exactly ONE finding in this repository. Work only in this repo.

File:        ${BG_ITEM_PATH}
Finding:     ${BG_ITEM_TITLE}
Suggested:   ${BG_ITEM_FIX}

${BG_PROMPT}

Rules:
- Make the SMALLEST change that fixes ONLY this finding.
- If your change alters behaviour, make sure a test executes the changed lines (add or extend
  a test if none does) — but never weaken, skip, or delete an existing test.
- Do not touch unrelated files. Stop when done."

exec claude -p "$PROMPT" --permission-mode "${BG_CLAUDE_PERMISSION_MODE:-acceptEdits}"
