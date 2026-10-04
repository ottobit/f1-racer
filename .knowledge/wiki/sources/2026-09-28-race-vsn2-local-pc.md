---
type: source
updated: 2026-10-04
raw:
  - ../../raw/2026-09-28-race-vsn2-fleet-log.txt
  - ../../raw/2026-09-28-race-vsn2.md
---

# Race VSN2 from the player's PC (2026-09-28)

Source: the first play session run entirely on the user's PC (#244): room
server, bots and agent on one Windows 10 machine, agent started with
`claude remote-control`. Raw material, kept verbatim:
[raw report](../../raw/2026-09-28-race-vsn2.md) (written by the local agent) and
[fleet log](../../raw/2026-09-28-race-vsn2-fleet-log.txt). Claims below were
re-checked against the code at `master` 45f9a08; where the raw report was
wrong, this note says so.

## Setup

| Item | Value |
|---|---|
| Machine | Windows 10, NVIDIA GeForce GT 640 (entry-level, 2012) |
| Room server | `ws://localhost:8787`, no ngrok, no relay |
| Command | `node core/tools/bot-fleet.mjs ws://localhost:8787 VSN2 --count 5 --gpu` |
| WebGL | `ANGLE (NVIDIA ... GT 640 ... Direct3D11)`: real GPU, not SwiftShader |
| Races | 2 × 5 laps, dry; race 2 was the rematch |

## Performance

| Run | Bots | `botFps` |
|---|---|---|
| Cloud box, 4 cores, software GL (3WK4, #239) | 5 | 49–51 at the start, 59–60 later |
| User PC, GT 640 with `--gpu`, race 1 | 5 | 50–51 at the start, then 60 flat |
| User PC, GT 640 with `--gpu`, race 2 | 5 | 51–60; most dips land near the agent's decision rounds |

- 5 bots do not tell the GPU apart: both setups sit at the 60 fps cap.
  Telling them apart needs 8–11 bots.
- In race 2 most dips to ~51 fps came near the agent's decision rounds
  (22:30:43, 22:32:53, 22:34:03). Race 1, with no decisions, stayed at
  60. Hypothesis: the agent's own processes compete for CPU with the bots
  on the same PC.
- Human's view: no jumping remote cars (user, 2026-09-28). With room
  server and bots on one PC, no ngrok and no relay, the residual jump seen
  on the cloud setup is gone: it was the network path.

## Strategy

- Race 1: the agent set every bot's plan before lights out and made no
  live decision for the whole race, against the live-strategy rule.
  Race 2 was managed live: watch → decide → write, about one round every
  25 s.
- Race 2 result: b5 P2, b3 P3, b4 P4, b2 P5, b1 P6.
- Double stop: b1 and b2 were at 98% wear, still showing `pit none`. The
  agent sent `pit:true` again although the first call was still armed, so
  both stopped twice and fell to P6 and P5.
  - The raw report says `state.json` hides the pending call. That is wrong:
    `pit.requested` is there (`agent-api.js:158`). It was `bot-watch.mjs`
    that did not print it (fixed in #246).
- Wear counter: the % runs at ~33% a lap for every compound. It is
  `tyreProgress / TYRE_LIFE_LAPS`, and `race-progress.js` adds no compound
  factor.
  - The compound's `wearRate` (soft 1.35, medium 1.0, hard 0.75,
    `race-rules.js:41-44`) scales how much grip and top speed a given %
    costs, not how fast the % grows.
  - The raw report's "hard wears slower" is therefore wrong: its own
    numbers (6% → 100% in ~3 laps) are the same 33% a lap.
- Over 5 laps every tyre reaches 100% by lap 3, so non-stoppers run the
  last two laps at the maximum penalty.
- A stop also cuts damage to 25% (`race-systems.js:100`): worth it for
  damaged cars whatever the tyre state.

## Anomalies (issues)

| Id | What | Status |
|---|---|---|
| A1 | Applied pace ≠ requested: damage > 20% caps it at 0.75, `attack` adds +0.035 | Not a bug; `bot-watch` now prints the mode (#246) |
| A2 | b3 and b4 stopped without `pit:true`, with `autoPit:false` applied | Cause not found in code; pit transitions now logged (#247) |
| A3 | `state.json` froze mid-race once back in the room; race 1 classification lost | Confirmed; fixed (#246) |
| A4 | Pending box call invisible to the strategist → double stop | `bot-watch` gap; fixed (#246) |
| A5 | 30 s Playwright stall on the room join input | Fixed with 3 s timeouts (#246) |

## Other

- `gh` is not installed on the user's PC, so the local agent could not
  file issues. It wrote the raw report into `.knowledge/sources/raw/`, and
  the cloud session filed #246 and #247.
- The root `package.json` script `start:room-server` was renamed to
  `start` (`npm start`); the README was updated to match.
