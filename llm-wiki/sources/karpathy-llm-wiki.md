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

For `portfolio-arcade`, the wiki is repo-native:

- external sources are summarized under `llm-wiki/sources/`;
- durable project knowledge lives under `llm-wiki/wiki/`;
- `llm-wiki/AGENTS.md` is the local schema;
- existing F1 Racer docs remain valid and are linked instead of duplicated.

This keeps the system cheap to maintain and easy to review in pull requests.