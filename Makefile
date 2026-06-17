# Backlog-grinder harness — convenience targets. Lives at the repo root so a bare
# `make <target>` works from here. (If this fork is ever PR'd upstream, drop or relocate
# this file — a root Makefile is a repo-wide convention the upstream maintainer didn't choose.)
#
# `make test` is the canonical way to run the suite — it uses the version-proof glob form,
# so you never hit the `node --test <dir>/` directory-positional gap on Node < 24.

ROOT    := $(shell git rev-parse --show-toplevel)
SCRIPTS := $(ROOT)/starters/backlog-grinder-claude/scripts
BASE    ?= HEAD

.PHONY: help test test-cov self-coverage validate check all

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

test: ## Run the harness test suite (version-proof; avoids the dir-positional gap)
	node --test '$(SCRIPTS)'/*.test.mjs

test-cov: ## Run the suite with a V8 line/branch coverage report
	node --test --experimental-test-coverage '$(SCRIPTS)'/*.test.mjs

self-coverage: ## Dogfood the coverage backbone on changed lines (override base: make self-coverage BASE=origin/main)
	node '$(SCRIPTS)'/self-coverage.mjs $(BASE)

validate: ## Upstream registry guard — must stay green
	cd '$(ROOT)' && npm run validate:registry

check: ## Upstream loop-init sync guard — must stay green
	cd '$(ROOT)' && npm run check:loop-init

all: test validate check ## The full definition-of-done gate (suite + both upstream guards)
