# Agent Bots

How agents (Claude, ChatGPT) join multiplayer rooms as participants. The
play procedure itself lives in [`procedure-racing.md`](../../../procedure-racing.md);
this page is the why and the trade-offs. Source:
[agent bots session](../../sources/2026-09-27-agent-bots-session.md).

## Browser bot vs headless bot

Since #219 both drive with the same physics and the same strategy layer
(`driver-providers.js`, `?driver=layered`). What differs is who runs that
code, how it talks to the server and what can break.

| | Browser bot (`core/tools/room-bot.mjs`) | Headless bot (`core/tools/headless-room-bot.mjs`) |
|---|---|---|
| Runs | The real game: Playwright/Chromium opens `room.html`, then `race.html?driver=layered` | Plain Node, no page, no rendering |
| Physics / driving | Full `main.js` | Same modules imported one by one: `race-rules.js`, `player-physics.js`, `race-systems.js` (pit lane), `race-progress.js`, `race-collisions.js`, autopilot + layered provider |
| Protocol | The game's multiplayer client, driven by clicking the room UI | Raw WebSocket messages: join, reserve, `set_ready`, `report_quali_time`, `report_finish`, `car_state` every 80 ms, radio via `voice_signal` |
| Needs | Static server on :8080, WS relay on :8081 behind a proxy | Nothing local |
| Clock | Frame-driven; software GL in the cloud can make it uneven (needs verification) | Fixed-step loop, server clock offset from `serverNow` |
| Weight | A whole Chromium | Minimal |
| Fidelity | Maximum: it is the code players run, so it also finds game bugs (it caught #222 via `pageerror`) | As faithful as its copy of the race flow; if `main.js` changes and the bot does not, they drift |
| Weak points | Room-page flow, e.g. the rematch re-reserve (#224) | Qualifying and pit stop not yet verified in a real room; noisy `ready`/retry logs |

Both self-report lap times and finish, like every client
(client-authoritative sync, see [decisions.md](decisions.md)). Neither is
validated by the server; headless is only easier to tamper with. If
third-party bots ever race, the server must validate times (open).

## Usage concepts

- **Which bot**: browser bot to hunt game bugs; headless for long races or
  many bots. Running one of each with different strategies is the default
  play setup (`claude-browser`, `claude-headless`).
- **Strategy**: a local loop reads `state.json` and rewrites
  `strategy.json` (`pace`, `ers:"auto"`, `pit`, `tyre`, `radio`, ...). The
  same file format drives both bots.
- **Radio**: agents announce their strategy on the room radio (user rule):
  at lights out, on the box call (with compound) and under safety car.
  `radio` is one-shot, max 80 chars.
- **Keep-alive**: a cloud container is suspended when idle and the bot dies,
  leaving a ghost (#211 heartbeat now removes it). Keep a background loop
  running for the whole session.
- **Rematch**: until #224 is fixed, the browser bot can grab a new driver
  and block the room; start a fresh room instead of "Rivincita".
- **Bug hunt**: after each race, open deduplicated Italian issues for what
  the bots saw (`pageerror`, protocol hiccups, strategy API gaps).
- **Checks**: `node --check` does not catch a missing import (#222); after a
  module extraction, confirm with a bot run that the race page loads.
