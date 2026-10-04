# LLM Wiki Agent Instructions

This directory implements a lightweight version of Andrej Karpathy's LLM Wiki
pattern for this repository.

## Purpose

Use this wiki to preserve durable project knowledge that would otherwise be lost
in chat history: architecture, decisions, constraints, regressions, open design
questions and handoff notes.

The wiki is not a replacement for code, tests, issues or pull requests. It is a
compiled memory layer that helps future agents and maintainers start from the
current project understanding instead of rediscovering it.

## Structure

- `sources/` contains immutable source notes. These summarize external or
  repository sources that informed the wiki.
- `wiki/` contains synthesized pages maintained by the LLM.
- `wiki/index.md` is the entry point and map.
- `logs/` contains append-only ingest and maintenance logs.

## Source Rules

- Treat `sources/` as read-mostly. Add new files for new inputs instead of
  rewriting older source notes unless correcting an obvious transcription error.
- Every synthesized wiki claim should be traceable to code, issue/PR history,
  existing repository docs or a file in `sources/`.
- If a claim is uncertain, mark it as `Open` or `Needs verification` instead of
  presenting it as settled.

## Wiki Rules

- Prefer short, focused pages over one large document.
- Keep pages useful for agents first: file paths, module names, issue numbers,
  invariants and current limitations matter more than polished prose.
- Link related pages with relative markdown links.
- Update existing pages when a decision changes; keep a short note in the
  maintenance log explaining what changed and why.
- Do not copy large external documents into the repo. Store a source summary and
  a canonical link.

## Workflows

### Ingest

1. Add a source note in `sources/` when an external idea, issue thread, PR or
   handoff materially changes project knowledge.
2. Update one or more pages under `wiki/`.
3. Update `wiki/index.md` when a new topic page is added.
4. Append a log entry under `logs/`.

### Query

1. Start from `wiki/index.md`.
2. Read the smallest set of pages that answer the question.
3. Fall back to source notes, code and issues when a wiki page is incomplete or
   stale.
4. If the answer uncovers reusable knowledge, file it back into the wiki.

### Lint

Periodically check for:

- pages listed in `wiki/index.md` that no longer exist;
- important files or modules with no wiki coverage;
- stale claims after merged PRs;
- untracked open questions that should become issues;
- source notes that are not reflected in any wiki page.

## Local Policy

For this repository, keep `docs/F1-RACER-WIKI.md` as the compact
technical handoff, and use this LLM Wiki as the broader memory system that
connects architecture, decisions, roadmap and external patterns.
## Session workflow (user rules)

- Talk to the user in Italian; commits, code and code comments in English.
- Flow per work cycle (not per change): one GitHub issue -> one branch ->
  one draft PR (Italian body). Each change in the cycle is its own commit
  on that branch (`node --check` + `git diff --check` before each), pushed
  as it lands. When the work is done, stop at the draft PR and report;
  close the cycle only when the user says "Concludi" (user's rule,
  2026-09-27) — steps in the
  `concludi` skill: one `logs/maintenance.md` entry, ready, merge
  ("Closes #N"), pull `master`, delete branch; then remind the user to
  run `/compact`.
- Risky changes (multiplayer protocol, start/race flow) get their own cycle.
- Object-oriented design is a standing rule (user, 2026-10-04): before
  writing code read `wiki/f1-racer/oop.md` and follow it — variants are
  subclasses behind one interface, no type switches in callers, a rule
  shared by all variants lives once at the common entry point.
- Every relative client import/script/link carries a `?vNN` query (a new
  import starts at `?v=1`); bump it on every import/script/link whose file
  changed, all the way up to the HTML page. Unversioned imports can be
  served stale from the GitHub Pages cache (~10 min) after a deploy.
- The release badge (`shared/version.js?v=` on every page) is the merged
  cycle PR's number, set by `Concludi`; it never goes down.
- Token budget matters (user's explicit request, 2026-09-24):
  - no browser/Playwright tests — syntax checks only; the user plays on
    `master` and reports (browser tests only if the user asks);
  - docs: one entry in `logs/maintenance.md` per cycle; touch `wiki/`
    pages, `docs/F1-RACER-WIKI.md` or `docs/RELEASE-CHECKLIST.md` only when
    architecture or a decision changes;
  - no scheduled check-ins (no CI here); the platform auto-subscribes
    the session when a PR is created — leave it, don't spend a call
    removing it mid-cycle; `Concludi` unsubscribes;
  - short replies: what was done, what the user must decide.
- Play sessions: whenever the user wants to play/race against agents
  (inferred from intent, any wording, a room-server URL or a room code),
  read only `.claude/skills/procedure-racing/procedure-racing.md` and follow it — no wiki,
  no issue/branch/PR. Your role there needs no explaining: you direct one
  or more bots (default 5) and decide their strategy live yourself.
