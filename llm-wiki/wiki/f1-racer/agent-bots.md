# Agent Bots

How agents (Claude, ChatGPT) join multiplayer rooms as participants. The
play procedure itself lives in [`procedure-racing.md`](../../../procedure-racing.md);
this page is the why and the trade-offs. Sources:
[agent bots session](../../sources/2026-09-27-agent-bots-session.md),
[12-car bot races](../../sources/2026-09-27-twelve-car-bot-races.md),
[browser bot capacity](../../sources/2026-09-27-browser-bot-capacity.md).

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
| Weight | One Chromium shared by all bots of a process (`--names`, #233), `gfx=low` + 480×270. In a race on 4 cores: 7 bots 56–59 fps, 11 bots 30–33 fps (see below) | Minimal |
| Fidelity | Maximum: it is the code players run, so it also finds game bugs (it caught #222 via `pageerror`) | As faithful as its copy of the race flow; if `main.js` changes and the bot does not, they drift |
| Weak points | Room-page flow (the rematch re-reserve, #224, verified fixed with 11 bots) | Qualifying and pit stop not yet verified in a real room; noisy `ready`/retry logs |

Both self-report lap times and finish, like every client
(client-authoritative sync, see [decisions.md](decisions.md)). Neither is
validated by the server; headless is only easier to tamper with. If
third-party bots ever race, the server must validate times (open).

## Usage concepts

- **Which bot**: browser bot to hunt game bugs, and since #233 also to
  fill a grid (`--names`); headless for long races or when no browser is
  available. Running one of each with different strategies is the default
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
- **Rematch**: "Rivincita" works with browser bots (#224 closed after an
  11-bot rematch); only a single bot rejoining a full room is untested.
- **Bug hunt**: after each race, open deduplicated Italian issues for what
  the bots saw (`pageerror`, protocol hiccups, strategy API gaps).
- **Fresh checkout**: `git pull` before launching. A stale copy crashed the
  browser bot when the host picked a driver added later (#232 roster).
- **Grid size**: room capacity is the roster length (`MAX_PARTICIPANTS` in
  `rooms.mjs`, 12 since #232); the room server must be restarted after a
  roster change. No join after lights out.
- **Live strategy changes**: only by rewriting a bot's `strategy.json`
  (applied within ~2 s). The agent's strategy loop overwrites a manual
  override at its next event, and #228 tactics may still adjust pace/pit.
- **Checks**: `node --check` does not catch a missing import (#222); after a
  module extraction, confirm with a bot run that the race page loads.

## Shared tactics and finish behavior (#228–#229)

`createLayeredProvider({ fast, getState })` evaluates the race picture every
0.5 simulation seconds. Browser bots read `_ENVIRONMENT_.getState()`;
headless bots use their compatible snapshot. Close gaps raise pace or move
inside before a corner (never defend while another car is alongside).
Rain and damage cap pace; tyre wear combined with lap-time degradation can
request one pit stop, reset after fresh tyres. ERS defaults to `auto` on
straights; explicit ERS strategy still applies except under caution.
`getTargets()` exposes base targets, effective targets and tactical mode.

`finish-pull-over.js` supplies one post-finish plan to the browser player,
solo AI and headless bot. It picks the nearest track edge once, blends the
lateral target over two seconds, and brakes to a stop only after reaching
the edge. It uses ordinary steering/motion, without relocating the car.
The plan is reset when the grid is initialized for another race.

## Strategy findings from 12-car races (Open)

From four 1 human + 11 bot races (source above); small sample, one circuit
set, bots' own timing:

- `pace` above ~0.93 loses in a 12-car pack: track-limit penalties cost more
  than corner speed gains (#236).
- An early stop on softs (50% wear) won twice; non-stoppers won once. The
  stop's cost depends on when traffic is lightest, not on stopping.
- Lap 3 is 6–9 s slower for the whole field with no safety car, and one
  bot posted a 22 s lap ~4 s under everyone: needs verification (#236).
- Self-reported positions are unreliable for both bots (#235): browser bots
  also report duplicates, even at ~58 fps. Use the host's results screen as
  truth.

## Many browser bots on one box (#233, #239)

All bots share the static server on :8080 and one WebSocket relay on :8081;
the relay opens a separate upstream tunnel per browser connection, so the
port is never the limit. The CPU is.

| Piece | Shared by | How |
|---|---|---|
| `http.server 8080` | every bot on the box | serves the game pages |
| Relay `:8081` (only with `HTTPS_PROXY`) | every bot on the box | one `WebSocketServer`, one `CONNECT` + TLS tunnel per connection; a second `room-bot.mjs` gets `EADDRINUSE` and reuses it |
| Chromium | the bots of one process | `--names a,b,c`: one isolated context each (own room identity) |
| Context | one bot | 480×270, `driver=layered&gfx=low`, three.js from `core/node_modules`, files in `<dir>/<name>/` |
| Join | — | 1.5 s apart, so two bots never reserve the same driver |

Capacity on the 4-core cloud box (bots' `botFps`, human's view):

| Bots in a race | `botFps` | Human's screen |
|---|---|---|
| 11 | 30–33 | remote cars stutter; bots several s/lap slower |
| 7 | 56–59 | still a little jumpy, better |
| 5 | ~50 at the start, 59–60 later | much smoother (recommended) |

- Solo benchmarks (11 bots ~58 fps alone on track) overstate capacity:
  in a race each page also simulates and draws the other cars.
- Keep `botFps` at or above ~50: below that race results do not rank
  strategies.
- One Chromium process is shared, but every page has its own renderer
  running the whole race (physics + drawing all cars): CPU cost grows with
  the number of bots, the shared browser only saves memory and start-up.
- Open: with 5 bots a small residual jump remains on the human's screen,
  likely the network path (relay, ngrok, `car_state` cadence).
