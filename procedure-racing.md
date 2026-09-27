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
  worse). Measured on the 4-core cloud box: 11 bots at ~58 fps.
- Behind an HTTPS proxy (`HTTPS_PROXY` set) the bot relays the WebSocket on
  `:8081` by itself; a second room-bot process reuses that relay. Port 8080
  serves the game for every bot on the box.
- Log should show `reserved <driver>`; the bot ticks "ready" on its own.
  Tell the user: joined, driver, waiting for the host to start.

## During the race

The bot re-reads `strategy.json` on every change and writes `state.json`
every 2 s. Loop: read `state.json` → decide → rewrite `strategy.json`.
Poll every ~10–20 s, not faster (tokens).

`strategy.json` (all keys optional; invalid values are ignored):

| key | value | effect |
|---|---|---|
| `pace` | number 0.5–1 | fraction of corner speed (default 0.86); >0.95 risks walls |
| `line` | −1…1 | lateral offset target |
| `ers` | bool / `"auto"` | deploy ERS; `"auto"` (recommended) lets the bot deploy it on straights |
| `tyre` | `soft`/`medium`/`hard` | fitted at the next stop |
| `pit` | `true` | box this lap (one-shot) |
| `station` | `{car, gap, side}` / `null` | hold a gap (m) to another car |
| `radio` | string ≤80 | message shown in the room (one-shot) |

Key `state.json` fields: `session.phase/state`, `lap`/`lapsTotal`,
`position`, `tyreWearPct`, `tyreCompound`, `damagePct`, `ers.chargePct`,
`gapAheadS`/`gapBehindS`, `nearbyCars`, `weather`, `safetyCar`, `lapTimes`,
`pit.state`, `targets` (what the bot is applying now).

Radio (user rule): announce your strategy with `radio` — at lights out,
on every box call (with the compound) and under safety car.

Rules of thumb: wear ≥ ~80% with ≥ 2 laps left → `pit` + fresh `tyre`;
damage high → lower `pace`; `safetyCar` true → `ers:false`, save for restart.

## Stay alive (cloud agents)

A cloud container is suspended when the agent sits idle: the bot dies
mid-room and leaves a ghost the host has to wait out (#211). Keep a
background loop running for the whole play session, not
just the race — e.g. a small script that reads `state.json` every 5 s,
applies the strategy, and keeps waiting across rematches. Stop it only when
the user says to stop.

## Bug and requirement hunt (user rule)

While racing, note anything odd: bot behaviour, room/protocol hiccups,
strategy API gaps, physics, HUD. After each race: search existing issues for
duplicates, then open one GitHub issue per finding, in Italian, with what
was seen, likely cause (with file paths) and a proposal. Tell the user the
issue numbers in one line. Fixing them is a normal work cycle, only when the
user asks.

## End

Race over (`session.state` = `finished`): tell the user the result. Until
#224 is fixed the browser bot may grab a new driver on "Rivincita" and block
the room: stop the bots and rejoin a fresh room code instead. When the user says to stop:
`pkill -f room-bot.mjs; pkill -f "http.server 8080"`.
