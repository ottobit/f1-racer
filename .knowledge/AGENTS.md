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

Follows the three layers of Karpathy's LLM Wiki (raw sources, wiki,
schema); restructured in #373.

The folder is `.knowledge/` (renamed from `llm-wiki/` in #373). Being a dot
folder, it is skipped by default by ripgrep-based search and some file
globs: search it with an explicit path (`.knowledge/`) or `rg --hidden`.

```
.knowledge/
  AGENTS.md        the schema: these rules
  raw/             immutable inputs (reports, transcripts, logs); never edited
  wiki/
    index.md       catalog: every page, one line, by type
    log.md         append-only history, "## [YYYY-MM-DD] <kind> | <title>"
    overview.md    the game in one page
    sources/       one summary page per source (external or raw)
    entities/      concrete parts of the game (a system, a page, a server)
    concepts/      ideas that cut across the code (rules, models, budgets)
    synthesis/     the whole picture (architecture, decisions, roadmap, C4)
    comparisons/   side-by-side analyses of alternatives
```

Every page except `index.md` and `log.md` starts with YAML frontmatter:

```yaml
---
type: entity | concept | synthesis | comparison | source | overview
updated: YYYY-MM-DD
sources:            # for a source page: raw:
  - ../sources/<file>.md
---
```

## Source Rules

- Files in `raw/` are immutable: add new files, never rewrite them.
- A source page in `wiki/sources/` summarizes one input (a raw file, an
  external article, an issue thread) and links it; correct it only for
  obvious transcription errors.
- Every wiki claim should be traceable to code, issue/PR history or a
  source page; list the source pages in the frontmatter.
- If a claim is uncertain, mark it as `Open` or `Needs verification` instead of
  presenting it as settled.

## Wiki Rules

- Prefer short, focused pages over one large document; pick the type
  folder by what the page is about, not by when it was written.
- Keep pages useful for agents first: file paths, module names, issue numbers,
  invariants and current limitations matter more than polished prose.
- Link related pages with relative markdown links (they work on GitHub and
  in Obsidian; `[[wikilinks]]` would not render on GitHub).
- Update existing pages when a decision changes, bump `updated`, and log it.
- Do not copy large external documents into the repo. Store a source summary and
  a canonical link.

## Workflows

### Ingest

1. Put the raw input in `raw/` (or keep only a link if it is external).
2. Write its summary in `wiki/sources/`.
3. Update every entity/concept/synthesis page it touches.
4. Update `wiki/index.md` for new pages.
5. Append `## [date] ingest | <title>` to `wiki/log.md`.

### Query

1. Start from `wiki/index.md` (or `overview.md`).
2. Read the smallest set of pages that answer the question.
3. Fall back to source pages, code and issues when a wiki page is incomplete
   or stale.
4. If the answer uncovers reusable knowledge, file it back into the wiki
   (a new comparison or synthesis page is fine).

### Lint

Periodically check for, and log as `## [date] lint | …`:

- pages listed in `wiki/index.md` that no longer exist, and pages missing
  from it;
- contradictions between pages, stale claims after merged PRs;
- important files or modules with no wiki coverage;
- untracked open questions that should become issues;
- source pages not reflected in any other page.

## Local Policy

All project knowledge lives in this wiki (user, 2026-10-04): one short page
per topic under `wiki/<type>/`. `docs/` keeps only the operational files
(`procedure.md`, `WORK-HANDOFF.md`, `RELEASE-CHECKLIST.md`) and links here.
## Session workflow (user rules)

- Talk to the user in Italian; commits, code and code comments in English.
- Flow per work cycle (not per change): one GitHub issue -> one branch ->
  one draft PR (Italian body). Each change in the cycle is its own commit
  on that branch (`node --check` + `git diff --check` before each), pushed
  as it lands. When the work is done, stop at the draft PR and report;
  close the cycle only when the user says "Concludi" (user's rule,
  2026-09-27) — steps in the
  `concludi` skill: one `wiki/log.md` entry (`cycle`), ready, merge
  ("Closes #N"), pull `master`, delete branch; then remind the user to
  run `/compact`.
- Risky changes (multiplayer protocol, start/race flow) get their own cycle.
- Small files per context, no clones (user, 2026-10-04): a new topic gets
  one short page in the right `wiki/<type>/` folder, listed in
  `wiki/index.md`; never
  grow a page into a catch-all and never copy a wiki page into `docs/` —
  link it instead.
- Object-oriented design is a standing rule (user, 2026-10-04): before
  writing code read `wiki/concepts/oop.md` and follow it — variants are
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
  - docs: one entry in `wiki/log.md` per cycle; touch `wiki/`
    pages or `docs/RELEASE-CHECKLIST.md` only when
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
