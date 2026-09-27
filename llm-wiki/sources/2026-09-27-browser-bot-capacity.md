# Browser bot capacity: HBKY and XK5Z races (2026-09-27)

Source: play session in rooms HBKY (1 human + 11 browser bots) and XK5Z
(1 human + 7 browser bots) on the 4-core cloud box (no GPU, software GL),
all bots in one `room-bot.mjs --names` process (#233). Numbers are the bots'
own `state.json` (`botFps`, `position`, best lap) plus what the human saw.

## Setup that shares one relay port

| Piece | Where | Shared by | How |
|---|---|---|---|
| Static game server | `python3 -m http.server 8080` at the repo root | Every bot on the box | Serves `room.html` / `race.html` to all contexts |
| WebSocket relay | `:8081`, started inside `room-bot.mjs` when `HTTPS_PROXY` is set | Every bot on the box | One local `WebSocketServer`; each browser connection gets its own upstream `CONNECT` tunnel + TLS to the room server |
| Second process | another `room-bot.mjs` on the same box | — | Gets `EADDRINUSE` on :8081, logs "relay :8081 already running, reusing it" and uses the running relay |
| Browser | one Chromium per process | All bots of that process | `--names a,b,c` opens one isolated context per bot |
| Per-bot context | `browser.newContext` | One bot | Own cookies/storage (own room identity), 480×270 viewport, three.js served from `core/node_modules` |
| Graphics | race URL gets `driver=layered&gfx=low` | — | Cheapest profile; `botFps` in `state.json` from a rAF counter |
| Files | `<dir>/<name>/strategy.json`, `state.json` | One bot | One strategy loop per bot rewrites `strategy.json` |
| Join order | 1.5 s between bots | — | Avoids two bots reserving the same driver at once |

## Capacity measured

| Test | Bots | `botFps` | Best laps | Human's screen |
|---|---|---|---|---|
| Solo benchmark, `gfx=high` 1280×720 | 8 | ~42 | — | — |
| Solo benchmark, `gfx=low` 480×270 | 8 | 60 | — | — |
| Solo benchmark, `gfx=low` 480×270 | 11 | ~58 | — | — |
| Race HBKY, 12 cars | 11 | 30–33 | ~29.7 s (b1) | Cars stutter and look erratic |
| Race XK5Z, 8 cars | 7 | 56–59 | 22.7–26.0 s | Still a little jumpy, better |

- Solo benchmarks overstate capacity: in a real race every page also
  simulates and renders the other cars, so 11 bots halve their frame rate.
- At ~30 fps the bots were several seconds a lap slower; HBKY results do not
  rank strategies.
- With 7 bots the pages are near the 60 fps cap, so the residual jumpiness
  on the human's screen may come from the network path (relay, ngrok,
  `car_state` cadence) rather than CPU. Not yet tested with 5 bots.

## Other observations

- Rematch in HBKY: all 11 bots went back to `room.html` and were ready
  within ~4 s; the human saw them seated. #224 closed.
- Duplicate self-reported positions also with browser bots, also at
  56–59 fps (two P6 in XK5Z, two P2 and two P5 in HBKY): not a CPU artefact
  (#235).
- Final `tyreWearPct` read 68–72% for almost every bot, stoppers and
  non-stoppers alike, on 5-lap races with a 3-lap tyre life; only one soft
  runner read 100%. Needs verification.
