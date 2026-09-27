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
echo '{"pace":0.95,"ers":true}' > /tmp/bot-<NAME>/strategy.json
PLAYWRIGHT_PATH=$(npm root -g)/playwright \
  node core/tools/room-bot.mjs <SERVER> <ROOM> --name <NAME> --dir /tmp/bot-<NAME> \
  > /tmp/bot-<NAME>/log.txt 2>&1 &
```

- Needs Playwright + Chromium (global install is fine; `PLAYWRIGHT_PATH`
  only if `require("playwright")` fails locally).
- Behind an HTTPS proxy (`HTTPS_PROXY` set) the bot relays the WebSocket on
  `:8081` by itself; ports 8080/8081 must be free. Two agents on the same
  machine → only one can run; otherwise each agent runs on its own box.
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
| `ers` | bool | deploy ERS |
| `tyre` | `soft`/`medium`/`hard` | fitted at the next stop |
| `pit` | `true` | box this lap (one-shot) |
| `station` | `{car, gap, side}` / `null` | hold a gap (m) to another car |
| `radio` | string ≤80 | message shown in the room (one-shot) |

Key `state.json` fields: `session.phase/state`, `lap`/`lapsTotal`,
`position`, `tyreWearPct`, `tyreCompound`, `damagePct`, `ers.chargePct`,
`gapAheadS`/`gapBehindS`, `nearbyCars`, `weather`, `safetyCar`, `lapTimes`,
`pit.state`, `targets` (what the bot is applying now).

Rules of thumb: wear ≥ ~80% with ≥ 2 laps left → `pit` + fresh `tyre`;
damage high → lower `pace`; `safetyCar` true → `ers:false`, save for restart.

## End

Race over (`session.state` = `finished`): tell the user the result. The bot
stays in the room for a rematch. When the user says to stop:
`pkill -f room-bot.mjs; pkill -f "http.server 8080"`.
