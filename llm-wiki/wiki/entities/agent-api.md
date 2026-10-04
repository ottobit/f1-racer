---
type: entity
updated: 2026-10-04
sources: []
---

# Agent API (`window._ENVIRONMENT_`)

`core/client/race/agent-api.js` (#8/#9) lets an external agent drive the player car from an
already-open race page, without simulating touch/keyboard events. It's
opt-in only, via `?agent=1` on `race.html`; `core/client/race/main.js` never imports it
otherwise, so a normal human session pays nothing for it. Once wired up it
sets `window._ENVIRONMENT_ = { getState, step, act, enqueue, release }` and fires
`f1-environment-ready` on `window`.

```js
const s = window._ENVIRONMENT_.getState();
await window._ENVIRONMENT_.step({ throttle: 1, durationMs: 800 });                 // straight-line accel
await window._ENVIRONMENT_.step({ steer: -0.4, throttle: 0.6, durationMs: 600 });  // turn left into a corner
window._ENVIRONMENT_.release();                                                     // hand control back
```

`getState()` returns a compact, freshly-built (never-shared) snapshot, so
mutating the returned object cannot affect internal state: session
phase/state, `speedKmh`, lap/laps, race position, `totalProgress`,
`lateralOffsetMeters` and `headingErrorRad` from the ideal line, `onTrack`,
`returnHeadingErrorRad` (off track only: heading error towards the nearest
centerline point, `null` on track; the off-track speed floor of ~29 km/h is
the shared runoff `crawlSpeed`, same for player and AI),
damage/tyre/DRS status, a `nextCorner` heuristic (direction/distance/
curvature — the largest heading change found within a fixed lookahead window
over the same centerline samples the AI steers by, not a real geometric
radius), up to 5 `nearbyCars` (relative distance/lateral offset, closest
first), and `finished`/`raceResult` once the race ends.

`step(action)` validates and clamps `steer` (-1..1), `throttle`/`brake`
(0..1) and `durationMs` (50–3000ms, default 500) rather than throwing on bad
input; a second `step()` while one is in flight is rejected. It drives the
exact same input the human player uses — `input.forward`/`input.back`
booleans (pedals are digital in this game, so 0..1 throttle/brake are
thresholded to on/off) and `setExternalSteer()` in `core/client/race/race-input.js` that
overrides `steering.value` without being reset to 0 by the keyboard/wheel/
motion smoothing that runs every frame. When the step's duration elapses it
neutralizes throttle/brake/steer and returns the new `getState()` — so one
`step()` call is both the action and the next observation. There is no `drs`
action: DRS is fully automatic here (gap-based), so `getState()` only
reports `drsActive` read-only.

Human control always wins immediately: `core/client/race/race-input.js`'s real DOM handlers
(keydown, pointer, motion) call an `onHumanInput` callback synchronously —
never the agent itself — which the agent API uses to abort its current step,
clear the external steer override and release any pedal it was holding, all
before the human's own input is applied. `release()` does the same
explicitly, for an agent that wants to hand back control without waiting for
a step to finish.

Continuous control (#201): `act({ steer, throttle, brake, leaseMs })` applies
at once, returns `getState()` and holds the command until the next `act()`,
the lease running out (default 1000 ms, max 5000 → neutral, mode
`released`), `release()` or a human input (mode `human`). `enqueue(segments)`
plays up to 10 `{ steer, throttle, brake, durationMs }` segments (≤ 5000 ms
in all) and then goes neutral; `act()`, `release()` and a human cancel it.
`step()` runs on the same controller. A `generation` counter makes stale
timers no-ops. `getState().control` = `{ mode, steer, throttle, brake,
leaseRemainingMs, queue }`; `nearbyCars[].remote` marks room participants.
`pagehide` / a hidden tab release an agent command.

## Transports

The controller does not depend on any one transport:
- **WebMCP.** It registers `f1_observe`, `f1_act`, `f1_enqueue`, `f1_radio`
  and `f1_release` through `document.modelContext` when that exists.
  `navigator.modelContext` is the fallback.
- **Multiplayer.** `?agent=1` also registers the page with the room server's
  agent relay. The relay gives each participant a bearer token, which never
  appears in public room state. `?agentToken=` (at least 16 characters) can
  preset it, and `room.js` keeps both params when it moves from the lobby to
  the race.

The relay, the remote MCP server (`core/tools/agent-mcp-http.mjs`, `POST /mcp`,
`F1_MCP_AUTH_TOKEN`) and the stdio fallback are described in
[c4-mcp.md](../synthesis/c4-mcp.md) and [c4-agent-control.md](../synthesis/c4-agent-control.md). Bots
are covered in [agent-bots.md](agent-bots.md).
