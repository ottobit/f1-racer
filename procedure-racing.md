# Racing procedure — agent play session

Trigger (by inference, no fixed keyword): the user wants to play/race
against agents — "giochiamo", "facciamo una gara", a room-server URL, a
room code, "entra in stanza", etc. This file is all you need: do NOT read the wiki, handoff or history.
Not a work cycle: no issue, branch or PR. Talk to the user in Italian.

## Inputs (ask only for what's missing)

- `SERVER`: room-server URL, e.g. `https://xxxx.ngrok-free.app`. A plain GET
  answering "Upgrade Required" means it is up (it's a WebSocket server).
- `ROOM`: 4-letter room code. The server cannot list rooms: the user creates
  the room on `room.html?roomServer=<SERVER>` and hosts/starts the race.
- Your name: Claude → `Claude`, ChatGPT → `ChatGPT` (one bot per agent).

## Start (from the repo root)

```sh
git pull origin master                        # stale code breaks the bots
npm install                                   # once: ws + three in core/
python3 -m http.server 8080 &                 # static game on :8080
mkdir -p /tmp/bot-<NAME>
echo '{"pace":0.95,"ers":"auto"}' > /tmp/bot-<NAME>/strategy.json
PLAYWRIGHT_PATH=$(npm root -g)/playwright \
  node core/tools/room-bot.mjs <SERVER> <ROOM> --name <NAME> --dir /tmp/bot-<NAME> \
  > /tmp/bot-<NAME>/log.txt 2>&1 &
```

- Default setup: two bots with different strategies, `<NAME>-browser`
  (above) and `<NAME>-headless` (plain Node, no :8080 needed):
  `node core/tools/headless-room-bot.mjs <SERVER> <ROOM> --name <NAME>-headless --dir /tmp/bot-<NAME>-headless`.
  Browser vs headless trade-offs: `llm-wiki/wiki/f1-racer/agent-bots.md`.
- Needs Playwright + Chromium (global install is fine; `PLAYWRIGHT_PATH`
  only if `require("playwright")` fails locally).
- Many browser bots (#233): `--names a,b,c --dir /tmp/bots` runs them in
  one Chromium, files in `/tmp/bots/<name>/`. They render with `gfx=low` in
  a small viewport; `state.json` has `botFps` (below ~50 the bot drives
  worse). Measured in a race on the 4-core cloud box: 7 bots at 56–59 fps,
  11 bots at 30–33 fps with visible stutter. Use 5 (smooth for the human),
  7 at most.
- One command for a whole fleet (#244), on the cloud box or a player's PC:
  `node core/tools/bot-fleet.mjs <SERVER> <ROOM> --count 5` (run it in the
  background) serves :8080 itself (no Python), joins the bots and prints
  every bot's `botFps` and position every 10 s. It decides nothing: you are
  the strategist of every bot (below). Add `--gpu` (or `--headed`) on a
  machine with a real GPU; `state.json` `gpuRenderer` says what WebGL
  really uses ("SwiftShader" = CPU).
- On the player's PC (run the agent there with `claude remote-control`):
  `npm install` in `core/`, `npm i -g playwright`,
  `npx playwright install chromium`; if the room server runs on the same
  PC use `ws://localhost:8787` as `<SERVER>` (no ngrok, no relay).
- Behind an HTTPS proxy (`HTTPS_PROXY` set) the bot relays the WebSocket on
  `:8081` by itself; a second room-bot process reuses that relay. Port 8080
  serves the game for every bot on the box.
- Log should show `reserved <driver>`; the bot ticks "ready" on its own.
  Tell the user: joined, driver, waiting for the host to start.

## During the race

You decide, live, for every bot (user rule, 2026-09-27): no strategy
scripts, no loops that apply rules for you. The bot re-reads
`strategy.json` on every change and writes `state.json` every 2 s.

- Read the race: `node core/tools/bot-watch.mjs [DIR] --timeout 20` waits
  until something worth a decision happens (lap, pit state, safety car,
  wear crossing 50/70/85%, damage) or 20 s pass, then prints one line per
  bot. It only reports.
- Decide and write each bot's `strategy.json` yourself (whole file, it is
  not merged), always with `"autoPit":false` so the driver never boxes on
  its own; `pit`/`radio` are one-shot.
- Before lights out: give every bot its own plan (pace, planned stop,
  compound) and announce it by `radio`.
- Repeat watch → decide → write until `finished`, for every race including
  rematches. Never end your turn between lights out and `finished`: a plan
  set before the start and left alone is not live strategy (VSN2 race 1).
  Staying in the turn also keeps a cloud container awake.
- `pit ... armed` in the watch line = the box call is still pending (it
  stays armed until the pit entry, up to a lap): never send `pit` again,
  or the car stops twice. The word after `pace` is the driver's tactical
  mode, which explains a pace different from the one you set.
- Wear % grows ~33% a lap on every compound; over 5 laps one stop is the
  baseline. A stop also cuts damage to a quarter.

`strategy.json` (all keys optional; invalid values are ignored):

| key | value | effect |
|---|---|---|
| `pace` | number 0.5–1 | fraction of corner speed (default 0.86); >0.95 risks walls |
| `line` | −1…1 | lateral offset target |
| `ers` | bool / `"auto"` | deploy ERS; `"auto"` (recommended) lets the bot deploy it on straights |
| `tyre` | `soft`/`medium`/`hard` | fitted at the next stop |
| `pit` | `true` | box this lap (one-shot) |
| `autoPit` | bool | `false`: the driver never boxes on its own (default `true`) |
| `station` | `{car, gap, side}` / `null` | hold a gap (m) to another car |
| `radio` | string ≤80 | message shown in the room (one-shot) |

Key `state.json` fields: `session.phase/state`, `lap`/`lapsTotal`,
`position`, `tyreWearPct`, `tyreCompound`, `damagePct`, `ers.chargePct`,
`gapAheadS`/`gapBehindS`, `nearbyCars`, `weather`, `safetyCar`, `lapTimes`,
`pit.state`, `targets` (what the bot is applying now).

Radio (user rule): announce your strategy with `radio` — at lights out,
on every box call (with the compound) and under safety car.

Rules of thumb (yours to apply, per bot): wear ≥ ~80% with ≥ 2 laps left → `pit` + fresh `tyre`;
damage high → lower `pace`; `safetyCar` true → `ers:false`, save for restart.

## Stay alive (cloud agents)

A cloud container is suspended when the agent sits idle: the bot dies
mid-room and leaves a ghost the host has to wait out (#211). During a race
you are working (watch → decide), so it stays awake; between races keep
the fleet running in the background and don't end the session. Stop the
bots only when the user says to stop.

## Bug and requirement hunt (user rule)

While racing, note anything odd: bot behaviour, room/protocol hiccups,
strategy API gaps, physics, HUD. After each race: search existing issues for
duplicates, then open one GitHub issue per finding, in Italian, with what
was seen, likely cause (with file paths) and a proposal. Tell the user the
issue numbers in one line. No `gh`/GitHub tools (e.g. on the player's
PC): write a raw report in `llm-wiki/sources/raw/<date>-race-<ROOM>.md`
(setup, fps, decisions per lap, anomalies with file paths) plus the fleet
log, and push it; a later session files the issues and ingests it. Fixing them is a normal work cycle, only when the
user asks.

## End

Race over (`session.state` = `finished`): tell the user the result. On
"Rivincita" the running bots go back to the room and ready up by themselves
(#224 closed). When the user says to stop:
`pkill -f room-bot.mjs; pkill -f "http.server 8080"` (fleet: Ctrl-C or
`pkill -f bot-fleet.mjs`).
