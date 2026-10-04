---
type: entity
updated: 2026-10-04
sources: []
---

# AI, qualifying and race systems

## Rival AI (`core/client/race/race-ai.js`, `rival-ai.js`)

The AI works in three layers:
1. It previews the centerline and estimates how severe the coming corner is.
2. It picks a dynamic lookahead and a racing-line offset.
3. It sets a corner-speed target: it brakes before bends and accelerates once
   the preview clears.

In traffic:
- a car close ahead triggers a passing-side line;
- a car close behind triggers a defensive line;
- short-range avoidance stays on as a safety layer.

Each rival's parameters come from its car's `stockParams(isRaining)`
([architecture.md](../synthesis/architecture.md#source-layout-46)).

Not modelled:
- tyre temperature;
- per-driver error profiles;
- multi-lap strategy;
- an overtaking state machine;
- automatic AI pit stops. They were removed because stopping on the track
  was confusing; they can return only with a modelled pit lane
  ([decisions.md](../synthesis/decisions.md)).

## Qualifying

- The player qualifies alone: the best completed lap in 60 s counts.
- In solo play, rival times are synthesized from track length, the AI's top
  speed and a controlled variance. They are not driven in real time.
- Those times feed both the timing tower and the grid.
- The grid order is applied to fixed physical grid slots.
- Multiplayer: [multiplayer-protocol.md](multiplayer-protocol.md).

## Race systems

- Standing start (see [audio.md](audio.md#start-procedure)), laps and
  classification.
- Championship points: [championship](#championship).
- **DRS** is automatic. **ERS** is manual, with recharge and deployment.
- **Tyres.** Compounds wear out, and wet grip is lower. The player can make
  a pit stop with crew animation (`pit-crew.js`, `shared/pit-lane.js`).
- **Damage.** See [driving-model.md](../concepts/driving-model.md).
- **Track-limit penalties** and a **caution** state.
- **Weather.** `race-weather.js` draws clouds and rain particles.

### Contacts

`race/race-collisions.js` handles car-to-car contact:
- overlap correction plus an equal-mass impulse along the contact normal;
- both cars lose speed, slide sideways and yaw;
- capped damage, with a cooldown so one long overlap does not keep adding
  damage;
- sparks and player camera shake.

## Ghost lap

- The player's best lap is sampled about every 100 ms (time, x, z, heading).
- It is saved per circuit in `localStorage` under `f1racer-ghost-v1`, and
  replayed against the current lap clock.

## Championship

- `core/client/shared/championship.js` defines a `Championship` class, with
  one instance per series (`CHAMPIONSHIPS`, #345).
- It is stored locally and is entirely client-side.
- The race reports the classification and points, then the next circuit not
  yet raced.
- A multiplayer race skips the solo championship ([decisions.md](../synthesis/decisions.md)).
