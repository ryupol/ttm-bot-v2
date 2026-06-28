# Reuse First Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one configured account fan out across multiple bot sessions.

**Architecture:** Add a schema flag on account config, then isolate bot account selection in a pure helper under `src/config/accounts.ts`. Main startup uses that helper before spawning workers.

**Tech Stack:** TypeScript, Zod, YAML, Vitest.

---

### Task 1: Config Schema

**Files:**
- Modify: `src/config/schema.ts`
- Test: `tests/config.test.ts`

- [ ] Write a failing test that loads `reuse_first_account: true`.
- [ ] Run `npm test -- tests/config.test.ts`.
- [ ] Add `reuse_first_account` to `AccountFileSchema` with default `false`.
- [ ] Run `npm test -- tests/config.test.ts`.

### Task 2: Startup Account Selection

**Files:**
- Create: `src/config/accounts.ts`
- Modify: `src/main.ts`
- Test: `tests/config.test.ts`

- [ ] Write failing tests for one account fanning out to bot ids 1 through 5 and default behavior remaining unchanged.
- [ ] Run `npm test -- tests/config.test.ts`.
- [ ] Export `selectBotAccounts` from `src/config/accounts.ts` and use it for `selectedAccounts`.
- [ ] Run `npm test -- tests/config.test.ts`.

### Task 3: Defaults And Docs

**Files:**
- Modify: `config/accounts.yaml`
- Modify: `secrets/.env.example`
- Modify: `README.md`

- [ ] Update sample account config to one reusable account.
- [ ] Sanitize tracked `.env.example` to placeholder values.
- [ ] Document `reuse_first_account`.
- [ ] Run `npm run typecheck` and `npm test`.
