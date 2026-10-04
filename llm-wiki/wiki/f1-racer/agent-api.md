# Agent API (window._ENVIRONMENT_)

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## Agent API (`window._ENVIRONMENT_`)

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
thresholded to on/off) and a new `setExternalSteer()` in `core/client/race/race-input.js` that
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
`step()` now runs on the same controller. A `generation` counter makes stale
timers no-ops. `getState().control` = `{ mode, steer, throttle, brake,
leaseRemainingMs, queue }`; `nearbyCars[].remote` marks room participants.
`pagehide` / a hidden tab release an agent command.

The controller is now transport-neutral. Native WebMCP registers
`f1_observe`, `f1_act`, `f1_enqueue`, `f1_radio`, `f1_release` through
`document.modelContext` when available (with the older
`navigator.modelContext` retained as compatibility fallback), but a WebMCP
browser is **not required**. In multiplayer, `?agent=1` also registers the
page with the room server's realtime agent relay. The server returns a
per-participant bearer token, never included in public room state; callers
may preselect a token with `?agentToken=<secret>` (minimum 16 chars) so an
external controller already knows it. `room.js` preserves both query params
when navigating lobby → race.

`core/server/room-server.mjs` relays only four whitelisted `f1_*` calls:
an external controller sends `agent_attach` with the bearer token, then
`agent_call { callId, tool, args }`; the server forwards that call only to
the race socket that registered the token and returns its `agent_result`.
Controller sockets are not room participants, cannot reserve drivers, and
lose authority when the race page disconnects/re-registers. The room server
still performs no driving logic or physics.

`core/tools/agent-mcp-common.mjs` owns the shared tool definitions and
WebSocket bridge client used by both MCP transports. The **primary integration
surface is now the remote Streamable HTTP URL**, intended for Claude,
ChatGPT and other remote MCP clients alike. The older
`core/tools/agent-mcp-server.mjs` stdio adapter remains only as an optional
compatibility/tooling fallback.

`core/tools/agent-mcp-http.mjs` exposes `POST /mcp` (default
`127.0.0.1:8790`) as a stateless Streamable HTTP endpoint. It supports the
2026-07-28 discovery/request shape plus a recent legacy initialize handshake,
exposes exactly the same four `f1_*` tools, and forwards calls through the
same WebSocket bridge. Each POST must advertise both
`application/json` and `text/event-stream`; modern requests validate the
MCP protocol/method headers, and incoming `Origin` values are restricted to
same-host or the explicit `F1_MCP_ALLOWED_ORIGINS` allowlist. `GET /health`
reports configuration without secrets. Set `F1_MCP_AUTH_TOKEN` to require a
Bearer token before publishing/tunneling the endpoint; HTTPS termination
belongs to the reverse proxy/tunnel. Run it with
`npm run start:agent-mcp:http`, publish `https://<host>/mcp`, and point
Claude/ChatGPT directly at that URL.

Verified in a real headless browser (Playwright, Chromium): the API appears
and matches this contract, `getState()` snapshots are JSON-serializable and
isolated from mutation, out-of-range `step()` input is clamped rather than
throwing, a concurrent `step()` is rejected, and a step neutralizes its
inputs once its duration elapses.
