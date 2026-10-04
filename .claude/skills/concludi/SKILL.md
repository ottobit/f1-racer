---
name: concludi
description: Close the current work cycle of f1-racer (maintenance log entry, PR ready, merge, pull master, delete branch). Use when the user types /concludi or the literal "Concludi".
---

# Concludi — close the current work cycle

Follow `llm-wiki/AGENTS.md` (Session workflow). Talk to the user in Italian;
log entry and commit message in English. No browser tests.

1. **Identify the cycle**: current branch must be `cycle/<N>-...`; `<N>` is
   the issue number. Find its open PR (head = this branch). If on `master`
   or no PR exists, stop and tell the user.
2. **Clean tree**: `git status` must be clean and the branch pushed. If there
   are uncommitted changes, stop and ask.
3. **Log entry**: append to `llm-wiki/wiki/log.md` one section in the
   existing style:
   `## [<YYYY-MM-DD>] cycle | <short title> (#<N>)` followed by 3-6 bullets (files
   touched and why, decisions, known limits, how it was verified). Build it
   from `git log master..HEAD` and the PR diff, not from memory.
   Also set the release number shown in-page, `<R>`: the PR's number, or
   `origin/master`'s badge + 1 if the PR number is not above it (the badge
   must only go up, or it stops telling a stale cached page from a fresh
   one): `sed -i -E 's#(shared/version\.js\?v=)[0-9]+#\1<R>#' *.html`.
   Commit (`git diff --check` first) and push.
4. **Ready + merge**: mark the PR ready for review, then merge it (merge
   method `merge`) with a commit message containing `Closes #<N>`.
5. **Sync**: `git checkout master && git pull origin master`, then
   `git branch -D cycle/<N>-...` and `git push origin --delete cycle/<N>-...`
   (if the remote delete is refused, tell the user to delete it on GitHub).
6. **Subscriptions**: unsubscribe this session from the PR's activity.
7. **Reply** (short, Italian): PR merged, the version the page must show
   (`v<R>`, bottom centre), what the user should test in game,
   any branch left to delete, and finally remind: "Ora lancia `/compact`"
   (`/compact` is a client command — the skill cannot run it).
