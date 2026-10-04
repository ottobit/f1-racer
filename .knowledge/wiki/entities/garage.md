---
type: entity
updated: 2026-10-04
sources: []
---

# Garage

## F1 garage (`garage.html`, `core/client/garage/`)

- **Files:**
  - `garage.js`: the UI;
  - `showroom.js`: the Three.js stage;
  - `core/client/shared/garage-setup.js`: the shared data and physics
    contract.
- **Storage:** setups persist under `f1racer-garage-v1`. `loadGarageSetup()`
  keeps only known part and variant pairs.
- **Parts:** five component families (front wing, rear wing,
  floor/diffuser, brakes, suspension), with three trade-off variants each.
  They produce modifiers for speed, downforce, braking, stability, traction
  and runoff. `race/main.js` reads these at race start, so they change real
  physics.
- **Visual previews:**
  - wing, floor, spring and caliper choices change the showroom car;
  - selecting a part frames that assembly.
- **Interaction:**
  - parts are mounted by drag-and-drop onto five labelled zones, or by tap;
  - only the matching zone highlights.
- **Live stats:** the five live parameters show as a translucent overlay on
  the stage.
- **Recommended setup per circuit:**
  - `core/shared/circuits.js` stores it, with a rationale;
  - the circuit selected on home is persisted, and the garage shows the
    difference from the recommendation;
  - applying it is always an explicit action.
- **Layout:**
  - desktop: a scrolling pane beside a fixed stage;
  - portrait mobile: the stage above a pane that scrolls on its own.
- **Livery:** follows the selected driver's team, with no picker
  ([car-rendering.md](car-rendering.md)).

## Showroom (`garage/showroom.js`)

- Uses the same studio environment as the race, plus ACES tone mapping, a
  shadowed spotlight, a metal platform and a backdrop.
- Camera:
  - four camera presets plus orbit by pointer or touch;
  - auto-rotation turns off under the reduced-motion preference;
  - presets must not orbit beyond z = −8, behind the backdrop.
- `createShowroom` takes:
  - an optional `graphicsProfile` ([performance.md](../concepts/performance.md)); the
    fallback is the old 760 px viewport check;
  - an optional `onFrame(dt)`, used by the `?diag=1` overlay.
- Hidden tabs skip rendering.

## Road-car garage

The Classiche cars have their own garage UI with different parts:
`core/client/shared/road-garage.js` (`ROAD_PARTS`, `roadSetupParams`). See
[classic-series.md](classic-series.md).
