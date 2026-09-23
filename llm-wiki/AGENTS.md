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

For ``, keep `F1-RACER-WIKI.md` as the compact
technical handoff, and use this LLM Wiki as the broader memory system that
connects architecture, decisions, roadmap and external patterns.