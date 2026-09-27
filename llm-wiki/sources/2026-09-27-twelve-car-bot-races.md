# Source: 12-car bot races, 2026-09-27

Play session (Claude cloud agent, user as host). Rooms PFDT, 6KEY, F5XQ,
ZJYD: 1 human + 11 bots (1 browser `room-bot.mjs`, 10 headless
`headless-room-bot.mjs`), 5 laps, after #232 (12-driver roster, Ossidiana).
Raw bot logs lived in the ephemeral container; this note keeps the facts.

## Setup facts

- A stale local checkout crashed the browser bot at lights out
  (`pageerror: Cannot read properties of undefined (reading 'team')`): the
  host picked an Ossidiana driver the old roster did not know
  (`main.js` `DRIVER_ROSTER.find(...).team`). Fix: `git pull` before launch.
- Room capacity is `MAX_PARTICIPANTS = DRIVER_ROSTER.length`
  (`core/server/rooms.mjs`): the host restarted the room server to get 12.
- A bot joining after lights out is refused ("La gara di questa stanza è
  già iniziata"): no mid-race join.
- Only one browser bot per box then (fixed relay port :8081) → led to #233.
- Two bots reserving in the same second: the loser silently took another
  driver (joins now staggered, #233).
- Strategy injection mid-race works only by rewriting `strategy.json`
  (picked up within ~0.5–2 s); the agent's own strategy loop overwrites a
  manual override at its next event (pit, safety car, damage).

## Race observations (ZJYD, lap totals from headless logs)

| bot | pace / plan | total | penalties |
|---|---|---|---|
| h9 | 0.84, box at 50% wear → soft | 134.6 s | 0 |
| h8 | 0.86, no stop | 142.9 s | 1 |
| h4 | 0.93, box 60% → soft | 143.6 s | 2 |
| h1 | 0.97, box 70% → soft | 151.6 s | 3 |
| h2 | 0.96, box 80% → medium | 156.9 s | 4 |
| h3 | 0.94, no stop | 157.7 s | 3 |

- Pace above ~0.93 loses in a 12-car pack (track-limit penalties).
- Early stop on softs won twice (h9 in F5XQ and ZJYD); in PFDT non-stoppers
  led instead: stop cost depends on timing, not on stopping per se.
- Lap 3 is 6–9 s slower for everyone in three races, no safety car (#236).
- Headless positions contradict each other in every race; some headless
  bots miss the finished state (#235).
- Suspicious 22 s lap by h9, ~4 s under the field (#236).
- Browser bot, by its own game state: PFDT P11, 6KEY P2, F5XQ P11, ZJYD P5.

## Process facts

- #228–#231 (ChatGPT) could not be pushed from ChatGPT's sandbox; the user
  published and merged them as #232. Its log entry's "publication pending"
  is stale.
