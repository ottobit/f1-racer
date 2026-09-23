# Developer Tooling — Publishing Workflow

Resolves [#4](https://github.com/ottobit/f1-racer/issues/4) (migrated from
`portfolio-arcade#144`): define a publishing flow that applies targeted
patches instead of resending whole files, with SHA/concurrency safety,
multi-file/PR support and documented fallback limits.

## Two publishing paths exist

Which path applies depends on whether the session has a real local git
clone and shell access (Claude Code CLI/web) or only a GitHub contents-API
connector (e.g. a ChatGPT Work session without shell access — see
`WORK-HANDOFF.md`).

### Path A — local git clone (default whenever available)

This is how the current Claude Code sessions on this repository already
operate, and it is patch-based by construction:

- File edits are targeted string replacements on the working tree (an
  editor "Edit" tool, or equivalent), not full-file rewrites. The token/
  payload cost of a change is proportional to the diff, not to the file
  size: a one-line fix in `main.js` (57 KB) or `style.css` (35 KB) costs
  roughly the size of that line, not the whole file.
- `git status` / `git diff --check` before commit are the structural
  check, per `procedure.md`.
- Concurrency protection comes from git itself: `git push` is rejected
  non-fast-forward if `origin/master` moved since the branch was created,
  which forces an explicit fetch + merge/rebase instead of silently
  clobbering someone else's commit. No manual SHA bookkeeping is needed.
- Multi-file changes and PR creation are native: any number of files can
  be edited in the working tree and land in one commit; the PR is opened
  against that pushed branch through the GitHub API/MCP tool, which only
  needs branch/PR metadata, not file content.

**Rule:** when a local git clone is available, always use it (edit files
locally, `git commit`, `git push -u origin <branch>`, then open the PR).
Do not call the GitHub contents API (`create_or_update_file`, `push_files`,
`delete_file`) for source changes in that case — those exist for Path B.

### Path B — contents-API-only session (no shell/git)

For a session that can only reach GitHub through its contents API (no
local clone), full file content is unavoidable per call — there is no
diff/patch endpoint on GitHub's contents API today (Open: revisit if
GitHub adds one).

- `create_or_update_file` requires the current file's `sha`. Always fetch
  that `sha` immediately before writing, not a value read earlier in the
  session — a stale SHA is exactly the concurrent-update hazard this
  parameter exists to catch, and GitHub rejects a mismatched SHA rather
  than silently overwriting.
- For a change touching several files, prefer `push_files` (one commit
  covering many files) over sequential `create_or_update_file` calls (one
  commit per file, and each one still needs its own fresh SHA).
- Known limit: both calls still require the complete new file content, so
  Path B cannot itself avoid the full-file payload cost. The only real
  mitigation available from this side is keeping the touched files small —
  the same direction as the `main.js` decomposition (`race-audio.js`,
  `race-weather.js`, done under the now-closed
  [#3](https://github.com/ottobit/f1-racer/issues/3)/ex-portfolio-arcade#143):
  smaller, focused modules mean a Path B edit resends less unrelated code.

## Recommendation

Prefer Path A whenever a local clone is available — it already gives
patch-level payload, native SHA-free concurrency safety and multi-file/PR
support with no extra tooling. Treat Path B as a constrained fallback for
shell-less sessions, and keep leaning on the `main.js`/`style.css`
modularization work as the practical lever to shrink its cost, since no
GitHub API-level patch mechanism exists to shrink it directly.

See also: [roadmap.md](roadmap.md), [architecture.md](architecture.md).
