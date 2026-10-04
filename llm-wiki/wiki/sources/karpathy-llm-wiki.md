---
type: source
updated: 2026-10-04
raw: []
---

# Source Note: Karpathy LLM Wiki

Source: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f  
Author: Andrej Karpathy  
Created: 2026-04-04  
Ingested: 2026-09-20

## Summary

The LLM Wiki pattern proposes a persistent markdown knowledge base maintained by
an LLM. Instead of retrieving raw documents from scratch for every question, the
LLM incrementally compiles sources into wiki pages, keeps cross-references
current, and records contradictions or evolving synthesis.

The core architecture has three layers:

- raw sources: immutable documents and source notes;
- wiki: LLM-written markdown pages with summaries, entities, concepts and
  synthesis;
- schema: instructions that define the wiki structure and maintenance workflow.

The primary operations are:

- ingest: read a new source, update relevant wiki pages and log the change;
- query: answer from the wiki first, falling back to sources only as needed;
- lint: periodically find stale claims, contradictions, gaps and broken links.

## Local Interpretation

For F1 Racer the wiki is repo-native (restructured to the gist's page types
in #373):

- immutable inputs live in `llm-wiki/raw/`; one summary per source in
  `llm-wiki/wiki/sources/`;
- the wiki layer has `entities/`, `concepts/`, `synthesis/`, `comparisons/`,
  an `overview.md`, the `index.md` catalog and the `log.md` history;
- `llm-wiki/AGENTS.md` is the schema;
- links stay relative markdown (GitHub renders them; Obsidian reads them).

The gist itself says the exact layout is up to each project ("This document
is intentionally abstract… The exact directory structure… will depend on
your domain"); the folders above map its page types one to one.
