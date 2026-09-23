# F1 Racer — ChatGPT Work Handoff

This file is the compact entry point for a new ChatGPT Work session. Do not treat it as a replacement for the technical wiki; use it to load the right context quickly.

## Read first

1. `procedure.md` — mandatory repository workflow.
2. `WORK-HANDOFF.md` — this operational snapshot.
3. `F1-RACER-WIKI.md` — architecture and current behavior.
4. `RELEASE-CHECKLIST.md` — release/regression gates.
5. Inspect the current files and open GitHub issues/PRs before changing code. Repository state wins over this snapshot if they differ.

## Publishing files without a local git clone

If this session has no shell/git access and can only reach GitHub through a
contents-API connector, read
[`llm-wiki/wiki/f1-racer/tooling.md`](llm-wiki/wiki/f1-racer/tooling.md)
before writing any file. It documents the SHA/concurrency rules and the
multi-file commit path for that mode. If a real git clone is available
instead, prefer it: it gives true patch-level edits, native push
concurrency safety and needs none of that connector-specific handling.

## Repository / project

- Repository: `ottobit/f1-racer`
- Default branch: `master`
- Browser-only Three.js game; Three.js is imported from CDN.
- No Vite/backend and currently no automated browser test suite/CI.
- Core runtime is still mostly in `main.js`.
- Garage: `garage.html`, `garage.js`, `garage-setup.js`.
- Circuit/championship data: `circuits.js`, `championship.js`.

## Current gameplay snapshot

F1 Racer currently includes qualifying, grid/race flow, championship progression, AI rivals, DRS, ERS, tyre degradation, pit strategy, rain/wet grip, damage/effects, ghost laps, keyboard/touch controls, Garage setup modifiers and evolved combined-grip player dynamics.

Recent work made the chase camera closer, enriched the procedural F1 car, aligned the Garage car with the race model, added explicit Garage mounting targets, validated completed laps before showing race results, and changed car-to-car collision response to use relative contact velocity rather than a fixed speed cut.

The car is procedural Three.js geometry, not GLB/GLTF. Do not claim imported production car assets exist unless the repository changes.

## Non-negotiable workflow

Follow `procedure.md` exactly. In short:

- create/identify a labelled issue;
- branch from updated `master`;
- develop only on that branch;
- test what can actually be tested;
- commit/push branch;
- open PR to `master`;
- run/review release gates;
- default: leave PR open until the user says exactly `Concludi`;
- only auto-merge when auto-conclusion was explicitly agreed before development;
- never commit/push directly to `master`;
- when several PRs are ready, conclude them in ascending PR number unless an explicit technical dependency requires otherwise.

Issue/PR labels: `bug`, `enhancement`, `documentation` as applicable.

## Testing rule

Never report a test as passed unless it was actually executed. Source inspection/static assertions are not browser/runtime tests. If Work has browser/computer capabilities, use them for F1 Racer changes whenever practical: load the page, check console/runtime, render first frame, exercise the changed flow, and test relevant desktop/mobile interactions. If a required environment is unavailable, write **non testato** in the PR/release report.

Keep `RELEASE-CHECKLIST.md` updated when a bug or feature creates a useful regression gate.

## Engineering direction

Prefer incremental improvements that preserve mobile performance. Keep visual geometry independent from gameplay collision dimensions unless intentionally redesigning physics. Avoid duplicating race and Garage car construction further; shared car-building code is a useful future refactor. The current collision model is lightweight, not a full rigid-body simulation. The current driving model is deliberately between arcade and simulation rather than a full tyre/vehicle dynamics model.

Before making assumptions, inspect current `master`, because this handoff is intentionally compact and can become stale.

## Work startup prompt

Use this when opening a fresh Work session:

> Open the GitHub repository `ottobit/f1-racer`. First read `procedure.md`, `WORK-HANDOFF.md`, `F1-RACER-WIKI.md`, and `RELEASE-CHECKLIST.md`. Inspect current master plus open issues/PRs before acting. Follow the repository procedure strictly: issue → branch → development → real tests where available → commit/push → PR → release test. Never write directly to master. Unless auto-conclusion was explicitly agreed before development, leave the PR open until I say `Concludi`. Do not call static/source checks runtime tests; mark unavailable tests `non testato`. Then handle my requested F1 Racer task.
