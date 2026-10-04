# Racing procedure — agent play session

Trigger (by inference, no fixed keyword): the user wants to play/race
against agents — "giochiamo", "facciamo una gara", a room-server URL, a
room code, "entra in stanza", etc. This file is all you need: do NOT read the wiki, handoff or history.
Not a work cycle: no issue, branch or PR. Talk to the user in Italian.

## Your role (user rule, 2026-09-28 — don't make the user explain it)

You are the **team principal and strategist** of one or more bots racing
against the user. The bots drive (steering, braking, lines); **you decide
every strategy live**: pace, stops, tyres, ERS, radio, per bot, from lights
out to the flag, in every race and rematch. No strategy scripts or loops
deciding for you, no plan set once and left alone. Default fleet: 5 bots
(`--count`); use the number the user asks for, even 1.

## Inputs (ask only for what's missing)

- `SERVER`: room-server URL. Default: the hosted one, today
  `https://f1-racer-rooms.onrender.com` (`HOSTED_ROOM_SERVER` in
  `core/client/multiplayer/room-server.js`); else what the user gives
  (`https://xxxx.ngrok-free.app`, or `ws://localhost:8787` on the same PC).
  `GET /health` answering `ok` means it is up; a free plan can take ~1 min
  to wake from a nap, so ping it before starting the fleet.
- `ROOM`: 6-character room code (4 before #371). The server cannot list rooms: the user creates
  the room on `room.html?roomServer=<SERVER>` and hosts/starts the race.

## Start (from the repo root)

```sh
git pull origin master     # stale code breaks the bots
npm install                # once: ws + three in core/
node core/tools/bot-fleet.mjs <SERVER> <ROOM> --count 5    # in the background
```

- `bot-fleet.mjs` (#244) serves the game on :8080 itself, joins the bots
  (`claude-b1`…`claude-bN`, files in `<tmp>/f1-bots/<name>/`), prints every
  bot's `botFps` and position every 10 s. It decides nothing. Log should
  show `reserved <driver>` and `ready` per bot: tell the user joined,
  drivers, waiting for the host to start.
- Needs Playwright + Chromium (a global install is fine, the fleet finds
  it). On the player's PC (agent started with `claude remote-control`):
  `npm i -g playwright`, `npx playwright install chromium`.
- Do not end your turn after the bots join: the host starts the race with
  no warning and a turn ended in the lobby misses lights out (#293). Write
  every bot's plan and radio first, then stay in a `bot-watch` loop until
  the lobby turns into `race` and go on to `finished`. The user never has
  to tell you the race started.
- Capacity: 5 bots are smooth for the human, 7 at most on a 4-core box
  (11 → ~30 fps and stutter). `botFps` below ~50 = the bot drives worse.
- `--gpu` (or `--headed`) on a machine with a real GPU; `state.json`
  `gpuRenderer` says what WebGL really uses ("SwiftShader" = CPU).
- Behind an HTTPS proxy (`HTTPS_PROXY` set, cloud box) the bots relay the
  WebSocket on `:8081` by themselves; a second process reuses it.
- Headless bot (plain Node, no browser, cheaper, less faithful):
  `node core/tools/headless-room-bot.mjs <SERVER> <ROOM> --name <NAME> --dir <DIR>`;
  same `strategy.json`/`state.json`. Trade-offs:
  `llm-wiki/wiki/f1-racer/agent-bots.md`.

## During the race

You decide, live, for every bot (user rule, 2026-09-27): no strategy
scripts, no loops that apply rules for you. The bot re-reads
`strategy.json` on every change and writes `state.json` every 2 s.

- Read the race: `node core/tools/bot-watch.mjs [DIR] --timeout 5` waits
  until something worth a decision happens (lap, pit state, safety car,
  wear crossing 50/70/85%, damage) or 5 s pass, then prints one line per
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
- Loop speed: the real cycle is `--timeout` plus your own tool and thinking
  time (~10-15 s in practice), so a long timeout only adds dead time. Use
  `--timeout 5` and keep each turn's writes short; if cycles
  still run longer than ~10 s, drop the extras (skip the per-bot rewrite when
  nothing changed) rather than raising the timeout.
- Be present (user rule, 2026-09-29): every check, look at `standings` in
  `state.json` — the human is in it — and at the gap between the human and
  each bot. A bot within ~1.5 s of the human, attacking or defending gets a
  `radio` and a pace decision. Radio on every event: lights out, each box
  call, overtakes, safety car, damage, last lap. After each lap write one
  line in chat with the human's position and the bots'. Never say you
  cannot see the human's position.
- `pit ... armed` in the watch line = the box call is still pending (it
  stays armed until the pit entry, up to a lap): never send `pit` again,
  or the car stops twice. The word after `pace` is the driver's tactical
  mode, which explains a pace different from the one you set.
- Wear % grows ~33% a lap on every compound; over 5 laps one stop is the
  baseline. Call the box at ~60-70% wear: a stop at lap 1-2 leaves the new
  tyres at 100% before the flag. A stop also cuts damage to a quarter.

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
When the user says to stop: Ctrl-C the fleet or
`pkill -f bot-fleet.mjs; pkill -f room-bot.mjs` (the fleet's :8080 server
stops with it).
